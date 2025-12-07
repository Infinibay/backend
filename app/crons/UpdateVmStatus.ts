/**
 * UpdateVmStatus Cron Job
 *
 * Periodically checks VM status and updates the database.
 * Uses infinivirt for process status verification instead of libvirt.
 */
import { CronJob } from 'cron'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'
import { getVMHealthQueueManager } from '../services/VMHealthQueueManager'
import { getInfinivirt } from '../services/InfinivirtService'
import { Debugger } from '../utils/debug'

const debug = new Debugger('cron:update-vm-status')

/**
 * Gets the running status of all VMs using infinivirt.
 * Returns a map of machineId -> isRunning
 */
async function getVMStatuses (machineIds: string[]): Promise<Map<string, boolean>> {
  const statuses = new Map<string, boolean>()

  try {
    const infinivirt = await getInfinivirt()

    // Check status for each VM
    await Promise.all(machineIds.map(async (id) => {
      try {
        const status = await infinivirt.getVMStatus(id)
        statuses.set(id, status.processAlive)
      } catch {
        // If we can't get status, assume not running
        statuses.set(id, false)
      }
    }))
  } catch (error) {
    debug.log('error', `Failed to get VM statuses: ${error}`)
  }

  return statuses
}

// Run every 5 minutes as a fallback safety net.
// Primary status updates now come from QMP events via InfinivirtService.
const UpdateVmStatusJob = new CronJob('*/5 * * * *', async () => {
  try {
    // Get singleton instances
    const eventManager = getEventManager()
    const queueManager = getVMHealthQueueManager(prisma, eventManager)

    // Get all VMs from database
    const allVms = await prisma.machine.findMany({
      select: {
        id: true,
        internalName: true,
        status: true
      }
    })

    if (allVms.length === 0) {
      return
    }

    // Get actual running status from infinivirt
    const vmStatuses = await getVMStatuses(allVms.map(vm => vm.id))

    // Find VMs that need status updates
    const runningVmIds: string[] = []
    const stoppedVmIds: string[] = []

    for (const vm of allVms) {
      const isActuallyRunning = vmStatuses.get(vm.id) ?? false

      if (isActuallyRunning && vm.status !== 'running') {
        runningVmIds.push(vm.id)
      } else if (!isActuallyRunning && vm.status === 'running') {
        // Only mark as stopped if it was running
        // Don't change building, error, etc. states
        stoppedVmIds.push(vm.id)
      }
    }

    // Update running VMs
    if (runningVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: runningVmIds } },
        data: { status: 'running' }
      })

      // Emit update events for each VM that became running
      for (const vmId of runningVmIds) {
        try {
          // Fetch complete VM data to send in the event
          const vm = await prisma.machine.findUnique({
            where: { id: vmId },
            include: {
              user: true,
              template: true,
              department: true,
              configuration: true
            }
          })
          if (vm) {
            await eventManager.dispatchEvent('vms', 'update', vm)
            debug.log(`VM status update: ${vm.name} (${vmId}) -> running`)

            // Trigger queue processing for newly running VM
            try {
              await queueManager.processQueue(vmId)
            } catch (error) {
              debug.log('error', `Failed to process health queue for newly running VM ${vm.name} (${vmId}): ${error}`)
            }
          }
        } catch (error) {
          debug.log('error', `Failed to emit update event for VM ${vmId}: ${error}`)
        }
      }
    }

    // Update stopped VMs
    if (stoppedVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: stoppedVmIds } },
        data: { status: 'off' }
      })

      // Emit update events for each VM that became stopped
      for (const vmId of stoppedVmIds) {
        try {
          // Fetch complete VM data to send in the event
          const vm = await prisma.machine.findUnique({
            where: { id: vmId },
            include: {
              user: true,
              template: true,
              department: true,
              configuration: true
            }
          })
          if (vm) {
            await eventManager.dispatchEvent('vms', 'update', vm)
            debug.log(`VM status update: ${vm.name} (${vmId}) -> off`)
          }
        } catch (error) {
          debug.log('error', `Failed to emit update event for VM ${vmId}: ${error}`)
        }
      }
    }
  } catch (error) {
    debug.log('error', `Error in UpdateVmStatusJob: ${error}`)
  }
})

export default UpdateVmStatusJob
