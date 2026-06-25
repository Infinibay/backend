/**
 * UpdateVmStatus Cron Job
 *
 * Periodically checks VM status and updates the database.
 * Uses infinization for process status verification instead of libvirt.
 */
import logger from '@main/logger'
import { CronJob } from 'cron'
import { StateSync, isValidQMPStatus } from '@infinibay/infinization'
import type { DatabaseAdapter, DBVMStatus, QMPVMStatus } from '@infinibay/infinization'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'
import { getVMHealthQueueManager } from '../services/VMHealthQueueManager'
import { getInfinization } from '../services/InfinizationService'

const debug = logger.child({ module: 'cron:update-vm-status' })

// mapQMPStatusToDBStatus() is pure (no DB access), so a no-op adapter is safe
// here. This guarantees the fallback cron maps QMP run-states EXACTLY as the
// QMP-event-driven path does (StateSync.QMP_TO_DB_STATUS_MAP).
const statusMapper = new StateSync({} as DatabaseAdapter)

/**
 * Probe result for a single VM. `qmpStatus` is the raw QEMU run-state
 * ('running' | 'paused' | 'suspended' | ...) when QMP could be queried, or null
 * when the process is dead or QMP was unreachable. `processAlive` is the coarse
 * liveness signal (PID exists and is alive).
 */
export interface VMProbe {
  qmpStatus: QMPVMStatus | null
  processAlive: boolean
}

/**
 * Gets the run-state of all VMs using infinization.
 * Returns a map of machineId -> VMProbe (raw QMP run-state + process liveness).
 */
async function getVMStatuses (machineIds: string[]): Promise<Map<string, VMProbe>> {
  const statuses = new Map<string, VMProbe>()

  try {
    const infinization = await getInfinization()

    // Check status for each VM
    await Promise.all(machineIds.map(async (id) => {
      try {
        const status = await infinization.getVMStatus(id)
        const raw = status.qmpStatus
        const qmpStatus = (raw && isValidQMPStatus(raw)) ? raw : null
        statuses.set(id, { qmpStatus, processAlive: status.processAlive })
      } catch {
        // If we can't get status, assume not running and no run-state info.
        statuses.set(id, { qmpStatus: null, processAlive: false })
      }
    }))
  } catch (error) {
    debug.error(`Failed to get VM statuses: ${error}`)
  }

  return statuses
}

// In-flight transitional DB states are owned by VMLifecycle/QMP events. The
// fallback cron must never override them or it would race the legitimate
// transition path.
const TRANSITIONAL_STATES = new Set([
  'starting',
  'updating_hardware',
  'powering_off_update'
])

/**
 * Classifies VMs into the status buckets the fallback cron will write, from the
 * real QMP run-state. Pure (no I/O) so the reconciliation rules are unit-testable.
 *
 * Rules: skip transitional states; map qmpStatus through the SAME map the QMP-event
 * path uses; a live process with no run-state is left as-is (no promote/demote); a
 * dead process is 'off'. A paused VM maps to 'suspended' (never 'running'), and a
 * live-but-paused VM is never demoted to 'off'.
 */
export function classifyVmStatuses (
  allVms: Array<{ id: string, status: string }>,
  vmStatuses: Map<string, VMProbe>,
  mapper: Pick<StateSync, 'mapQMPStatusToDBStatus'>
): { runningVmIds: string[], stoppedVmIds: string[], suspendedVmIds: string[] } {
  const runningVmIds: string[] = []
  const stoppedVmIds: string[] = []
  const suspendedVmIds: string[] = []

  for (const vm of allVms) {
    const probe = vmStatuses.get(vm.id) ?? { qmpStatus: null, processAlive: false }

    if (TRANSITIONAL_STATES.has(vm.status)) {
      continue
    }

    let desired: DBVMStatus | null
    if (probe.qmpStatus) {
      desired = mapper.mapQMPStatusToDBStatus(probe.qmpStatus)
    } else if (probe.processAlive) {
      // Process alive but QMP unreachable: cannot prove it changed state.
      desired = null
    } else {
      desired = 'off'
    }

    if (desired === null || desired === vm.status) {
      continue
    }

    if (desired === 'running') {
      // A genuinely paused VM maps to 'suspended' (never 'running'), so it can't
      // be promoted here.
      runningVmIds.push(vm.id)
    } else if (desired === 'suspended') {
      // Reflect paused/suspended, but only from a live state so we never resurrect
      // an 'off'/'error' row.
      if (vm.status === 'running') {
        suspendedVmIds.push(vm.id)
      }
    } else if (desired === 'off') {
      // Demote to 'off' ONLY from a previously-live state. When the process is
      // alive, desired is 'running'/'suspended', not 'off', so a live-but-paused
      // VM is never demoted here.
      if (vm.status === 'running' || vm.status === 'suspended') {
        stoppedVmIds.push(vm.id)
      }
    }
    // 'error' and other mapped targets are left to the QMP-event/health path.
  }

  return { runningVmIds, stoppedVmIds, suspendedVmIds }
}

// Run every 5 minutes as a fallback safety net.
// Primary status updates now come from QMP events via InfinizationService.
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

    // Get actual running status from infinization
    const vmStatuses = await getVMStatuses(allVms.map(vm => vm.id))

    // Classify VMs into the buckets to write, from the real QMP run-state.
    const { runningVmIds, stoppedVmIds, suspendedVmIds } = classifyVmStatuses(allVms, vmStatuses, statusMapper)

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
            debug.debug(`VM status update: ${vm.name} (${vmId}) -> running`)

            // Trigger queue processing for newly running VM
            try {
              await queueManager.processQueue(vmId)
            } catch (error) {
              debug.error(`Failed to process health queue for newly running VM ${vm.name} (${vmId}): ${error}`)
            }
          }
        } catch (error) {
          debug.error(`Failed to emit update event for VM ${vmId}: ${error}`)
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
            debug.debug(`VM status update: ${vm.name} (${vmId}) -> off`)
          }
        } catch (error) {
          debug.error(`Failed to emit update event for VM ${vmId}: ${error}`)
        }
      }
    }

    // Update suspended/paused VMs (QMP 'paused' maps to DB 'suspended')
    if (suspendedVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: suspendedVmIds } },
        data: { status: 'suspended' }
      })

      for (const vmId of suspendedVmIds) {
        try {
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
            debug.debug(`VM status update: ${vm.name} (${vmId}) -> suspended`)
          }
        } catch (error) {
          debug.error(`Failed to emit update event for VM ${vmId}: ${error}`)
        }
      }
    }
  } catch (error) {
    debug.error(`Error in UpdateVmStatusJob: ${error}`)
  }
})

export default UpdateVmStatusJob
