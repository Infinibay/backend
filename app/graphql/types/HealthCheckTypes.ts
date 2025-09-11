import { ObjectType, Field, Int, Float, ID, registerEnumType } from 'type-graphql'

/**
 * Health check severity levels
 */
export enum HealthCheckSeverity {
  PASSED = 'PASSED',
  WARNING = 'WARNING',
  FAILED = 'FAILED',
  INFO = 'INFO'
}

registerEnumType(HealthCheckSeverity, {
  name: 'HealthCheckSeverity',
  description: 'Severity level of health check results'
})

/**
 * Available health check names for individual health check execution
 */
export enum HealthCheckName {
  // Disk and Storage Checks
  DISK_SPACE = 'disk_space',
  DISK_HEALTH = 'disk_health',
  DISK_FRAGMENTATION = 'disk_fragmentation',

  // Windows Update Checks
  WINDOWS_UPDATES = 'windows_updates',
  UPDATE_SERVICES = 'update_services',

  // Security Checks
  WINDOWS_DEFENDER = 'windows_defender',
  FIREWALL_STATUS = 'firewall_status',
  SECURITY_UPDATES = 'security_updates',

  // Performance and Resources
  RESOURCE_OPTIMIZATION = 'resource_optimization',
  MEMORY_USAGE = 'memory_usage',
  CPU_USAGE = 'cpu_usage',
  PERFORMANCE_COUNTERS = 'performance_counters',

  // Applications and Services
  APPLICATION_HEALTH = 'application_health',
  CRITICAL_SERVICES = 'critical_services',
  STARTUP_PROGRAMS = 'startup_programs',

  // System Health
  SYSTEM_FILES = 'system_files',
  REGISTRY_HEALTH = 'registry_health',
  EVENT_LOG_ERRORS = 'event_log_errors',
  NETWORK_CONNECTIVITY = 'network_connectivity',

  // General Health
  SYSTEM_TEMPERATURE = 'system_temperature',
  BOOT_TIME = 'boot_time'
}

registerEnumType(HealthCheckName, {
  name: 'HealthCheckName',
  description: 'Available health check types that can be executed individually'
})

/**
 * Individual health check result
 */
@ObjectType()
export class HealthCheckResult {
  @Field()
    checkName!: string

  @Field(() => HealthCheckSeverity)
    severity!: HealthCheckSeverity

  @Field()
    message!: string

  @Field({ nullable: true })
    details?: string

  @Field()
    timestamp!: Date
}

/**
 * Overall VM health status
 */
@ObjectType()
export class HealthCheckStatus {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => Float)
    overallScore!: number

  @Field(() => [HealthCheckResult])
    checks!: HealthCheckResult[]

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Disk drive information
 */
@ObjectType()
export class DiskDriveInfo {
  @Field()
    drive!: string

  @Field()
    label!: string

  @Field(() => Float)
    totalGB!: number

  @Field(() => Float)
    usedGB!: number

  @Field(() => Float)
    freeGB!: number

  @Field(() => Float)
    usedPercent!: number

  @Field(() => HealthCheckSeverity)
    status!: HealthCheckSeverity
}

/**
 * Disk space status for VM
 */
@ObjectType()
export class DiskSpaceInfo {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => [DiskDriveInfo])
    drives!: DiskDriveInfo[]

  @Field(() => Float, { nullable: true })
    warningThreshold?: number

  @Field(() => Float, { nullable: true })
    criticalThreshold?: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Resource optimization recommendation
 */
@ObjectType()
export class ResourceRecommendation {
  @Field()
    resource!: string

  @Field(() => Float)
    currentValue!: number

  @Field(() => Float)
    recommendedValue!: number

  @Field()
    unit!: string

  @Field()
    reason!: string

  @Field(() => Float, { nullable: true })
    potentialSavingsPercent?: number
}

/**
 * Resource optimization information
 */
@ObjectType()
export class ResourceOptimizationInfo {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => [ResourceRecommendation])
    recommendations!: ResourceRecommendation[]

  @Field(() => Float, { nullable: true })
    evaluationWindowDays?: number

  @Field(() => HealthCheckSeverity)
    overallStatus!: HealthCheckSeverity

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Windows update item
 */
@ObjectType()
export class WindowsUpdateItem {
  @Field()
    title!: string

  @Field({ nullable: true })
    kbArticle?: string

  @Field()
    severity!: string

  @Field({ nullable: true })
    description?: string

  @Field(() => Float)
    sizeInMB!: number
}

/**
 * Windows update status
 */
@ObjectType()
export class WindowsUpdateInfo {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => Int)
    pendingUpdatesCount!: number

  @Field(() => Int)
    criticalUpdatesCount!: number

  @Field(() => Int)
    securityUpdatesCount!: number

  @Field(() => [WindowsUpdateItem])
    pendingUpdates!: WindowsUpdateItem[]

  @Field({ nullable: true })
    lastCheckTime?: Date

  @Field({ nullable: true })
    lastInstallTime?: Date

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Windows update history item
 */
@ObjectType()
export class WindowsUpdateHistoryItem {
  @Field()
    title!: string

  @Field({ nullable: true })
    kbArticle?: string

  @Field()
    installDate!: Date

  @Field()
    status!: string

  @Field({ nullable: true })
    resultCode?: string

  @Field({ nullable: true })
    description?: string
}

/**
 * Windows update history response
 */
@ObjectType()
export class WindowsUpdateHistory {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => [WindowsUpdateHistoryItem])
    updates!: WindowsUpdateHistoryItem[]

  @Field(() => Int)
    totalCount!: number

  @Field(() => Float, { nullable: true })
    daysIncluded?: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Windows Defender status
 */
@ObjectType()
export class WindowsDefenderStatus {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field()
    realTimeProtectionEnabled!: boolean

  @Field()
    antivirusEnabled!: boolean

  @Field()
    antispywareEnabled!: boolean

  @Field()
    antivirusSignatureVersion!: string

  @Field()
    antivirusSignatureLastUpdated!: Date

  @Field({ nullable: true })
    lastQuickScanTime?: Date

  @Field({ nullable: true })
    lastFullScanTime?: Date

  @Field(() => Int)
    threatsDetected!: number

  @Field(() => Int)
    threatsQuarantined!: number

  @Field(() => HealthCheckSeverity)
    overallStatus!: HealthCheckSeverity

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Installed application information
 */
@ObjectType()
export class ApplicationInfo {
  @Field()
    name!: string

  @Field({ nullable: true })
    version?: string

  @Field({ nullable: true })
    publisher?: string

  @Field({ nullable: true })
    installDate?: Date

  @Field({ nullable: true })
    installLocation?: string

  @Field(() => Float, { nullable: true })
    sizeInMB?: number
}

/**
 * Application inventory response
 */
@ObjectType()
export class ApplicationInventory {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => [ApplicationInfo])
    applications!: ApplicationInfo[]

  @Field(() => Int)
    totalCount!: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Application update information
 */
@ObjectType()
export class ApplicationUpdateInfo {
  @Field()
    applicationName!: string

  @Field()
    currentVersion!: string

  @Field()
    availableVersion!: string

  @Field({ nullable: true })
    updateType?: string

  @Field({ nullable: true })
    releaseDate?: Date

  @Field({ nullable: true })
    downloadUrl?: string

  @Field(() => Float, { nullable: true })
    sizeInMB?: number

  // New fields to support optimized format
  @Field({ nullable: true })
    vendor?: string

  @Field({ nullable: true })
    installType?: string

  @Field({ nullable: true })
    installDate?: Date

  @Field({ nullable: true })
    installLocation?: string

  @Field({ nullable: true })
    registryKey?: string

  @Field()
    canUpdate!: boolean

  @Field({ nullable: true })
    updateSource?: string

  @Field(() => Float, { nullable: true })
    updateSizeBytes?: number

  @Field()
    isSecurityUpdate!: boolean

  @Field({ nullable: true })
    lastUpdateCheck?: Date
}

/**
 * Application updates response
 */
@ObjectType()
export class ApplicationUpdates {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => [ApplicationUpdateInfo])
    availableUpdates!: ApplicationUpdateInfo[]

  @Field(() => Int)
    totalUpdatesCount!: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date

  // New fields for optimized format
  @Field({ nullable: true })
    summary?: string

  @Field(() => Int, { nullable: true })
    windowsUpdatesCount?: number

  @Field(() => Int, { nullable: true })
    microsoftStoreUpdatesCount?: number

  @Field(() => Int, { nullable: true })
    executionTimeMs?: number
}

/**
 * Generic health check response (for flexible check types)
 */
@ObjectType()
export class GenericHealthCheckResponse {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field()
    checkName!: string

  @Field(() => HealthCheckSeverity)
    severity!: HealthCheckSeverity

  @Field()
    message!: string

  @Field({ nullable: true })
    details?: string

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Defender scan result
 */
@ObjectType()
export class DefenderScanResult {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field()
    scanType!: string

  @Field(() => Int)
    threatsFound!: number

  @Field(() => Int)
    filesScanned!: number

  @Field()
    scanDuration!: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Disk cleanup result
 */
@ObjectType()
export class DiskCleanupResult {
  @Field()
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field()
    drive!: string

  @Field(() => Float)
    spaceClearedMB!: number

  @Field(() => [String])
    targetsProcessed!: string[]

  @Field(() => Int)
    filesDeleted!: number

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}
