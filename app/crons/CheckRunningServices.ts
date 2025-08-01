import { CronJob } from 'cron'
import { PrismaClient, Machine as PrismaMachine } from '@prisma/client'
import { KNOWN_SERVICES } from '../config/knownServices'
import { Connection, Machine as LibvirtMachine } from 'libvirt-node'

const prisma = new PrismaClient()

interface PortInfo {
    protocol: string;
    localAddress: string;
    localPort: number;
    state: string;
    pid?: number;
}

interface OsCommand {
    command: string;
    shell: string;
    parser: (output: string) => PortInfo[];
}

interface OsCommands {
    [key: string]: OsCommand;
}

async function getListeningPorts (libvirtMachine: LibvirtMachine, os: string): Promise<PortInfo[]> {
  const osCommands: OsCommands = {
    windows10: {
      command: 'netstat -an | findstr LISTENING',
      shell: 'cmd.exe',
      parser: (output: string) => {
        return output.split('\n')
          .filter(line => line.includes('LISTENING'))
          .map(line => {
            const parts = line.trim().split(/\s+/)
            const [addr, port] = parts[1].split(':')
            return {
              protocol: parts[0].toLowerCase(),
              localAddress: addr,
              localPort: parseInt(port),
              state: parts[3]
            }
          })
      }
    },
    windows11: {
      command: 'netstat -an | findstr LISTENING',
      shell: 'cmd.exe',
      parser: (output: string) => {
        return output.split('\n')
          .filter(line => line.includes('LISTENING'))
          .map(line => {
            const parts = line.trim().split(/\s+/)
            const [addr, port] = parts[1].split(':')
            return {
              protocol: parts[0].toLowerCase(),
              localAddress: addr,
              localPort: parseInt(port),
              state: parts[3]
            }
          })
      }
    },
    ubuntu: {
      command: 'ss -tulnp',
      shell: '/bin/sh',
      parser: (output: string) => {
        return output.split('\n')
          .filter(line => line.includes('LISTEN'))
          .map(line => {
            const parts = line.trim().split(/\s+/)
            const [addr, port] = parts[4].split(':')
            return {
              protocol: parts[0].toLowerCase(),
              localAddress: addr,
              localPort: parseInt(port),
              state: 'LISTENING',
              pid: parseInt(parts[6].split('=')[1])
            }
          })
      }
    },
    fedora: {
      command: 'ss -tulnp',
      shell: '/bin/sh',
      parser: (output: string) => {
        return output.split('\n')
          .filter(line => line.includes('LISTEN'))
          .map(line => {
            const parts = line.trim().split(/\s+/)
            const [addr, port] = parts[4].split(':')
            return {
              protocol: parts[0].toLowerCase(),
              localAddress: addr,
              localPort: parseInt(port),
              state: 'LISTENING',
              pid: parseInt(parts[6].split('=')[1])
            }
          })
      }
    }
  }

  const osType = os.toLowerCase()
  const command = osCommands[osType]

  if (!command) {
    throw new Error(`Unsupported OS type: ${osType}`)
  }

  try {
    const result = await libvirtMachine.qemuAgentCommand(JSON.stringify({
      execute: 'guest-exec',
      arguments: {
        path: command.shell,
        arg: command.shell === 'cmd.exe'
          ? ['/c', command.command]
          : ['-c', command.command],
        'capture-output': true
      }
    }), 30, 0)

    if (!result) {
      throw new Error('Failed to execute command in guest')
    }

    const rawResultObj = JSON.parse(result)
    const resultObj = rawResultObj.return
    if (!resultObj.pid) {
      throw new Error('No PID returned from guest command')
    }

    // Wait for the process to complete with a timeout
    let attempts = 0
    const maxAttempts = 10 // Maximum number of attempts (5 seconds total with 500ms delay)
    let statusObj

    while (attempts < maxAttempts) {
      const status = await libvirtMachine.qemuAgentCommand(JSON.stringify({
        execute: 'guest-exec-status',
        arguments: { pid: resultObj.pid }
      }), 30, 0)

      if (!status) {
        throw new Error('Failed to get command output from guest')
      }

      statusObj = JSON.parse(status).return
      if (statusObj.exited) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, 500)) // Wait 500ms before next attempt
      attempts++
    }

    if (!statusObj || !statusObj.exited) {
      throw new Error('Command did not complete within the timeout period')
    }

    if (statusObj.exitcode !== 0) {
      console.log('Command failed with exit code:', statusObj.exitcode)
      if (statusObj['err-data']) {
        console.log('Error output:', Buffer.from(statusObj['err-data'], 'base64').toString())
      }
      return []
    }

    if (!statusObj['out-data']) {
      return []
    }

    // Convert base64 output to string
    const outputStr = Buffer.from(statusObj['out-data'], 'base64').toString()

    let ports: PortInfo[]
    try {
      ports = command.parser(outputStr)
    } catch (parserError) {
      console.error(`Error parsing listening ports for OS ${osType}:`, parserError, 'Raw output:', outputStr)
      return []
    }
    return ports
  } catch (error) {
    console.error('Error getting listening ports for VM:', error)
    return []
  }
}

async function checkRunningService (prismaMachine: PrismaMachine, conn: Connection) {
  try {
    if (prismaMachine.status !== 'running') {
      return
    }

    const libvirtMachine = await LibvirtMachine.lookupByName(conn, prismaMachine.internalName)
    if (!libvirtMachine) {
      throw new Error(`Could not find libvirt machine for ${prismaMachine.internalName}`)
    }

    const listeningPorts = await getListeningPorts(libvirtMachine, prismaMachine.os)

    // Get all ports for this VM from database
    const dbPorts = await prisma.vmPort.findMany({
      where: { vmId: prismaMachine.id }
    })

    // Update running status for existing ports
    for (const dbPort of dbPorts) {
      const isRunning = listeningPorts.some(p =>
        p.protocol === dbPort.protocol &&
                p.localPort >= dbPort.portStart &&
                p.localPort <= dbPort.portEnd &&
                (p.localAddress === '0.0.0.0' || p.localAddress === '::')
      )

      if (isRunning !== dbPort.running) {
        await prisma.vmPort.update({
          where: { id: dbPort.id },
          data: {
            running: isRunning,
            lastSeen: isRunning ? new Date() : dbPort.lastSeen
          }
        })
      }
    }

    // Update ports in database
    for (const port of listeningPorts) {
      if (port.localAddress !== '0.0.0.0' && port.localAddress !== '::') {
        continue // Skip ports not listening on all interfaces
      }

      try {
        await prisma.vmPort.upsert({
          where: {
            vmId_portStart_protocol: {
              vmId: prismaMachine.id,
              portStart: port.localPort,
              protocol: port.protocol
            }
          },
          update: {
            running: true,
            lastSeen: new Date(),
            updatedAt: new Date()
          },
          create: {
            vmId: prismaMachine.id,
            portStart: port.localPort,
            portEnd: port.localPort,
            protocol: port.protocol,
            running: true,
            enabled: false,
            toEnable: false,
            lastSeen: new Date(),
            updatedAt: new Date(),
            createdAt: new Date()
          }
        })
      } catch (error) {
        console.error(`Error updating port ${port.localPort} for VM ${prismaMachine.id}:`, error)
      }
    }

    // Only mark ports as not running if we haven't seen them in this check
    // and the VM is running (we can trust the port status)
    await prisma.vmPort.updateMany({
      where: {
        vmId: prismaMachine.id,
        updatedAt: {
          lt: new Date(Date.now() - 60000) // Ports not seen in the last minute
        }
      },
      data: {
        running: false,
        updatedAt: new Date()
      }
    })

    libvirtMachine.free()
  } catch (error) {
    console.error(`Error checking running services for VM ${prismaMachine.id}:`, error)
  }
}

const CheckRunningServicesJob = new CronJob('*/1 * * * *', async () => {
  let conn: Connection | null = null
  try {
    conn = Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to open connection to libvirt')
    }
    // Get all VMs, not just running ones
    const vms = await prisma.machine.findMany()
    for (const vm of vms) {
      await checkRunningService(vm, conn)
    }
  } catch (error) {
    console.error('Error in CheckRunningServicesJob:', error)
  } finally {
    if (conn) {
      conn.close()
    }
  }
})

export default CheckRunningServicesJob
