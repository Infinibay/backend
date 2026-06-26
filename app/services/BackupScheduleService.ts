/**
 * BackupScheduleService — Persistent, Prisma-backed backup scheduling.
 *
 * The infinization package ships its own `BackupScheduler`, but it persists
 * to JSON and passes empty `diskPaths` through to backup creation, so it
 * can't actually execute end-to-end. We own persistence via Prisma instead
 * and use our internal Scheduler + BackupService wrapper, which resolves
 * disks from the Machine record and emits proper events.
 *
 *   Prisma (source of truth)
 *     └── BackupScheduleService (this file)
 *           ├── Scheduler (app/lib/scheduler)  ← cron tick loop
 *           └── BackupService (app/services)   ← executes the backup
 */

import path from 'path'

import { BackupType, BackupCompression, DEFAULT_BACKUP_DIR } from '@infinibay/infinization'
import type { PrismaClient, BackupSchedule as PrismaSchedule } from '@prisma/client'

import logger from '@main/logger'
import { CronExpression, Scheduler, getScheduler, ScheduledHandle } from '@main/lib/scheduler'
import { BackupService, VmBusyError, BackupDependencyError } from '@services/BackupService'
import { getEventManager } from '@services/EventManager'
import { VmRunningError } from '@utils/assertVmStopped'

export interface CreateScheduleInput {
  vmId: string
  type: BackupType
  cronExpression: string
  retentionCount?: number
  destinationDir?: string
  compression?: BackupCompression
  enabled?: boolean
  label?: string
}

export interface UpdateScheduleInput {
  type?: BackupType
  cronExpression?: string
  retentionCount?: number
  destinationDir?: string
  compression?: BackupCompression
  enabled?: boolean
  label?: string
}

export class BackupScheduleService {
  private readonly prisma: PrismaClient
  private readonly backupService: BackupService
  private readonly scheduler: Scheduler
  private readonly handles = new Map<string, ScheduledHandle>()
  private readonly backupRootDir: string

  constructor (prisma: PrismaClient, backupService: BackupService, scheduler: Scheduler = getScheduler()) {
    this.prisma = prisma
    this.backupService = backupService
    this.scheduler = scheduler
    this.backupRootDir = process.env.INFINIZATION_BACKUP_DIR ?? DEFAULT_BACKUP_DIR
  }

  /**
   * Loads every enabled schedule from the database and registers it with the
   * scheduler. Call once on application startup.
   */
  async start (): Promise<void> {
    const schedules = await this.prisma.backupSchedule.findMany({ where: { enabled: true } })
    for (const schedule of schedules) {
      try {
        this.register(schedule)
      } catch (err) {
        logger.error(`Failed to register backup schedule ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    logger.info(`📅 BackupScheduleService started with ${this.handles.size} active schedule(s)`)
  }

  /** Stops all registered schedules. */
  stop (): void {
    for (const handle of this.handles.values()) handle.stop()
    this.handles.clear()
  }

  async createSchedule (input: CreateScheduleInput, triggeredBy?: string): Promise<PrismaSchedule> {
    new CronExpression(input.cronExpression) // validate up-front

    const vm = await this.prisma.machine.findUnique({ where: { id: input.vmId }, select: { id: true } })
    if (!vm) throw new Error(`VM ${input.vmId} not found`)

    const destinationDir = input.destinationDir ?? path.join(this.backupRootDir, input.vmId)
    const enabled = input.enabled ?? true

    const schedule = await this.prisma.backupSchedule.create({
      data: {
        scheduleId: 'sched-' + Date.now() + '-' + input.vmId.slice(0, 8),
        vmId: input.vmId,
        type: input.type,
        cronExpression: input.cronExpression,
        retentionCount: input.retentionCount ?? 7,
        destinationDir,
        compression: input.compression ?? BackupCompression.NONE,
        enabled,
        label: input.label
      }
    })

    if (enabled) {
      const updated = this.register(schedule)
      await this.persistNextRun(updated)
    }

    this.dispatch('create', schedule, triggeredBy)
    return schedule
  }

  async updateSchedule (id: string, updates: UpdateScheduleInput, triggeredBy?: string): Promise<PrismaSchedule> {
    if (updates.cronExpression) new CronExpression(updates.cronExpression)

    const existing = await this.prisma.backupSchedule.findUnique({ where: { id } })
    if (!existing) throw new Error(`Schedule ${id} not found`)

    const schedule = await this.prisma.backupSchedule.update({
      where: { id },
      data: {
        type: updates.type,
        cronExpression: updates.cronExpression,
        retentionCount: updates.retentionCount,
        destinationDir: updates.destinationDir,
        compression: updates.compression,
        enabled: updates.enabled,
        label: updates.label
      }
    })

    this.unregister(id)
    if (schedule.enabled) {
      const updated = this.register(schedule)
      await this.persistNextRun(updated)
    }

    this.dispatch('update', schedule, triggeredBy)
    return schedule
  }

  async deleteSchedule (id: string, triggeredBy?: string): Promise<void> {
    const existing = await this.prisma.backupSchedule.findUnique({ where: { id } })
    if (!existing) throw new Error(`Schedule ${id} not found`)

    this.unregister(id)
    await this.prisma.backupSchedule.delete({ where: { id } })
    this.dispatch('delete', existing, triggeredBy)
  }

  async listSchedules (vmId?: string): Promise<PrismaSchedule[]> {
    return this.prisma.backupSchedule.findMany({
      where: vmId ? { vmId } : undefined,
      orderBy: { createdAt: 'desc' }
    })
  }

  /** Returns the number of active (running) schedules. */
  get activeCount (): number {
    return this.handles.size
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private register (schedule: PrismaSchedule): PrismaSchedule {
    this.unregister(schedule.id)

    const handle = this.scheduler.schedule(schedule.cronExpression, () => {
      void this.runScheduled(schedule.id)
    })
    this.handles.set(schedule.id, handle)
    return schedule
  }

  private unregister (id: string): void {
    const handle = this.handles.get(id)
    if (handle) {
      handle.stop()
      this.handles.delete(id)
    }
  }

  /**
   * Fired by the scheduler when a cron match occurs. Re-reads the schedule
   * from DB (so in-flight updates apply to the next tick) then runs it.
   */
  private async runScheduled (scheduleId: string): Promise<void> {
    const schedule = await this.prisma.backupSchedule.findUnique({ where: { id: scheduleId } })
    if (!schedule || !schedule.enabled) return

    logger.info(`⏰ Running scheduled backup for VM ${schedule.vmId} (schedule ${schedule.id})`)

    try {
      const backup = await this.backupService.createBackup({
        vmId: schedule.vmId,
        type: schedule.type as BackupType,
        compression: schedule.compression as BackupCompression,
        destinationDir: schedule.destinationDir ?? undefined,
        description: `Scheduled: ${schedule.label ?? schedule.id}`,
        tags: ['scheduled', schedule.id],
        scheduleId: schedule.id
      })

      await this.prisma.backupSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastBackupId: backup.backupId,
          nextRunAt: this.computeNextRun(schedule.id)
        }
      })

      if (schedule.retentionCount > 0) {
        await this.enforceRetention(schedule.id, schedule.retentionCount)
      }
    } catch (err) {
      // Distinguish "VM was running / busy" from a genuine backup failure (audit
      // L145). A scheduled backup that fires while the VM is up is EXPECTED on a
      // desktop VM that's in use — it is not an error to alert on, and it must
      // not look like a failing schedule. Log it as info "skipped: VM running",
      // still advance lastRun/nextRun so the schedule keeps progressing, and do
      // NOT touch lastBackupId (no backup was produced).
      const skipped = err instanceof VmBusyError || err instanceof VmRunningError
      const msg = err instanceof Error ? err.message : String(err)
      if (skipped) {
        logger.info(`⏭️  Scheduled backup skipped: VM running/busy (schedule ${schedule.id}): ${msg}`)
      } else {
        logger.error(`Scheduled backup failed (schedule ${schedule.id}): ${msg}`)
      }
      await this.prisma.backupSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), nextRunAt: this.computeNextRun(schedule.id) }
      }).catch((dbErr: unknown) => logger.error(`Failed to update schedule ${schedule.id} after ${skipped ? 'skipped' : 'failed'} backup: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`))
    }
  }

  /**
   * Deletes aged-out backups beyond `retentionCount`, newest-first, but NEVER
   * orphans an incremental chain (audit H5). A base backup that falls outside the
   * retention window may still have increments that depend on it; deleting it
   * would make the whole chain unrestorable. So before deleting a candidate we
   * check for dependents and SKIP+WARN if any exist — a base is only removed once
   * its entire chain has aged out (the increments are deleted in earlier passes
   * of this same loop, freeing the base for a subsequent retention run).
   *
   * `deleteBackup` enforces the same guard and throws BackupDependencyError; we
   * also pre-check here so a skip is logged as a benign "deferred" rather than
   * surfacing as a delete failure. Either way the loop keeps progressing.
   */
  private async enforceRetention (scheduleId: string, retentionCount: number): Promise<void> {
    const backups = await this.prisma.backup.findMany({
      where: { scheduleId },
      orderBy: { createdAt: 'desc' }
    })
    if (backups.length <= retentionCount) return

    const toDelete = backups.slice(retentionCount)
    for (const backup of toDelete) {
      try {
        // Pre-check: a base with surviving dependents is deferred, not deleted.
        const dependents = await this.backupService.findDependentBackupIds(backup)
        if (dependents.length > 0) {
          logger.info(`Retention: deferring delete of backup ${backup.id} — ${dependents.length} incremental(s) still depend on it; chain not fully aged out yet`)
          continue
        }
        await this.backupService.deleteBackup(backup.id)
      } catch (err) {
        if (err instanceof BackupDependencyError) {
          // Race: a dependent appeared between the pre-check and the delete. Defer.
          logger.info(`Retention: deferring delete of backup ${backup.id} — ${err.message}`)
          continue
        }
        logger.warn(`Retention: failed to delete backup ${backup.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  private computeNextRun (id: string): Date | null {
    const handle = this.handles.get(id)
    const iso = handle?.getNextRunDate()
    return iso ? new Date(iso) : null
  }

  private async persistNextRun (schedule: PrismaSchedule): Promise<void> {
    const next = this.computeNextRun(schedule.id)
    if (next) {
      await this.prisma.backupSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: next } })
    }
  }

  private dispatch (action: 'create' | 'update' | 'delete', schedule: PrismaSchedule, triggeredBy?: string): void {
    const eventManager = getEventManager()
    if (!eventManager) return
    eventManager.dispatchEvent('backup_schedules', action, {
      id: schedule.id,
      vmId: schedule.vmId,
      enabled: schedule.enabled,
      cronExpression: schedule.cronExpression
    }, triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch '${action}' event for schedule ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`))
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let instance: BackupScheduleService | null = null

export function getBackupScheduleService (prisma: PrismaClient, backupService: BackupService): BackupScheduleService {
  if (instance === null) instance = new BackupScheduleService(prisma, backupService)
  return instance
}

export function setBackupScheduleServiceForTesting (svc: BackupScheduleService | null): void {
  instance = svc
}
