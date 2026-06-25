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
import { promises as fs } from 'fs'

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
import { assertVmStopped } from '@utils/assertVmStopped'

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

    if (infinization) {
      // Caller owns the infinization instance; we just wire events once.
      this.infinization = infinization
    } else {
      this.infinization = new InfinizationBackupService({ backupRootDir: this.backupRootDir })
    }

    // Wire progress events exactly once regardless of construction path.
    // The check-then-set is synchronous within the Node.js event loop, so
    // no two concurrent `new BackupService()` calls can both pass the guard.
    if (!BackupService._progressWired) {
      this.wireProgressEvents()
      BackupService._progressWired = true
    }
  }

  /** Prevent duplicate wiring of global progress events. */
  static _progressWired = false

  /** Exposes the underlying infinization service so BackupScheduler can attach. */
  getInfinizationService (): InfinizationBackupService {
    return this.infinization
  }

  /**
   * Any row left in IN_PROGRESS / PENDING belongs to a previous backend
   * process that died mid-operation. Mark them FAILED so the UI doesn't
   * show a forever-spinning bar. Call at boot.
   */
  async recoverOrphanedBackups (): Promise<number> {
    const res = await this.prisma.backup.updateMany({
      where: { status: { in: [BackupStatus.IN_PROGRESS, BackupStatus.PENDING] } },
      data: {
        status: BackupStatus.FAILED,
        errorMessage: 'Interrupted by backend restart',
        completedAt: new Date()
      }
    })
    if (res.count > 0) {
      logger.warn(`Recovered ${res.count} orphaned backup row(s) from previous run`)
    }
    return res.count
  }

  /**
   * Creates a backup and persists it to the database. The record is inserted
   * with `IN_PROGRESS` up-front so the UI can show the in-flight operation.
   */
  async createBackup (params: CreateBackupParams): Promise<PrismaBackup> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: {
        id: true,
        name: true,
        userId: true,
        configuration: { select: { diskPaths: true } }
      }
    })
    if (!vm) {
      throw new Error(`VM ${params.vmId} not found`)
    }

    // Treat an empty array the same as "not provided": the UI sends [] to mean
    // "all of the VM's disks". Without this, `[] ?? default` keeps the empty
    // array and the operation fails the length check below.
    const diskPaths = (params.diskPaths && params.diskPaths.length > 0)
      ? params.diskPaths
      : this.resolveDiskPaths(vm.configuration?.diskPaths)
    if (diskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured`)
    }

    // Reject when the VM is running OR its liveness is unknown: qemu holds an
    // exclusive write lock on the qcow2 and qemu-img convert cannot safely read a
    // live image. FAIL CLOSED — a null probe must never be treated as "stopped"
    // (the previous `status?.processAlive` check passed when the probe returned
    // null, silently backing up a possibly-running VM).
    await assertVmStopped(this.prisma, params.vmId, vm.name)

    // Validate user-supplied paths before they reach qemu-img / mkdir: keep the
    // destination within the backup root and the source disks within the disk dir
    // (path-traversal + leading-dash arg-injection guard).
    const destinationDir = this.assertWithinBase(
      params.destinationDir ?? path.join(this.backupRootDir, vm.id),
      this.backupRootDir,
      'destinationDir'
    )
    const diskBaseDir = path.resolve(process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks')
    const safeDiskPaths = diskPaths.map((p) => this.assertWithinBase(p, diskBaseDir, 'diskPath'))
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

    this.dispatch('started', pending, params.triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'started' event for backup ${pending.id}: ${err instanceof Error ? err.message : String(err)}`))

    // Kick off the real work in the background so the GraphQL mutation
    // returns immediately. UI polls the row for progress/status.
    void this.runBackupInBackground({
      pendingId: pending.id,
      vmId: vm.id,
      diskPaths: safeDiskPaths,
      destinationDir,
      type: params.type,
      compression,
      description: params.description,
      parentBackupId: params.parentBackupId,
      tags: params.tags,
      triggeredBy: params.triggeredBy
    })

    return pending
  }

  /**
   * Runs the actual infinization backup, updates the row, dispatches events.
   * Never throws — all failures are persisted as `FAILED`.
   */
  private async runBackupInBackground (args: {
    pendingId: string
    vmId: string
    diskPaths: string[]
    destinationDir: string
    type: BackupType
    compression: BackupCompression
    description?: string
    parentBackupId?: string
    tags?: string[]
    triggeredBy?: string
  }): Promise<void> {
    const {
      pendingId, vmId, diskPaths, destinationDir, type, compression,
      description, parentBackupId, tags, triggeredBy
    } = args

    // --- Live progress wiring -------------------------------------------------
    let lastPersisted = -1
    const persistIfChanged = (pct: number): void => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)))
      if (clamped === lastPersisted) return
      lastPersisted = clamped
      this.prisma.backup.update({
        where: { id: pendingId },
        data: { progressPercent: clamped }
      }).catch((err: unknown) => logger.debug(`Failed to persist progress ${clamped}% for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
    }

    const onProgress = (p: BackupProgress): void => {
      if (p.vmId !== vmId) return
      persistIfChanged(p.overallProgress)
    }
    this.infinization.on('progress', onProgress)

    let totalSourceBytes = 0
    for (const src of diskPaths) {
      try {
        const st = await fs.stat(src)
        totalSourceBytes += st.size
      } catch { /* ignore — disk might not exist; poller will degrade */ }
    }

    // infinization creates a per-backup subdir with a UUID we don't know
    // until the operation finishes. Snapshot existing subdirs now and treat
    // any new one as ours.
    const startTime = Date.now()
    const preExistingSubdirs = await this.listSubdirs(destinationDir)
    const poller = setInterval(() => {
      void (async () => {
        if (totalSourceBytes <= 0) return
        try {
          const subdirs = await this.listSubdirs(destinationDir)
          const newSubdirs = subdirs.filter((d) => !preExistingSubdirs.includes(d))
          let destBytes = 0
          for (const sub of newSubdirs) {
            const subPath = path.join(destinationDir, sub)
            // Keep only subdirs created after our backup started.
            try {
              const st = await fs.stat(subPath)
              if (st.mtimeMs < startTime - 5_000) continue
            } catch { continue }
            try {
              const files = await fs.readdir(subPath)
              for (const f of files) {
                if (!/^disk-\d+\.qcow2(\.gz)?$/.test(f)) continue
                try {
                  const fst = await fs.stat(path.join(subPath, f))
                  destBytes += fst.size
                } catch { /* file vanished mid-scan */ }
              }
            } catch { /* subdir gone */ }
          }
          const pct = (destBytes / totalSourceBytes) * 100
          persistIfChanged(Math.min(95, pct))
        } catch { /* destinationDir not yet created */ }
      })()
    }, 2000)

    let result: InfinizationBackupResult
    try {
      result = await this.infinization.createBackup({
        vmId,
        diskPaths,
        destinationDir,
        type,
        compression,
        description,
        parentBackupId,
        tags
      })
    } catch (err) {
      clearInterval(poller)
      this.infinization.off('progress', onProgress)
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`backup ${pendingId} failed: ${message}`)
      try {
        const updated = await this.prisma.backup.update({
          where: { id: pendingId },
          data: {
            status: BackupStatus.FAILED,
            errorMessage: message,
            completedAt: new Date()
          }
        })
        this.dispatch('failed', updated, triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'failed' event for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
      } catch (dbErr) {
        logger.error(`failed to mark backup ${pendingId} as FAILED: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
      }
      return
    }
    clearInterval(poller)
    this.infinization.off('progress', onProgress)

    const metadata = await this.safeGetMetadata(result.backupId, vmId)

    try {
      const completed = await this.prisma.backup.update({
        where: { id: pendingId },
        data: {
          backupId: result.backupId,
          status: result.success ? BackupStatus.COMPLETED : BackupStatus.FAILED,
          diskPaths: result.disks as unknown as object,
          totalSize: BigInt(result.totalSize ?? 0),
          totalOriginalSize: BigInt(metadata?.totalOriginalSize ?? 0),
          durationMs: result.durationMs,
          errorMessage: result.error,
          progressPercent: result.success ? 100 : lastPersisted >= 0 ? lastPersisted : 0,
          completedAt: new Date()
        }
      })
      this.dispatch(result.success ? 'completed' : 'failed', completed, triggeredBy)
        .catch((err: unknown) => logger.error(`Failed to dispatch '${result.success ? 'completed' : 'failed'}' event for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
    } catch (dbErr) {
      logger.error(`failed to finalize backup ${pendingId}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
    }
  }

  /**
   * Restores a backup. Reads the original disk paths from the VM record by
   * default; callers can override for partial restores.
   */
  async restoreBackup (params: RestoreBackupParams): Promise<InfinizationRestoreResult> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: {
        id: true,
        userId: true,
        configuration: { select: { diskPaths: true } }
      }
    })
    if (!vm) throw new Error(`VM ${params.vmId} not found`)

    // Empty array means "restore every disk to its original location" — the UI
    // sends [] for a full restore. infinization requires the target list to
    // match the backup's disk count, so resolve the paths from the VM record.
    const rawDiskPaths = (params.diskPaths && params.diskPaths.length > 0)
      ? params.diskPaths
      : this.resolveDiskPaths(vm.configuration?.diskPaths)
    if (rawDiskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured for restore`)
    }
    // Restore OVERWRITES these target paths — validate them (no path-traversal,
    // no leading-dash arg-injection) before any disk is touched.
    const diskBaseDir = path.resolve(process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks')
    const diskPaths = rawDiskPaths.map((p) => this.assertWithinBase(p, diskBaseDir, 'diskPath'))

    // Restoring over a live qcow2 corrupts it (qemu-img convert vs the VM's write
    // lock). Gate on the live process — fail closed — BEFORE any disk is touched.
    // NOTE: multi-disk restore is still non-atomic in infinization (a failure on
    // disk N leaves disks 0..N-1 already overwritten); making it temp+atomic-rename
    // is a tracked follow-up. The stopped-guard removes the dominant corruption path.
    await assertVmStopped(this.prisma, params.vmId)

    // Announce the restore so the UI (and other sessions) can show activity
    // while the — potentially multi-minute — copy runs. The mutation itself
    // stays awaited and returns the final result.
    const startedEventManager = getEventManager()
    if (startedEventManager) {
      startedEventManager.dispatchEvent('backups', 'started', {
        id: params.backupId,
        vmId: vm.id,
        restoring: true
      }).catch((err: unknown) => logger.warn(`backups:restore started event failed: ${err instanceof Error ? err.message : String(err)}`))
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

    this.dispatch('delete', backup, triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'delete' event for backup ${dbId}: ${err instanceof Error ? err.message : String(err)}`))
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
      }).catch((err: unknown) => logger.warn(`Failed to dispatch progress event for backup ${progress.backupId}: ${err instanceof Error ? err.message : String(err)}`))
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

  /**
   * Validates a client-supplied path before it reaches qemu-img: rejects names
   * starting with '-' (would be parsed as a qemu-img option even with spawn/no
   * shell), normalizes, and ensures it stays within `baseDir` (path-traversal
   * guard). Returns the resolved absolute path. Reject — never silently strip —
   * so callers get a clear error.
   */
  private assertWithinBase (candidate: string, baseDir: string, label: string): string {
    if (path.basename(candidate).startsWith('-')) {
      throw new Error(`${label} must not start with '-': ${candidate}`)
    }
    const resolvedBase = path.resolve(baseDir)
    const resolved = path.resolve(candidate)
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      throw new Error(`${label} escapes the allowed directory: ${candidate}`)
    }
    return resolved
  }

  /** Returns subdirectory names inside `dir`, or [] if it doesn't exist. */
  private async listSubdirs (dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let instance: BackupService | null = null
let instancePrisma: PrismaClient | null = null

export function getBackupService (prisma: PrismaClient): BackupService {
  // Return existing singleton only when the same PrismaClient is requested.
  // This prevents accidentally sharing service state across different DB connections.
  if (instance !== null && instancePrisma === prisma) {
    return instance
  }
  instance = new BackupService(prisma)
  instancePrisma = prisma
  return instance
}

/** For tests only. Resets the singleton so a fresh instance is created next call. */
export function resetBackupService (): void {
  instance = null
  instancePrisma = null
  BackupService._progressWired = false
}

function isNotFound (err: unknown): boolean {
  if (err instanceof BackupError) return err.code === 'BACKUP_NOT_FOUND'
  return false
}
