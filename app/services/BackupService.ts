/**
 * BackupService — Backend wrapper around infinization's BackupService.
 *
 * Responsibilities:
 *  - Persist every backup operation to the Prisma `Backup` table.
 *  - Resolve VM disk paths from the Machine record.
 *  - Broadcast progress / completion / failure events through EventManager.
 *  - Translate domain errors into friendly shapes for the GraphQL layer.
 *
 * This is the only backend-side code that talks to infinization.BackupService
 * directly, so upstream changes are contained here.
 */

import path from 'path'

import {
  BackupService as InfinizationBackupService,
  BackupType,
  BackupStatus,
  BackupCompression,
  BackupMetadata,
  BackupProgress,
  BackupResult as InfinizationBackupResult,
  BackupRestoreResult as InfinizationRestoreResult,
  DEFAULT_BACKUP_DIR,
  DEFAULT_BACKUP_COMPRESSION,
  BackupError
} from '@infinibay/infinization'
import type { PrismaClient, Backup as PrismaBackup } from '@prisma/client'

import logger from '@main/logger'
import { getEventManager } from '@services/EventManager'

export interface CreateBackupParams {
  vmId: string
  type: BackupType
  compression?: BackupCompression
  description?: string
  parentBackupId?: string
  tags?: string[]
  destinationDir?: string
  /** Optional explicit disk paths; defaults to Machine.diskPaths. */
  diskPaths?: string[]
  /** The user triggering the operation, for event routing. */
  triggeredBy?: string
  /** Optional schedule ID when the backup is fired by the scheduler. */
  scheduleId?: string
}

export interface RestoreBackupParams {
  vmId: string
  backupId: string
  diskPaths?: string[]
  overwriteExisting?: boolean
  triggeredBy?: string
}

export class BackupService {
  private readonly prisma: PrismaClient
  private readonly infinization: InfinizationBackupService
  private readonly backupRootDir: string

  constructor (prisma: PrismaClient, infinization?: InfinizationBackupService) {
    this.prisma = prisma
    this.backupRootDir = process.env.INFINIZATION_BACKUP_DIR ?? DEFAULT_BACKUP_DIR
    this.infinization = infinization ?? new InfinizationBackupService({ backupRootDir: this.backupRootDir })
    this.wireProgressEvents()
  }

  /** Exposes the underlying infinization service so BackupScheduler can attach. */
  getInfinizationService (): InfinizationBackupService {
    return this.infinization
  }

  /**
   * Creates a backup and persists it to the database. The record is inserted
   * with `IN_PROGRESS` up-front so the UI can show the in-flight operation.
   */
  async createBackup (params: CreateBackupParams): Promise<PrismaBackup> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: { id: true, name: true, userId: true, diskPaths: true }
    })
    if (!vm) {
      throw new Error(`VM ${params.vmId} not found`)
    }

    const diskPaths = params.diskPaths ?? this.resolveDiskPaths(vm.diskPaths)
    if (diskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured`)
    }

    const destinationDir = params.destinationDir ?? path.join(this.backupRootDir, vm.id)
    const compression = params.compression ?? DEFAULT_BACKUP_COMPRESSION

    // Pre-insert a row so in-flight backups are visible to the UI.
    const pending = await this.prisma.backup.create({
      data: {
        backupId: 'pending-' + Date.now() + '-' + vm.id.slice(0, 8),
        vmId: vm.id,
        type: params.type,
        status: BackupStatus.IN_PROGRESS,
        compression,
        destinationDir,
        description: params.description,
        tags: params.tags ?? undefined,
        parentBackupId: params.parentBackupId,
        scheduleId: params.scheduleId
      }
    })

    this.dispatch('started', pending, params.triggeredBy).catch(() => {})

    let result: InfinizationBackupResult
    try {
      result = await this.infinization.createBackup({
        vmId: vm.id,
        diskPaths,
        destinationDir,
        type: params.type,
        compression,
        description: params.description,
        parentBackupId: params.parentBackupId,
        tags: params.tags
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const updated = await this.prisma.backup.update({
        where: { id: pending.id },
        data: {
          status: BackupStatus.FAILED,
          errorMessage: message,
          completedAt: new Date()
        }
      })
      this.dispatch('failed', updated, params.triggeredBy).catch(() => {})
      throw err
    }

    const metadata = await this.safeGetMetadata(result.backupId, vm.id)

    const completed = await this.prisma.backup.update({
      where: { id: pending.id },
      data: {
        backupId: result.backupId,
        status: result.success ? BackupStatus.COMPLETED : BackupStatus.FAILED,
        diskPaths: result.disks as unknown as object,
        totalSize: BigInt(result.totalSize ?? 0),
        totalOriginalSize: BigInt(metadata?.totalOriginalSize ?? 0),
        durationMs: result.durationMs,
        errorMessage: result.error,
        completedAt: new Date()
      }
    })

    this.dispatch(result.success ? 'completed' : 'failed', completed, params.triggeredBy)
      .catch(() => {})

    return completed
  }

  /**
   * Restores a backup. Reads the original disk paths from the VM record by
   * default; callers can override for partial restores.
   */
  async restoreBackup (params: RestoreBackupParams): Promise<InfinizationRestoreResult> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: { id: true, userId: true, diskPaths: true }
    })
    if (!vm) throw new Error(`VM ${params.vmId} not found`)

    const diskPaths = params.diskPaths ?? this.resolveDiskPaths(vm.diskPaths)
    if (diskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured for restore`)
    }

    const result = await this.infinization.restoreBackup({
      vmId: vm.id,
      backupId: params.backupId,
      diskPaths,
      overwriteExisting: params.overwriteExisting ?? false
    })

    // Restore is an event on its own — the UI wants to know the VM changed.
    const payload = {
      id: params.backupId,
      vmId: vm.id,
      success: result.success,
      durationMs: result.durationMs
    }
    const eventManager = getEventManager()
    if (eventManager) {
      eventManager.dispatchEvent('backups', result.success ? 'completed' : 'failed', payload, params.triggeredBy)
        .catch((err: unknown) => logger.warn(`backups:restore event failed: ${err instanceof Error ? err.message : String(err)}`))
    }

    return result
  }

  /** Lists persisted backups for a VM, newest first. */
  async listBackups (vmId: string): Promise<PrismaBackup[]> {
    return this.prisma.backup.findMany({
      where: { vmId },
      orderBy: { createdAt: 'desc' }
    })
  }

  /** Deletes a backup from disk and from the database. */
  async deleteBackup (dbId: string, triggeredBy?: string): Promise<void> {
    const backup = await this.prisma.backup.findUnique({ where: { id: dbId } })
    if (!backup) throw new Error(`Backup ${dbId} not found`)

    try {
      await this.infinization.deleteBackup(backup.backupId, backup.vmId)
    } catch (err) {
      // Missing on disk is fine; keep DB consistent by still removing the row.
      if (!isNotFound(err)) throw err
      logger.warn(`Backup ${backup.backupId} not found on disk; removing DB row only`)
    }

    await this.prisma.backup.delete({ where: { id: dbId } })

    this.dispatch('delete', backup, triggeredBy).catch(() => {})
  }

  /**
   * Forward infinization progress events to the global EventManager so the
   * UI gets real-time updates without polling.
   */
  private wireProgressEvents (): void {
    this.infinization.on('progress', (progress: BackupProgress) => {
      const eventManager = getEventManager()
      if (!eventManager) return
      eventManager.dispatchEvent('backups', 'progress', {
        id: progress.backupId,
        vmId: progress.vmId,
        currentDisk: progress.currentDisk,
        totalDisks: progress.totalDisks,
        diskProgress: progress.diskProgress,
        overallProgress: progress.overallProgress,
        estimatedTimeRemainingMs: progress.estimatedTimeRemainingMs
      }).catch(() => {})
    })
  }

  private async dispatch (
    action: 'started' | 'completed' | 'failed' | 'delete',
    backup: PrismaBackup,
    triggeredBy?: string
  ): Promise<void> {
    const eventManager = getEventManager()
    if (!eventManager) return
    await eventManager.dispatchEvent('backups', action, {
      id: backup.id,
      backupId: backup.backupId,
      vmId: backup.vmId,
      type: backup.type,
      status: backup.status,
      totalSize: Number(backup.totalSize),
      createdAt: backup.createdAt,
      completedAt: backup.completedAt ?? undefined,
      errorMessage: backup.errorMessage ?? undefined,
      scheduleId: backup.scheduleId ?? undefined
    }, triggeredBy)
  }

  private async safeGetMetadata (backupId: string, vmId: string): Promise<BackupMetadata | null> {
    try {
      return await this.infinization.getBackupMetadata(backupId, vmId)
    } catch (err) {
      logger.debug(`Could not read manifest for backup ${backupId}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  private resolveDiskPaths (raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string')
    return []
  }
}

function isNotFound (err: unknown): boolean {
  if (err instanceof BackupError) return err.code === 'BACKUP_NOT_FOUND'
  return false
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let instance: BackupService | null = null

export function getBackupService (prisma: PrismaClient): BackupService {
  if (instance === null) instance = new BackupService(prisma)
  return instance
}

/** For tests only. */
export function setBackupServiceForTesting (svc: BackupService | null): void {
  instance = svc
}
