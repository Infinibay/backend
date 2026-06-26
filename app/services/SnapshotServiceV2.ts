/**
 * SnapshotServiceV2 - VM snapshot management using infinization.
 *
 * This service replaces the libvirt-based SnapshotService with
 * infinization's SnapshotManager, using qemu-img directly.
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
  SnapshotInfo as InfinizationSnapshotInfo,
  SnapshotCreateOptions,
  StorageError
} from '@infinibay/infinization'
import path from 'path'
import fs from 'fs'

import { Logger } from 'winston'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'
import { assertVmStopped } from '@utils/assertVmStopped'
import {
  OFF_STATUS,
  ERROR_STATUS,
  SNAPSHOTTING_STATUS,
  RESTORING_STATUS
} from '../constants/machine-status'

/**
 * Snapshot information compatible with the original SnapshotService interface.
 */
export interface SnapshotInfo {
  name: string
  /** Always undefined: qemu-img internal snapshots store no description. Would require a future Snapshot DB model. */
  description?: string
  createdAt: Date
  state: string
  /** qemu-img has no current/active-snapshot concept for an offline qcow2; always false. */
  isCurrent: boolean
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
 * Service for managing VM snapshots using infinization's SnapshotManager.
 *
 * Note: Unlike libvirt snapshots, qemu-img snapshots require the VM to be stopped.
 * This service will check VM status before operations and return appropriate errors.
 */
export class SnapshotServiceV2 {
  private prisma: PrismaClient
  private debug: Logger
  private snapshotManager: SnapshotManager

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'snapshot-service-v2' })
    this.snapshotManager = new SnapshotManager()
  }

  /**
   * Creates a snapshot for a VM.
   *
   * @param vmId - VM UUID
   * @param name - Snapshot name (alphanumeric, hyphens, underscores only)
   * @param description - Currently NOT persisted: qemu-img has no description
   *   support and there is no Snapshot DB model, so this is only logged. Kept for
   *   forward-compat; will require a dedicated Snapshot model to actually store.
   * @returns SnapshotResult
   */
  async createSnapshot (
    vmId: string,
    name: string,
    description?: string
  ): Promise<SnapshotResult> {
    this.debug.debug(`Creating snapshot '${name}' for VM ${vmId}`)

    try {
      // Get VM and validate status
      const vm = await this.getVMWithValidation(vmId)
      if (!vm) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Check if VM is stopped (required for qemu-img snapshots).
      // The DB column is a cheap early-out; the authoritative gate is the live
      // process probe below (the DB status can be stale).
      if (vm.status !== 'off' && vm.status !== 'error') {
        return {
          success: false,
          message: 'VM must be stopped before creating a snapshot. Please shut down the VM first.'
        }
      }

      // ── Atomic claim (audit H1) ────────────────────────────────────────────
      // Flip the STOPPED VM row to SNAPSHOTTING in a single conditional
      // updateMany. This is the durable cross-service lock that closes the TOCTOU
      // on assertVmStopped: a concurrent powerOn refuses a row in a disk-op
      // marker, and a second backup/restore/snapshot sees count !== 1 and bails.
      const claimed = await this.prisma.machine.updateMany({
        where: { id: vmId, status: { in: [OFF_STATUS, ERROR_STATUS] } },
        data: { status: SNAPSHOTTING_STATUS }
      })
      if (claimed.count !== 1) {
        return {
          success: false,
          message: 'VM is busy or not stopped — cannot create a snapshot. Ensure the VM is OFF and no other backup/restore/snapshot is in progress.'
        }
      }

      try {
        // Authoritative fail-closed gate against the live process (qcow2 write
        // lock). Re-probe AFTER the claim, to catch a power-on that slipped in
        // just before it.
        await assertVmStopped(this.prisma, vmId)

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

        this.debug.debug(`Snapshot '${name}' created successfully`)

        return {
          success: true,
          message: `Snapshot '${name}' created successfully`,
          snapshot: {
            name,
            // qemu-img persists neither a description nor a current-snapshot flag,
            // so we don't echo back values that won't survive a subsequent list.
            description: undefined,
            createdAt: new Date(),
            state: 'shutoff',
            isCurrent: false
          }
        }
      } finally {
        // Release the SNAPSHOTTING claim on every exit (success, disk-not-found
        // early return, qemu-img throw). Flip back to OFF only if we still hold
        // the marker, so we never clobber a status another flow moved on to.
        await this.prisma.machine.updateMany({
          where: { id: vmId, status: SNAPSHOTTING_STATUS },
          data: { status: OFF_STATUS }
        }).catch((err: unknown) => this.debug.error(`Failed to release SNAPSHOTTING marker on VM ${vmId}: ${err instanceof Error ? err.message : String(err)}`))
      }
    } catch (error: any) {
      this.debug.error(`Failed to create snapshot: ${error.message}`)

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
    this.debug.debug(`Listing snapshots for VM ${vmId}`)

    try {
      const vm = await this.getVM(vmId)
      if (!vm) {
        return { success: false, snapshots: [], message: `VM ${vmId} not found` }
      }

      const diskPath = this.getDiskPath(vm.internalName)
      if (!fs.existsSync(diskPath)) {
        return { success: true, snapshots: [], message: 'No disk image found' }
      }

      // List snapshots via SnapshotManager. We surface ONLY what qemu-img truly
      // reports: name, date, size. There is no description store and no
      // current-snapshot concept, so we don't fabricate either (the old code
      // inferred 'isCurrent' from list order and looked up an always-empty map).
      const infinizationSnapshots = await this.snapshotManager.listSnapshots(diskPath)

      const snapshots: SnapshotInfo[] = infinizationSnapshots.map((snap) => {
        return {
          name: snap.name,
          description: undefined,
          createdAt: snap.date ? new Date(snap.date) : new Date(),
          state: 'shutoff', // qemu-img snapshots are always from shutoff state
          isCurrent: false,
          vmSize: snap.vmSize
        }
      })

      this.debug.debug(`Found ${snapshots.length} snapshots for VM ${vmId}`)
      return { success: true, snapshots }
    } catch (error: any) {
      this.debug.error(`Failed to list snapshots: ${error.message}`)
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
    this.debug.debug(`Restoring VM ${vmId} to snapshot '${snapshotName}'`)

    try {
      // Get VM and validate status
      const vm = await this.getVMWithValidation(vmId)
      if (!vm) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Check if VM is stopped (cheap early-out; authoritative gate is below).
      if (vm.status !== 'off' && vm.status !== 'error') {
        return {
          success: false,
          message: 'VM must be stopped before restoring a snapshot. Please shut down the VM first.'
        }
      }

      // ── Atomic claim (audit H1 / MF-1) ─────────────────────────────────────
      // Flip the STOPPED VM row to RESTORING in a single conditional updateMany.
      // This is the durable cross-service lock that closes the TOCTOU on
      // assertVmStopped: the in-place `qemu-img snapshot -a` revert overwrites the
      // qcow2, so a powerOn landing between the status read and the revert would
      // boot QEMU over the disk being rewritten → corruption. With the claim, a
      // concurrent powerOn refuses a row in a disk-op marker
      // (isDiskOperationInProgress), and a second backup/restore/snapshot sees
      // count !== 1 and bails. Mirrors createSnapshot's exact pattern.
      const claimed = await this.prisma.machine.updateMany({
        where: { id: vmId, status: { in: [OFF_STATUS, ERROR_STATUS] } },
        data: { status: RESTORING_STATUS }
      })
      if (claimed.count !== 1) {
        return {
          success: false,
          message: 'VM is busy or not stopped — cannot restore a snapshot. Ensure the VM is OFF and no other backup/restore/snapshot is in progress.'
        }
      }

      try {
        // Authoritative fail-closed gate against the live process (qcow2 write
        // lock). Re-probe AFTER the claim, to catch a power-on that slipped in
        // just before it. Reverting a running VM's disk via qemu-img corrupts
        // the guest FS.
        await assertVmStopped(this.prisma, vmId)

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

        this.debug.debug(`VM ${vmId} restored to snapshot '${snapshotName}'`)
        return {
          success: true,
          message: `Restored to snapshot '${snapshotName}' successfully`
        }
      } finally {
        // Release the RESTORING claim on every exit (success, disk-not-found /
        // snapshot-not-found early return, qemu-img throw). Flip back to OFF only
        // if we still hold the marker, so we never clobber a status another flow
        // moved on to.
        await this.prisma.machine.updateMany({
          where: { id: vmId, status: RESTORING_STATUS },
          data: { status: OFF_STATUS }
        }).catch((err: unknown) => this.debug.error(`Failed to release RESTORING marker on VM ${vmId}: ${err instanceof Error ? err.message : String(err)}`))
      }
    } catch (error: any) {
      this.debug.error(`Failed to restore snapshot: ${error.message}`)

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
    this.debug.debug(`Deleting snapshot '${snapshotName}' from VM ${vmId}`)

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

      this.debug.debug(`Snapshot '${snapshotName}' deleted from VM ${vmId}`)
      return {
        success: true,
        message: `Snapshot '${snapshotName}' deleted successfully`
      }
    } catch (error: any) {
      this.debug.error(`Failed to delete snapshot: ${error.message}`)

      if (error instanceof StorageError) {
        return { success: false, message: error.message }
      }

      return { success: false, message: `Failed to delete snapshot: ${error.message}` }
    }
  }

  /**
   * Returns the most RECENT snapshot (by qemu-img list order), or null.
   *
   * NOTE: qemu-img exposes no "current/active" snapshot for an offline qcow2, so
   * this is explicitly "most recent", NOT "current" — callers must not treat the
   * result as the active snapshot. The previous implementation presented the last
   * list entry as the current snapshot, which was fictional.
   *
   * @param vmId - VM UUID
   * @returns the most recent SnapshotInfo, or null if there are none
   */
  async getMostRecentSnapshot (vmId: string): Promise<SnapshotInfo | null> {
    this.debug.debug(`Getting most recent snapshot for VM ${vmId}`)

    try {
      const result = await this.listSnapshots(vmId)
      if (!result.success || result.snapshots.length === 0) {
        return null
      }
      return result.snapshots[result.snapshots.length - 1]
    } catch (error: any) {
      this.debug.error(`Failed to get most recent snapshot: ${error.message}`)
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
      this.debug.warn(`VM ${vmId} not found in database`)
    }
    return vm
  }

  /**
   * Gets the disk path for a VM.
   */
  private getDiskPath (internalName: string): string {
    const diskDir = process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks'

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

  // NOTE: there is intentionally no snapshot-metadata store. qemu-img internal
  // snapshots carry no description/parent/current-flag, and there is no Snapshot
  // DB model. The previous storeSnapshotMetadata/getSnapshotMetadataMap/
  // deleteSnapshotMetadata helpers were no-ops that created the illusion of one
  // (descriptions were silently dropped); they were removed. Adding real
  // descriptions would require a dedicated `Snapshot` Prisma model.
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
