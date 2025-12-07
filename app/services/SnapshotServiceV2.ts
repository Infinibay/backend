/**
 * SnapshotServiceV2 - VM snapshot management using infinivirt.
 *
 * This service replaces the libvirt-based SnapshotService with
 * infinivirt's SnapshotManager, using qemu-img directly.
 *
 * Key differences from V1:
 * - Uses qemu-img instead of libvirt domain snapshots
 * - Works with qcow2 files directly
 * - VM must be stopped to create/revert snapshots (qemu-img limitation)
 * - No XML parsing required
 */

import { PrismaClient } from '@prisma/client'
import {
  SnapshotManager,
  SnapshotInfo as InfinivirtSnapshotInfo,
  SnapshotCreateOptions,
  StorageError
} from '@infinibay/infinivirt'
import path from 'path'
import fs from 'fs'

import { Debugger } from '@utils/debug'
import { getInfinivirt } from '@services/InfinivirtService'

/**
 * Snapshot information compatible with the original SnapshotService interface.
 */
export interface SnapshotInfo {
  name: string
  description?: string
  createdAt: Date
  state: string
  isCurrent: boolean
  parentName?: string
  /** Size in bytes (from qemu-img) */
  vmSize?: number
}

/**
 * Result of snapshot operations.
 */
export interface SnapshotResult {
  success: boolean
  message: string
  snapshot?: SnapshotInfo
}

/**
 * Result of listing snapshots.
 */
export interface SnapshotListResult {
  success: boolean
  snapshots: SnapshotInfo[]
  message?: string
}

/**
 * Service for managing VM snapshots using infinivirt's SnapshotManager.
 *
 * Note: Unlike libvirt snapshots, qemu-img snapshots require the VM to be stopped.
 * This service will check VM status before operations and return appropriate errors.
 */
export class SnapshotServiceV2 {
  private prisma: PrismaClient
  private debug: Debugger
  private snapshotManager: SnapshotManager

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = new Debugger('snapshot-service-v2')
    this.snapshotManager = new SnapshotManager()
  }

  /**
   * Creates a snapshot for a VM.
   *
   * @param vmId - VM UUID
   * @param name - Snapshot name (alphanumeric, hyphens, underscores only)
   * @param description - Optional description (stored in database, not in qcow2)
   * @returns SnapshotResult
   */
  async createSnapshot (
    vmId: string,
    name: string,
    description?: string
  ): Promise<SnapshotResult> {
    this.debug.log(`Creating snapshot '${name}' for VM ${vmId}`)

    try {
      // Get VM and validate status
      const vm = await this.getVMWithValidation(vmId)
      if (!vm) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Check if VM is stopped (required for qemu-img snapshots)
      if (vm.status !== 'off' && vm.status !== 'error') {
        return {
          success: false,
          message: 'VM must be stopped before creating a snapshot. Please shut down the VM first.'
        }
      }

      // Get disk path
      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) {
        return { success: false, message: `Disk image not found: ${diskPath}` }
      }

      // Create snapshot via SnapshotManager
      const options: SnapshotCreateOptions = {
        imagePath: diskPath,
        name,
        description
      }

      await this.snapshotManager.createSnapshot(options)

      this.debug.log(`Snapshot '${name}' created successfully`)

      // Store snapshot metadata in database (optional, for description tracking)
      await this.storeSnapshotMetadata(vmId, name, description)

      return {
        success: true,
        message: `Snapshot '${name}' created successfully`,
        snapshot: {
          name,
          description,
          createdAt: new Date(),
          state: 'shutoff',
          isCurrent: true
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Failed to create snapshot: ${error.message}`)

      if (error instanceof StorageError) {
        return { success: false, message: error.message }
      }

      return { success: false, message: `Failed to create snapshot: ${error.message}` }
    }
  }

  /**
   * Lists all snapshots for a VM.
   *
   * @param vmId - VM UUID
   * @returns SnapshotListResult
   */
  async listSnapshots (vmId: string): Promise<SnapshotListResult> {
    this.debug.log(`Listing snapshots for VM ${vmId}`)

    try {
      const vm = await this.getVM(vmId)
      if (!vm) {
        return { success: false, snapshots: [], message: `VM ${vmId} not found` }
      }

      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) {
        return { success: true, snapshots: [], message: 'No disk image found' }
      }

      // List snapshots via SnapshotManager
      const infinivirtSnapshots = await this.snapshotManager.listSnapshots(diskPath)

      // Get metadata from database for descriptions
      const metadataMap = await this.getSnapshotMetadataMap(vmId)

      // Convert to our interface
      const snapshots: SnapshotInfo[] = infinivirtSnapshots.map((snap, index) => {
        const metadata = metadataMap.get(snap.name)
        return {
          name: snap.name,
          description: metadata?.description,
          createdAt: snap.date ? new Date(snap.date) : new Date(),
          state: 'shutoff', // qemu-img snapshots are always from shutoff state
          isCurrent: index === infinivirtSnapshots.length - 1, // Last snapshot is "current"
          vmSize: snap.vmSize
        }
      })

      this.debug.log(`Found ${snapshots.length} snapshots for VM ${vmId}`)
      return { success: true, snapshots }
    } catch (error: any) {
      this.debug.log('error', `Failed to list snapshots: ${error.message}`)
      return { success: false, snapshots: [], message: error.message }
    }
  }

  /**
   * Restores a VM to a previous snapshot.
   *
   * @param vmId - VM UUID
   * @param snapshotName - Name of snapshot to restore
   * @returns SnapshotResult
   */
  async restoreSnapshot (
    vmId: string,
    snapshotName: string
  ): Promise<SnapshotResult> {
    this.debug.log(`Restoring VM ${vmId} to snapshot '${snapshotName}'`)

    try {
      // Get VM and validate status
      const vm = await this.getVMWithValidation(vmId)
      if (!vm) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Check if VM is stopped
      if (vm.status !== 'off' && vm.status !== 'error') {
        return {
          success: false,
          message: 'VM must be stopped before restoring a snapshot. Please shut down the VM first.'
        }
      }

      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) {
        return { success: false, message: `Disk image not found: ${diskPath}` }
      }

      // Verify snapshot exists
      const exists = await this.snapshotManager.snapshotExists(diskPath, snapshotName)
      if (!exists) {
        return { success: false, message: `Snapshot '${snapshotName}' not found` }
      }

      // Revert to snapshot
      await this.snapshotManager.revertSnapshot(diskPath, snapshotName)

      this.debug.log(`VM ${vmId} restored to snapshot '${snapshotName}'`)
      return {
        success: true,
        message: `Restored to snapshot '${snapshotName}' successfully`
      }
    } catch (error: any) {
      this.debug.log('error', `Failed to restore snapshot: ${error.message}`)

      if (error instanceof StorageError) {
        return { success: false, message: error.message }
      }

      return { success: false, message: `Failed to restore snapshot: ${error.message}` }
    }
  }

  /**
   * Deletes a snapshot from a VM.
   *
   * @param vmId - VM UUID
   * @param snapshotName - Name of snapshot to delete
   * @returns SnapshotResult
   */
  async deleteSnapshot (
    vmId: string,
    snapshotName: string
  ): Promise<SnapshotResult> {
    this.debug.log(`Deleting snapshot '${snapshotName}' from VM ${vmId}`)

    try {
      const vm = await this.getVM(vmId)
      if (!vm) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) {
        return { success: false, message: `Disk image not found: ${diskPath}` }
      }

      // Delete snapshot (handles non-existent gracefully)
      await this.snapshotManager.deleteSnapshot(diskPath, snapshotName)

      // Remove metadata from database
      await this.deleteSnapshotMetadata(vmId, snapshotName)

      this.debug.log(`Snapshot '${snapshotName}' deleted from VM ${vmId}`)
      return {
        success: true,
        message: `Snapshot '${snapshotName}' deleted successfully`
      }
    } catch (error: any) {
      this.debug.log('error', `Failed to delete snapshot: ${error.message}`)

      if (error instanceof StorageError) {
        return { success: false, message: error.message }
      }

      return { success: false, message: `Failed to delete snapshot: ${error.message}` }
    }
  }

  /**
   * Gets the current (most recent) snapshot for a VM.
   *
   * @param vmId - VM UUID
   * @returns SnapshotInfo or null
   */
  async getCurrentSnapshot (vmId: string): Promise<SnapshotInfo | null> {
    this.debug.log(`Getting current snapshot for VM ${vmId}`)

    try {
      const result = await this.listSnapshots(vmId)
      if (!result.success || result.snapshots.length === 0) {
        return null
      }

      // Return the last snapshot (most recent)
      return result.snapshots[result.snapshots.length - 1]
    } catch (error: any) {
      this.debug.log('error', `Failed to get current snapshot: ${error.message}`)
      return null
    }
  }

  /**
   * Checks if a snapshot exists for a VM.
   *
   * @param vmId - VM UUID
   * @param snapshotName - Snapshot name
   * @returns boolean
   */
  async snapshotExists (vmId: string, snapshotName: string): Promise<boolean> {
    try {
      const vm = await this.getVM(vmId)
      if (!vm) return false

      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) return false

      return await this.snapshotManager.snapshotExists(diskPath, snapshotName)
    } catch {
      return false
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Gets VM from database.
   */
  private async getVM (vmId: string) {
    return this.prisma.machine.findUnique({
      where: { id: vmId },
      select: {
        id: true,
        internalName: true,
        status: true
      }
    })
  }

  /**
   * Gets VM with validation that it exists.
   */
  private async getVMWithValidation (vmId: string) {
    const vm = await this.getVM(vmId)
    if (!vm) {
      this.debug.log('warn', `VM ${vmId} not found in database`)
    }
    return vm
  }

  /**
   * Gets the disk path for a VM.
   */
  private getDiskPath (internalName: string): string {
    const diskDir = process.env.INFINIVIRT_DISK_DIR ?? '/var/lib/infinivirt/disks'

    // Try common naming patterns
    const patterns = [
      `${internalName}.qcow2`,
      `${internalName}-main.qcow2`,
      `${internalName}-0.qcow2`
    ]

    for (const pattern of patterns) {
      const fullPath = path.join(diskDir, pattern)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
    }

    // Default to the base pattern
    return path.join(diskDir, `${internalName}.qcow2`)
  }

  /**
   * Stores snapshot metadata in database for description tracking.
   * Note: qemu-img doesn't store descriptions, so we track them separately.
   */
  private async storeSnapshotMetadata (
    vmId: string,
    name: string,
    description?: string
  ): Promise<void> {
    // Check if SnapshotMetadata table exists (optional feature)
    // For now, log only - can be extended to use a dedicated table
    if (description) {
      this.debug.log(`Snapshot metadata: VM=${vmId}, name=${name}, desc=${description}`)
    }
  }

  /**
   * Gets snapshot metadata map for a VM.
   */
  private async getSnapshotMetadataMap (
    vmId: string
  ): Promise<Map<string, { description?: string }>> {
    // Placeholder - can be extended to use a dedicated table
    return new Map()
  }

  /**
   * Deletes snapshot metadata from database.
   */
  private async deleteSnapshotMetadata (
    vmId: string,
    snapshotName: string
  ): Promise<void> {
    // Placeholder - can be extended to use a dedicated table
    this.debug.log(`Removed metadata for snapshot '${snapshotName}' of VM ${vmId}`)
  }
}

// Singleton instance
let snapshotServiceV2: SnapshotServiceV2 | null = null

/**
 * Gets the singleton SnapshotServiceV2 instance.
 *
 * @param prisma - PrismaClient instance
 * @returns SnapshotServiceV2 instance
 */
export const getSnapshotServiceV2 = (prisma: PrismaClient): SnapshotServiceV2 => {
  if (!snapshotServiceV2) {
    snapshotServiceV2 = new SnapshotServiceV2(prisma)
  }
  return snapshotServiceV2
}
