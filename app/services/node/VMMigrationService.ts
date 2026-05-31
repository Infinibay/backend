import { PrismaClient } from '@prisma/client'
import { calculateNodeCapacity } from './NodeCapacity'

export interface VMStorageMigrationAdapter {
  prepareMachineStorage(params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
  }): Promise<void>
}

export interface VMMigrationServiceOptions {
  storageMode?: 'shared' | 'external'
  storageAdapter?: VMStorageMigrationAdapter
}

export interface VMMigrationResult {
  success: boolean
  machineId: string
  sourceNodeId: string | null
  targetNodeId: string
  error?: string
}

const MIGRATABLE_STATUSES = new Set(['off', 'stopped', 'error'])
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

    if (!MIGRATABLE_STATUSES.has(machine.status)) {
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

    await this.prepareStorageForMigration({
      machineId,
      sourceNodeId: machine.nodeId,
      targetNodeId,
      diskPaths: this.parseDiskPaths(machine.configuration?.diskPaths)
    })

    await this.prisma.machine.update({
      where: { id: machineId },
      data: { nodeId: targetNodeId }
    })

    return {
      success: true,
      machineId,
      sourceNodeId: machine.nodeId,
      targetNodeId
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
