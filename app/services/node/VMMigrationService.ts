import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { calculateNodeCapacity } from './NodeCapacity'
import { MOVING_STATUS, OFF_STATUS } from '../../constants/machine-status'
import { getStorageProviderFromEnv } from '@services/storage'

export interface VMStorageMigrationAdapter {
  prepareMachineStorage(params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
    // When true, copy + checksum-verify the disk(s) onto the target but DO NOT
    // delete the source yet — the caller reclaims it via reclaimSourceStorage
    // strictly AFTER the Machine.nodeId ownership commit is durable. This keeps
    // the only destructive step from running before the commit, so a failed or
    // interrupted commit can never strand the VM pointing at a node whose disk
    // was already deleted. Adapters predating this flag ignore it (legacy: they
    // still delete inside prepareMachineStorage and omit reclaimSourceStorage).
    deferReclaim?: boolean
  }): Promise<void>
  /**
   * Best-effort reclaim (delete) of the now-migrated source disk(s), invoked by
   * migrateStoppedMachineToNode ONLY after the ownership commit succeeds. Must be
   * a no-op when source and target resolve to the same physical store. Optional:
   * legacy adapters that still delete inside prepareMachineStorage omit it, and
   * the service falls back to the pre-commit delete (deferReclaim stays false).
   */
  reclaimSourceStorage?(params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
  }): Promise<void>
}

/**
 * Minimal liveness probe: resolve the executor that OWNS a machine (the source
 * node, since nodeId is not flipped until the copy succeeds) and read its real
 * power state. NodeDispatcher satisfies this structurally; injected so migration
 * can refuse to relocate a disk out from under a live qemu (a 'stopped'/'error'
 * DB row can still have a running process — split-brain / corruption otherwise).
 */
export interface MigrationLivenessProbe {
  executorFor(machineId: string): Promise<{ getVMStatus(machineId: string): Promise<{ processAlive?: boolean }> }>
}

export interface VMMigrationServiceOptions {
  storageMode?: 'shared' | 'external'
  storageAdapter?: VMStorageMigrationAdapter
  /** Used to verify the VM is genuinely powered off on the source before moving its disk. */
  livenessProbe?: MigrationLivenessProbe
}

export interface VMMigrationResult {
  success: boolean
  machineId: string
  sourceNodeId: string | null
  targetNodeId: string
  error?: string
}

const MIGRATABLE_STATUSES = ['off', 'stopped', 'error']

export class VMMigrationService {
  constructor (
    private readonly prisma: PrismaClient,
    private readonly options: VMMigrationServiceOptions = {}
  ) {}

  async migrateStoppedMachineToNode (machineId: string, targetNodeId: string): Promise<VMMigrationResult> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        configuration: {
          select: {
            diskPaths: true
          }
        }
      }
    })

    if (!machine) {
      throw new Error('VM not found')
    }

    if (!MIGRATABLE_STATUSES.includes(machine.status)) {
      throw new Error('Only stopped VMs can be migrated between nodes right now')
    }

    if (machine.nodeId === targetNodeId) {
      return {
        success: true,
        machineId,
        sourceNodeId: machine.nodeId,
        targetNodeId
      }
    }

    const targetNode = await this.prisma.node.findUnique({
      where: { id: targetNodeId },
      include: {
        machines: {
          select: {
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      }
    })

    if (!targetNode) {
      throw new Error('Target node not found')
    }

    if (targetNode.maintenanceMode) {
      throw new Error('Target node is in maintenance mode')
    }

    const capacity = calculateNodeCapacity(targetNode)

    if (capacity.health === 'stale') {
      throw new Error('Target node is stale')
    }

    if (capacity.availableCores < machine.cpuCores || capacity.availableRamGB < machine.ramGB) {
      throw new Error('Target node does not have enough available CPU or memory')
    }

    const sourceNodeId = machine.nodeId
    const priorStatus = machine.status
    const diskPaths = this.parseDiskPaths(machine.configuration?.diskPaths)

    // ── Atomic claim ('moving' status-as-lock) ───────────────────────────────
    // Flip the row to 'moving' ONLY if it is still in a migratable state AND still
    // owned by the same source node. This serializes concurrent migrations of the
    // same VM (a second one sees count 0 and bails) and — because power-on paths
    // refuse 'moving' (isPowerActionLocked) — blocks a concurrent power-on from
    // launching qemu on the source while we copy/delete its disk. The prior status
    // is restored on success AND rollback so the VM never gets stuck in 'moving'.
    const claim = await this.prisma.machine.updateMany({
      where: { id: machineId, status: { in: MIGRATABLE_STATUSES }, nodeId: sourceNodeId },
      data: { status: MOVING_STATUS }
    })
    if (claim.count !== 1) {
      throw new Error('VM is busy or no longer in a migratable state (another migration or power operation is in progress)')
    }

    try {
      // ── Liveness ────────────────────────────────────────────────────────────
      // The DB status can lag reality (e.g. an 'error' row left by a failed create
      // whose qemu is still alive). Confirm the source process is actually dead
      // before relocating + deleting its disk — otherwise we copy a live qcow2 and
      // unlink it out from under the running process (corruption / split-brain).
      if (this.options.livenessProbe) {
        const executor = await this.options.livenessProbe.executorFor(machineId)
        const state = await executor.getVMStatus(machineId)
        if (state?.processAlive === true) {
          throw new Error('Refusing to migrate: the VM process is still alive on the source node. Power it off first.')
        }
      }

      // ── Relocate the disk (verified copy; source reclaim deferred) ────────────
      // Copy + checksum-verify every disk onto the target but keep the source
      // INTACT for now (when the adapter supports a separate reclaim step). The
      // destructive source delete must happen strictly after the nodeId commit
      // below — otherwise a failed/interrupted commit leaves the disk on the
      // target, the source copy deleted, and the DB still pointing at the source
      // node (VM un-startable, real copy orphaned). A commit failure at this
      // point is safely retryable because no disk has been destroyed yet.
      const deferReclaim = typeof this.options.storageAdapter?.reclaimSourceStorage === 'function'
      await this.prepareStorageForMigration({
        machineId,
        sourceNodeId,
        targetNodeId,
        diskPaths,
        deferReclaim
      })

      // ── Commit the new owner + release the lock in one GUARDED write ──────────
      // Guard the commit on OUR claim still holding (status='moving' AND nodeId
      // unchanged). If a concurrent stop/power/delete path cleared or stole the
      // 'moving' marker while we were copying (audit C2/C3/C4 — stop() resets it to
      // 'off', destroy flips it to 'deleting'), count!=1 and we ABORT here — BEFORE
      // the destructive source reclaim below. That leaves the source disk intact and
      // the DB owner unchanged; the verified target copy becomes a sweepable leak,
      // never a split-brain/double-owner or a disk deleted out from under a VM whose
      // lock we no longer hold. A plain unconditional update() could not detect this.
      const committed = await this.prisma.machine.updateMany({
        where: { id: machineId, status: MOVING_STATUS, nodeId: sourceNodeId },
        data: { nodeId: targetNodeId, status: priorStatus }
      })
      if (committed.count !== 1) {
        throw new Error(
          'Migration aborted: the VM lock was released by a concurrent power/delete operation during the disk copy. ' +
          'The source disk is intact and ownership is unchanged (retry the migration); the target copy will be reclaimed by the storage sweeper.'
        )
      }

      // ── I2 source reclaim ─────────────────────────────────────────────────────
      // Delete the source disk(s) ONLY now that ownership is durably committed to
      // the target. Best-effort: a surviving source is a storage leak to sweep
      // later, never a reason to fail an already-committed migration (and never a
      // reason to re-lock the row). Legacy adapters without reclaimSourceStorage
      // already deleted inside prepareMachineStorage above — deferReclaim is false
      // and this is skipped, preserving their behaviour exactly.
      if (deferReclaim) {
        await this.options.storageAdapter!.reclaimSourceStorage!({
          machineId,
          sourceNodeId,
          targetNodeId,
          diskPaths
        }).catch((e) => logger.error(`Migration ${machineId}: source storage reclaim FAILED (disk leaked on source — reclaim manually, audit C5): ${String(e)}`))
      }

      return {
        success: true,
        machineId,
        sourceNodeId,
        targetNodeId
      }
    } catch (err) {
      // Release the claim so a failed migration never strands the VM in 'moving'.
      // Retry the release: the original failure may be a transient DB blip that would
      // also fail a single rollback write (audit C1), which would strand the VM in
      // 'moving' — un-startable until a backend restart. The periodic reconcile
      // (reconcileOrphanedMoveMarkers on a timer) is the ultimate backstop.
      await this.releaseMovingClaim(machineId, priorStatus)
      throw err
    }
  }

  /**
   * Best-effort release of the 'moving' status-as-lock back to priorStatus, retried
   * a few times so a single transient DB error on the rollback write does not strand
   * the VM in 'moving' (audit C1). Guarded on status=MOVING so it never clobbers a
   * status another operation legitimately set after our claim was already released.
   */
  private async releaseMovingClaim (machineId: string, priorStatus: string): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.prisma.machine.updateMany({
          where: { id: machineId, status: MOVING_STATUS },
          data: { status: priorStatus }
        })
        return
      } catch (e) {
        logger.error(`Migration ${machineId}: rollback of 'moving' status failed (attempt ${attempt}/4): ${String(e)}`)
        if (attempt < 4) await new Promise((r) => setTimeout(r, 250 * attempt))
      }
    }
    logger.error(`Migration ${machineId}: could NOT release 'moving' lock after retries — the periodic reconcile will reset it`)
  }

  private async prepareStorageForMigration (params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
    deferReclaim?: boolean
  }): Promise<void> {
    if (this.options.storageAdapter) {
      await this.options.storageAdapter.prepareMachineStorage(params)
      return
    }

    if (this.isSharedStorageEnabled()) return

    throw new Error(
      'VM storage migration is not configured. Enable shared storage with INFINIBAY_SHARED_STORAGE=true or provide a storage migration adapter before migrating VMs between nodes.'
    )
  }

  private isSharedStorageEnabled (): boolean {
    if (this.options.storageMode === 'shared') return true
    if (this.options.storageMode === 'external') return false
    // Source shared-ness through the StorageProvider abstraction (env-configured)
    // instead of re-reading INFINIBAY_SHARED_STORAGE directly. See
    // app/services/storage + lxd/docs/setup-system/03-storage-provider-scaffolding.md.
    return getStorageProviderFromEnv().isShared()
  }

  private parseDiskPaths (value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  }
}

/**
 * Startup reaper for the 'moving' status-as-lock — the migration mirror of
 * reconcileOrphanedDiskOpMarkers. A cold cross-node migration claims the VM row
 * by flipping status → 'moving' for the duration of the disk copy (which can
 * legitimately run up to ~1h). The claim is released only by migrate()'s success
 * path or its catch rollback; if the master process is killed / restarted / OOMs
 * mid-copy, NEITHER runs and the row is left STUCK in 'moving' forever. Every
 * power-on and re-migrate path refuses 'moving' (isPowerActionLocked), so the VM
 * becomes permanently unusable with no live copy still holding the lock.
 *
 * On a fresh boot the in-process migration that set the marker is gone (the
 * master is the sole migration orchestrator — nodes never coordinate peer-to-
 * peer), so no copy can still be in flight. The row's nodeId is still the source
 * (only committed to the target on success) and the source disk is reclaimed
 * strictly AFTER that commit (I2 / deferReclaim), so resetting to 'off' leaves a
 * clean, retryable state. Errors are logged and swallowed so startup never
 * blocks. Intended to be wired into InfinizationService startup right after
 * reconcileOrphanedDiskOpMarkers.
 *
 * @returns the count of rows reset (for logging/tests)
 */
export async function reconcileOrphanedMoveMarkers (prisma: PrismaClient): Promise<number> {
  try {
    const stuck = await prisma.machine.findMany({
      where: { status: MOVING_STATUS },
      select: { id: true, name: true, status: true }
    })

    if (stuck.length === 0) {
      return 0
    }

    for (const vm of stuck) {
      logger.warn(
        `🔧 VM ${vm.name} (${vm.id}) left in transient migration status '${vm.status}' ` +
        `by a crash — resetting to '${OFF_STATUS}' (migration can be retried)`
      )
    }

    const result = await prisma.machine.updateMany({
      where: { status: MOVING_STATUS },
      data: { status: OFF_STATUS }
    })

    logger.info(`🔧 Migration marker reconcile: reset ${result.count} orphaned VM(s) to '${OFF_STATUS}'`)
    return result.count
  } catch (error) {
    logger.error('❌ Migration marker reconciliation failed:', error)
    return 0
  }
}
