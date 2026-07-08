import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { VMMigrationService } from './VMMigrationService'
import { AgentStorageMigrationAdapter } from './AgentStorageMigrationAdapter'
import { NodeDispatcher } from './NodeDispatcher'
import { NodePlacementService } from './NodePlacementService'
import { VMOperationsService } from '../VMOperationsService'
import { getConfiguredStorageProvider } from '../storage'
import { isPowerActionLocked } from '../../constants/machine-status'

// A VM in one of these has no live/paused qemu and can be migrated as-is. Anything
// else that is NOT a lock marker (running/paused/suspended/starting/…) needs a
// power-off first. Mirrors VMMigrationService.MIGRATABLE_STATUSES.
const MIGRATABLE_STATUSES = new Set(['off', 'stopped', 'error'])

export interface DrainVmOutcome {
  machineId: string
  name: string
  targetNodeId?: string
  reason?: string
}

export interface NodeDrainResult {
  /** true = the node has no machines left (safe to remove). */
  drained: boolean
  /** true = running VMs are present but powering them off was not authorized. No side effects were performed. */
  needsConfirmation: boolean
  runningCount: number
  total: number
  migrated: DrainVmOutcome[]
  failed: DrainVmOutcome[]
}

/**
 * Evacuate every VM off a node before it is removed, so decommissioning a node never
 * orphans its VMs (Machine.nodeId is onDelete:SetNull — a deleted node would strand
 * them with their disk on a host that is gone). Each VM is cold-migrated to another
 * schedulable node (master preferred, most-free next) via the audited
 * VMMigrationService; running VMs are powered off first, but ONLY when the caller
 * authorizes it (stopRunning) — otherwise we report needsConfirmation and touch
 * nothing, so the UI can warn the operator that live VMs will be shut down.
 *
 * Called by deleteNode / rejectNode (never removes the node itself — the caller does
 * that only when drained === true).
 */
export class NodeDrainService {
  constructor (private readonly prisma: PrismaClient) {}

  async drainNode (nodeId: string, opts: { stopRunning?: boolean } = {}): Promise<NodeDrainResult> {
    const stopRunning = opts.stopRunning === true
    const machines = await this.prisma.machine.findMany({
      where: { nodeId },
      select: { id: true, name: true, status: true, cpuCores: true, ramGB: true, diskSizeGB: true }
    })

    const result: NodeDrainResult = {
      drained: machines.length === 0,
      needsConfirmation: false,
      runningCount: 0,
      total: machines.length,
      migrated: [],
      failed: []
    }
    if (machines.length === 0) return result

    // A VM that is neither a lock marker (backup/restore/snapshot/other-migration/
    // delete) nor already stopped is live — it needs a power-off before its disk can
    // be moved. Count those to drive the confirmation gate.
    const isLive = (status: string): boolean => !isPowerActionLocked(status) && !MIGRATABLE_STATUSES.has(status)
    result.runningCount = machines.filter(m => isLive(m.status)).length

    // Fail closed on the destructive power-off: if any VM is live and the caller did
    // not authorize shutting them down, perform NO side effects (no maintenance flip,
    // no migration) and ask for confirmation. The UI turns this into an explicit
    // "these VMs will be powered off + migrated — proceed?" prompt.
    if (result.runningCount > 0 && !stopRunning) {
      result.needsConfirmation = true
      return result
    }

    // Take the node out of scheduling for the whole drain so no NEW VM lands on it
    // while we evacuate, and so placement can never pick it as a migration target.
    await this.prisma.node.update({ where: { id: nodeId }, data: { maintenanceMode: true } })

    // Migration machinery — built once, mirrors machine/resolver.migrateMachineToNode.
    const sharedStorage = (await getConfiguredStorageProvider(this.prisma)).isShared()
    const livenessProbe = new NodeDispatcher(this.prisma)
    const migrationService = sharedStorage
      ? new VMMigrationService(this.prisma, { storageMode: 'shared', livenessProbe })
      : new VMMigrationService(this.prisma, { storageAdapter: new AgentStorageMigrationAdapter(this.prisma), livenessProbe })
    const placement = new NodePlacementService(this.prisma)
    const vmOps = new VMOperationsService(this.prisma)

    // Evacuate one VM at a time (a disk copy is heavy; serial keeps the source host
    // from being hammered). A per-VM failure is collected, never aborts the whole
    // drain — one un-movable VM should not block evacuating the rest.
    for (const m of machines) {
      try {
        if (isPowerActionLocked(m.status)) {
          throw new Error(`busy (${m.status}) — a backup/restore/snapshot/migration/delete is in progress; retry once it finishes`)
        }

        if (!MIGRATABLE_STATUSES.has(m.status)) {
          // Live VM, and stopRunning was authorized (verified above). Graceful ACPI
          // with a forced fallback, then confirm the row actually reached a stopped
          // state before handing it to the migration (which refuses a live qemu).
          logger.info(`Drain ${nodeId}: powering off '${m.name}' (${m.status}) before migration`)
          const off = await vmOps.gracefulPowerOff(m.id)
          if (!off.success) throw new Error(`could not power off: ${off.error ?? 'unknown error'}`)
          const after = await this.prisma.machine.findUnique({ where: { id: m.id }, select: { status: true } })
          if (!after || !MIGRATABLE_STATUSES.has(after.status)) {
            throw new Error(`did not reach a stopped state after power-off (status=${after?.status ?? 'gone'})`)
          }
        }

        const target = await placement.chooseNodeForMachine(
          { cpuCores: m.cpuCores, ramGB: m.ramGB, diskSizeGB: m.diskSizeGB },
          nodeId
        )
        if (!target) throw new Error('no other node has enough free CPU/RAM to receive it')

        await migrationService.migrateStoppedMachineToNode(m.id, target)
        result.migrated.push({ machineId: m.id, name: m.name, targetNodeId: target })
        logger.info(`Drain ${nodeId}: migrated '${m.name}' → node ${target}`)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        result.failed.push({ machineId: m.id, name: m.name, reason })
        logger.error(`Drain ${nodeId}: could not evacuate '${m.name}' (${m.id}): ${reason}`)
      }
    }

    // Safe to remove the node only if every VM left it.
    result.drained = result.failed.length === 0
    return result
  }
}
