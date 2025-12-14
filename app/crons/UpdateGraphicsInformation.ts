/**
 * UpdateGraphicsInformation Cron Job
 *
 * Periodically syncs graphics configuration between infinivirt and the database.
 * With infinivirt, graphics info is stored in MachineConfiguration during VM creation.
 * This cron verifies running VMs have valid graphics configuration.
 */
import { CronJob } from 'cron'
import { networkInterfaces } from 'systeminformation'
import prisma from '../utils/database'
import { getInfinivirt } from '../services/InfinivirtService'
import { Debugger } from '../utils/debug'

const debug = new Debugger('cron:update-graphics')

// Cache the local IP to avoid frequent lookups
let cachedLocalIP: string | null = null

async function getLocalIP (): Promise<string> {
  if (cachedLocalIP) return cachedLocalIP

  try {
    const networkData = await networkInterfaces()
    // Handle both single object and array cases
    const interfaces = Array.isArray(networkData) ? networkData : [networkData]

    // Look for the first non-internal IPv4 address
    for (const iface of interfaces) {
      if (!iface.internal && iface.ip4) {
        cachedLocalIP = iface.ip4
        return iface.ip4
      }
    }
    throw new Error('No suitable network interface found')
  } catch (err) {
    debug.log('error', `Error getting local IP: ${err}`)
    return '127.0.0.1' // Fallback to localhost
  }
}

const UpdateGraphicsInformationJob = new CronJob('*/1 * * * *', async () => {
  try {
    const infinivirt = await getInfinivirt()

    // Get all machines from database
    const machines = await prisma.machine.findMany({
      include: {
        configuration: true
      }
    })

    // Process each machine
    for (const machine of machines) {
      try {
        // Skip machines without configuration - they haven't been properly created yet
        if (!machine.configuration) {
          continue
        }

        const config = machine.configuration

        // Detect and log corrupted configurations (port -1 with protocol configured)
        // This indicates the cron previously overwrote a valid port
        if (config.graphicPort === -1 && config.graphicProtocol) {
          debug.log('warn', `Corrupted graphics config detected for ${machine.name}: port=-1 but protocol=${config.graphicProtocol}. This VM may need repair.`)
        }

        // Get VM status from infinivirt
        const status = await infinivirt.getVMStatus(machine.id)

        if (status.processAlive) {
          // VM is running - only update graphicHost if it's 0.0.0.0 or null
          // NEVER touch graphicPort, graphicProtocol, or graphicPassword
          // These are set during VM creation and must persist
          const storedHost = config.graphicHost
          if (!storedHost || storedHost === '0.0.0.0') {
            const newHost = await getLocalIP()
            await prisma.machineConfiguration.update({
              where: { id: config.id },
              data: {
                graphicHost: newHost
                // Explicitly NOT updating graphicPort, graphicProtocol, graphicPassword
              }
            })
            debug.log(`Updated graphicHost for running VM ${machine.name}: ${storedHost} -> ${newHost}`)
          }
        }
        // For stopped VMs: DO NOTHING
        // Graphics configuration (port, protocol, password) was set during VM creation
        // and must persist across power cycles. The port is statically assigned and
        // doesn't change when the VM stops.
      } catch (err) {
        debug.log('error', `Error processing machine ${machine.name}: ${err}`)
      }
    }
  } catch (err) {
    debug.log('error', `Error in UpdateGraphicsInformationJob: ${err}`)
  }
})

export default UpdateGraphicsInformationJob
