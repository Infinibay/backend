import { ObjectType, Field, ID, InputType, registerEnumType } from 'type-graphql'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum BackupType {
  FULL = 'FULL',
  INCREMENTAL = 'INCREMENTAL',
  SNAPSHOT = 'SNAPSHOT'
}

export enum BackupStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum BackupCompression {
  NONE = 'NONE',
  QCOW2 = 'QCOW2',
  GZIP = 'GZIP'
}

registerEnumType(BackupType, { name: 'BackupType' })
registerEnumType(BackupStatus, { name: 'BackupStatus' })
registerEnumType(BackupCompression, { name: 'BackupCompression' })

// ---------------------------------------------------------------------------
// Backup Disk Info
// ---------------------------------------------------------------------------

@ObjectType()
export class BackupDiskInfo {
  @Field()
    sourcePath!: string

  @Field()
    backupPath!: string

  @Field()
    originalSize!: number

  @Field()
    backupSize!: number

  @Field()
    format!: string

  @Field({ nullable: true })
    backingFile?: string
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

@ObjectType()
export class Backup {
  @Field(() => ID)
    id!: string

  @Field()
    backupId!: string

  @Field()
    vmId!: string

  @Field(() => BackupType)
    type!: BackupType

  @Field(() => BackupStatus)
    status!: BackupStatus

  @Field(() => [BackupDiskInfo], { nullable: true })
    disks?: BackupDiskInfo[]

  @Field()
    totalSize!: number

  @Field()
    totalOriginalSize!: number

  @Field(() => BackupCompression)
    compression!: BackupCompression

  @Field({ nullable: true })
    description?: string

  @Field(() => [String], { nullable: true })
    tags?: string[]

  @Field({ nullable: true })
    parentBackupId?: string

  @Field({ nullable: true })
    errorMessage?: string

  @Field({ nullable: true })
    progressPercent?: number

  @Field({ nullable: true })
    durationMs?: number

  @Field()
    createdAt!: Date

  @Field({ nullable: true })
    completedAt?: Date
}

// ---------------------------------------------------------------------------
// Backup Schedule
// ---------------------------------------------------------------------------

@ObjectType()
export class BackupSchedule {
  @Field(() => ID)
    id!: string

  @Field()
    scheduleId!: string

  @Field()
    vmId!: string

  @Field(() => BackupType)
    type!: BackupType

  @Field()
    cronExpression!: string

  @Field()
    retentionCount!: number

  @Field()
    destinationDir!: string

  @Field(() => BackupCompression)
    compression!: BackupCompression

  @Field()
    enabled!: boolean

  @Field({ nullable: true })
    label?: string

  @Field({ nullable: true })
    lastRunAt?: Date

  @Field({ nullable: true })
    nextRunAt?: Date

  @Field({ nullable: true })
    lastBackupId?: string

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date
}

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

@InputType()
export class CreateBackupInput {
  @Field()
    vmId!: string

  @Field(() => BackupType)
    type!: BackupType

  @Field(() => [String])
    diskPaths!: string[]

  @Field({ nullable: true })
    destinationDir?: string

  @Field(() => BackupCompression, { nullable: true })
    compression?: BackupCompression

  @Field({ nullable: true })
    description?: string

  @Field({ nullable: true })
    parentBackupId?: string

  @Field(() => [String], { nullable: true })
    tags?: string[]
}

@InputType()
export class RestoreBackupInput {
  @Field()
    vmId!: string

  @Field()
    backupId!: string

  @Field(() => [String])
    diskPaths!: string[]

  @Field({ nullable: true })
    overwriteExisting?: boolean
}

@InputType()
export class DeleteBackupInput {
  @Field()
    vmId!: string

  @Field()
    backupId!: string
}

@InputType()
export class CreateScheduleInput {
  @Field()
    vmId!: string

  @Field(() => BackupType)
    type!: BackupType

  @Field()
    cronExpression!: string

  @Field({ nullable: true })
    retentionCount?: number

  @Field({ nullable: true })
    destinationDir?: string

  @Field(() => BackupCompression, { nullable: true })
    compression?: BackupCompression

  @Field({ nullable: true })
    enabled?: boolean

  @Field({ nullable: true })
    label?: string
}

@InputType()
export class UpdateScheduleInput {
  @Field(() => BackupType, { nullable: true })
    type?: BackupType

  @Field({ nullable: true })
    cronExpression?: string

  @Field({ nullable: true })
    retentionCount?: number

  @Field({ nullable: true })
    destinationDir?: string

  @Field(() => BackupCompression, { nullable: true })
    compression?: BackupCompression

  @Field({ nullable: true })
    enabled?: boolean

  @Field({ nullable: true })
    label?: string
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

@ObjectType()
export class BackupResult {
  @Field()
    success!: boolean

  @Field({ nullable: true })
    backupId?: string

  @Field({ nullable: true })
    vmId?: string

  @Field(() => BackupType, { nullable: true })
    type?: BackupType

  @Field(() => [BackupDiskInfo], { nullable: true })
    disks?: BackupDiskInfo[]

  @Field({ nullable: true })
    totalSize?: number

  @Field({ nullable: true })
    durationMs?: number

  @Field({ nullable: true })
    error?: string
}

@ObjectType()
export class BackupRestoreResult {
  @Field()
    success!: boolean

  @Field({ nullable: true })
    backupId?: string

  @Field({ nullable: true })
    vmId?: string

  @Field(() => [String], { nullable: true })
    restoredDiskPaths?: string[]

  @Field({ nullable: true })
    durationMs?: number

  @Field({ nullable: true })
    error?: string
}

@ObjectType()
export class BackupListResult {
  @Field()
    success!: boolean

  @Field()
    message!: string

  @Field(() => [Backup])
    backups!: Backup[]
}

@ObjectType()
export class ScheduleListResult {
  @Field()
    success!: boolean

  @Field()
    message!: string

  @Field(() => [BackupSchedule])
    schedules!: BackupSchedule[]
}
