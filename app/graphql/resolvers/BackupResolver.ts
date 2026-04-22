import { Arg, Authorized, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'

import logger from '@main/logger'
import {
  Backup as BackupGql,
  BackupDiskInfo,
  BackupListResult,
  BackupResult,
  BackupRestoreResult,
  BackupSchedule as BackupScheduleGql,
  CreateBackupInput,
  CreateScheduleInput,
  DeleteBackupInput,
  RestoreBackupInput,
  ScheduleListResult,
  UpdateScheduleInput,
  BackupType,
  BackupStatus,
  BackupCompression
} from '@graphql/types/BackupType'
import { SuccessType } from '@resolvers/machine/type'
import { getBackupService } from '@services/BackupService'
import { getBackupScheduleService } from '@services/BackupScheduleService'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'

@Resolver()
export class BackupResolver {
  // -------------------------------------------------------------------------
  // Backup queries
  // -------------------------------------------------------------------------

  @Query(() => BackupListResult, { description: 'List all backups for a VM' })
  @Authorized()
  async backups (
    @Arg('vmId') vmId: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupListResult> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    const service = getBackupService(ctx.prisma)
    const rows = await service.listBackups(vmId)
    return {
      success: true,
      message: `Found ${rows.length} backup(s)`,
      backups: rows.map(toBackupGql)
    }
  }

  @Query(() => BackupGql, { nullable: true, description: 'Get a single backup by its database ID' })
  @Authorized()
  async backup (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupGql | null> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')
    const row = await ctx.prisma.backup.findUnique({ where: { id } })
    return row ? toBackupGql(row) : null
  }

  // -------------------------------------------------------------------------
  // Backup mutations
  // -------------------------------------------------------------------------

  @Mutation(() => BackupResult, { description: 'Create a backup of a VM' })
  @Authorized()
  async createBackup (
    @Arg('input') input: CreateBackupInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupResult> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const service = getBackupService(ctx.prisma)
      const row = await service.createBackup({
        vmId: input.vmId,
        type: input.type,
        compression: input.compression,
        description: input.description,
        parentBackupId: input.parentBackupId,
        tags: input.tags,
        destinationDir: input.destinationDir,
        diskPaths: input.diskPaths.length > 0 ? input.diskPaths : undefined,
        triggeredBy: ctx.user?.id
      })

      return {
        success: row.status === BackupStatus.COMPLETED,
        backupId: row.backupId,
        vmId: row.vmId,
        type: row.type as BackupType,
        totalSize: Number(row.totalSize),
        durationMs: row.durationMs ?? undefined,
        error: row.errorMessage ?? undefined
      }
    } catch (err) {
      logger.error(`createBackup failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  @Mutation(() => BackupRestoreResult, { description: 'Restore a VM from a backup' })
  @Authorized()
  async restoreBackup (
    @Arg('input') input: RestoreBackupInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupRestoreResult> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const service = getBackupService(ctx.prisma)
      const result = await service.restoreBackup({
        vmId: input.vmId,
        backupId: input.backupId,
        diskPaths: input.diskPaths.length > 0 ? input.diskPaths : undefined,
        overwriteExisting: input.overwriteExisting,
        triggeredBy: ctx.user?.id
      })
      return {
        success: result.success,
        backupId: result.backupId,
        vmId: result.vmId,
        restoredDiskPaths: result.restoredDiskPaths,
        durationMs: result.durationMs,
        error: result.error
      }
    } catch (err) {
      logger.error(`restoreBackup failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  @Mutation(() => SuccessType, { description: 'Delete a backup' })
  @Authorized()
  async deleteBackup (
    @Arg('input') input: DeleteBackupInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SuccessType> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const service = getBackupService(ctx.prisma)
      // input.backupId is the database ID (friendlier for FE than disk UUID)
      await service.deleteBackup(input.backupId, ctx.user?.id)
      return { success: true, message: 'Backup deleted' }
    } catch (err) {
      logger.error(`deleteBackup failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  // -------------------------------------------------------------------------
  // Schedule queries
  // -------------------------------------------------------------------------

  @Query(() => ScheduleListResult, { description: 'List backup schedules for a VM (or all if vmId omitted)' })
  @Authorized()
  async backupSchedules (
    @Arg('vmId', () => String, { nullable: true }) vmId: string | undefined,
    @Ctx() ctx?: InfinibayContext
  ): Promise<ScheduleListResult> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    const backupService = getBackupService(ctx.prisma)
    const scheduleService = getBackupScheduleService(ctx.prisma, backupService)
    const rows = await scheduleService.listSchedules(vmId)
    return {
      success: true,
      message: `Found ${rows.length} schedule(s)`,
      schedules: rows.map(toScheduleGql)
    }
  }

  // -------------------------------------------------------------------------
  // Schedule mutations
  // -------------------------------------------------------------------------

  @Mutation(() => BackupScheduleGql, { description: 'Create a backup schedule' })
  @Authorized()
  async createBackupSchedule (
    @Arg('input') input: CreateScheduleInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupScheduleGql> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const backupService = getBackupService(ctx.prisma)
      const scheduleService = getBackupScheduleService(ctx.prisma, backupService)
      const schedule = await scheduleService.createSchedule({
        vmId: input.vmId,
        type: input.type,
        cronExpression: input.cronExpression,
        retentionCount: input.retentionCount ?? undefined,
        destinationDir: input.destinationDir ?? undefined,
        compression: input.compression ?? undefined,
        enabled: input.enabled ?? undefined,
        label: input.label ?? undefined
      }, ctx.user?.id)
      return toScheduleGql(schedule)
    } catch (err) {
      logger.error(`createBackupSchedule failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new UserInputError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  @Mutation(() => BackupScheduleGql, { description: 'Update a backup schedule' })
  @Authorized()
  async updateBackupSchedule (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateScheduleInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<BackupScheduleGql> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const backupService = getBackupService(ctx.prisma)
      const scheduleService = getBackupScheduleService(ctx.prisma, backupService)
      const schedule = await scheduleService.updateSchedule(id, {
        type: input.type ?? undefined,
        cronExpression: input.cronExpression ?? undefined,
        retentionCount: input.retentionCount ?? undefined,
        destinationDir: input.destinationDir ?? undefined,
        compression: input.compression ?? undefined,
        enabled: input.enabled ?? undefined,
        label: input.label ?? undefined
      }, ctx.user?.id)
      return toScheduleGql(schedule)
    } catch (err) {
      logger.error(`updateBackupSchedule failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new UserInputError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  @Mutation(() => SuccessType, { description: 'Delete a backup schedule' })
  @Authorized()
  async deleteBackupSchedule (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SuccessType> {
    if (!ctx?.prisma) throw new UserInputError('Database context not available')

    try {
      const backupService = getBackupService(ctx.prisma)
      const scheduleService = getBackupScheduleService(ctx.prisma, backupService)
      await scheduleService.deleteSchedule(id, ctx.user?.id)
      return { success: true, message: 'Schedule deleted' }
    } catch (err) {
      logger.error(`deleteBackupSchedule failed: ${err instanceof Error ? err.message : String(err)}`)
      return { success: false, message: err instanceof Error ? err.message : 'Unknown error' }
    }
  }
}

// ---------------------------------------------------------------------------
// Row → GraphQL mapping
// ---------------------------------------------------------------------------

type PrismaBackupRow = Awaited<ReturnType<ReturnType<typeof getBackupService>['listBackups']>>[number]
type PrismaScheduleRow = Awaited<ReturnType<ReturnType<typeof getBackupScheduleService>['listSchedules']>>[number]

function toBackupGql (row: PrismaBackupRow): BackupGql {
  return {
    id: row.id,
    backupId: row.backupId,
    vmId: row.vmId,
    type: row.type as BackupType,
    status: row.status as BackupStatus,
    disks: parseDiskInfos(row.diskPaths),
    totalSize: Number(row.totalSize),
    totalOriginalSize: Number(row.totalOriginalSize),
    compression: row.compression as BackupCompression,
    description: row.description ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter((t: unknown): t is string => typeof t === 'string') : undefined,
    parentBackupId: row.parentBackupId ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined
  }
}

function parseDiskInfos (raw: unknown): BackupDiskInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const disks: BackupDiskInfo[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (typeof obj.sourcePath !== 'string') continue
    if (typeof obj.backupPath !== 'string') continue
    if (typeof obj.originalSize !== 'number') continue
    if (typeof obj.backupSize !== 'number') continue
    if (typeof obj.format !== 'string') continue
    const disk: BackupDiskInfo = {
      sourcePath: obj.sourcePath,
      backupPath: obj.backupPath,
      originalSize: obj.originalSize,
      backupSize: obj.backupSize,
      format: obj.format,
      backingFile: typeof obj.backingFile === 'string' ? obj.backingFile : undefined
    }
    disks.push(disk)
  }
  return disks.length > 0 ? disks : undefined
}

function toScheduleGql (row: PrismaScheduleRow): BackupScheduleGql {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    vmId: row.vmId,
    type: row.type as BackupType,
    cronExpression: row.cronExpression,
    retentionCount: row.retentionCount,
    destinationDir: row.destinationDir ?? '',
    compression: row.compression as BackupCompression,
    enabled: row.enabled,
    label: row.label ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
    nextRunAt: row.nextRunAt ?? undefined,
    lastBackupId: row.lastBackupId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
