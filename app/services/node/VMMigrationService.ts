import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { calculateNodeCapacity } from './NodeCapacity'
import { MOVING_STATUS } from '../../constants/machine-status'

export interface VMStorageMigrationAdapter {
  prepareMachineStorage(params: {
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
const SHARED_STORAGE_VALUES = new Set(['1', 'true', 'yes'])

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

      // ── Relocate the disk (verified copy + I2 source reclaim) ─────────────────
      await this.prepareStorageForMigration({
        machineId,
        sourceNodeId,
        targetNodeId,
        diskPaths
      })

      // ── Commit the new owner + release the lock in one write ──────────────────
      await this.prisma.machine.update({
        where: { id: machineId },
        data: { nodeId: targetNodeId, status: priorStatus }
      })

      return {
        success: true,
        machineId,
        sourceNodeId,
        targetNodeId
      }
    } catch (err) {
      // Release the claim so a failed migration never strands the VM in 'moving'.
      await this.prisma.machine.updateMany({
        where: { id: machineId, status: MOVING_STATUS },
        data: { status: priorStatus }
      }).catch((e) => logger.error(`Migration ${machineId}: failed to roll back 'moving' status: ${String(e)}`))
      throw err
    }
  }

  private async prepareStorageForMigration (params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
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
    return SHARED_STORAGE_VALUES.has((process.env.INFINIBAY_SHARED_STORAGE || '').toLowerCase())
  }

  private parseDiskPaths (value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  }
}
