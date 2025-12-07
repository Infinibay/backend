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
        // Get VM status from infinivirt
        const status = await infinivirt.getVMStatus(machine.id)

        // Default values for non-running VMs
        let graphicPort = -1
        let graphicProtocol: string | null = null
        let graphicPassword: string | null = null
        let graphicHost: string | null = null

        if (status.processAlive) {
          // VM is running - use configuration from DB (set during createVM)
          // Just verify and update host if needed
          if (machine.configuration) {
            graphicPort = machine.configuration.graphicPort ?? -1
            graphicProtocol = machine.configuration.graphicProtocol ?? 'spice'
            graphicPassword = machine.configuration.graphicPassword ?? null

            // If host is 0.0.0.0 or not set, use local IP
            const storedHost = machine.configuration.graphicHost
            if (!storedHost || storedHost === '0.0.0.0') {
              graphicHost = await getLocalIP()
            } else {
              graphicHost = storedHost
            }
          }
        }

        // Update or create machine configuration
        if (machine.configuration) {
          // Only update if there are changes
          const config = machine.configuration
          const needsUpdate =
            config.graphicPort !== graphicPort ||
            config.graphicHost !== graphicHost

          if (needsUpdate) {
            await prisma.machineConfiguration.update({
              where: { id: machine.configuration.id },
              data: {
                graphicPort,
                graphicHost
                // Don't update protocol/password - those are set during creation
              }
            })
            debug.log(`Updated graphics for ${machine.name}: port=${graphicPort}, host=${graphicHost}`)
          }
        } else if (status.processAlive) {
          // Running VM without configuration - create one
          await prisma.machineConfiguration.create({
            data: {
              machineId: machine.id,
              graphicPort,
              graphicProtocol: 'spice',
              graphicPassword: null,
              graphicHost: await getLocalIP()
            }
          })
          debug.log(`Created graphics config for ${machine.name}`)
        }
      } catch (err) {
        debug.log('error', `Error processing machine ${machine.name}: ${err}`)
      }
    }
  } catch (err) {
    debug.log('error', `Error in UpdateGraphicsInformationJob: ${err}`)
  }
})

export default UpdateGraphicsInformationJob
