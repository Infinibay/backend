import logger from '@main/logger'
import { PrismaClient, VMRecommendation, RecommendationType, Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { RecommendationFilterInput } from '../graphql/types/RecommendationTypes'
import { AppError, ErrorCode } from '../utils/errors/ErrorHandler'
import {
  RecommendationChecker,
  RecommendationResult,
  RecommendationContext,
  DiskSpaceChecker,
  ResourceOptimizationChecker,
  DiskIOBottleneckChecker,
  PortConflictChecker,
  OverProvisionedChecker,
  UnderProvisionedChecker,
  OsUpdateChecker,
  AppUpdateChecker,
  DefenderDisabledChecker,
  DefenderThreatChecker
} from './recommendations'
import { getPackageManager, PackageManager } from './packages/PackageManager'
import {
  RecommendationOperationResult,
  ServiceConfiguration
} from './recommendations/types'
import { PerformanceTracker, PerformanceMetrics } from './recommendations/PerformanceTracker'
import { CacheManager } from './recommendations/CacheManager'

export class VMRecommendationService {
  private checkers: RecommendationChecker[] = []
  private cacheManager: CacheManager
  private performanceTracker: PerformanceTracker
  private config: ServiceConfiguration
  private maintenanceTimer: NodeJS.Timeout | null = null
  private isDisposed: boolean = false
  private packageManager: PackageManager | null = null
  private packageManagerInitialized: boolean = false
  /** Promise that resolves when the PackageManager has finished loading. */
  private packageManagerReady: Promise<void>

  constructor (private prisma: PrismaClient) {
    this.config = this.loadConfiguration()
    this.performanceTracker = new PerformanceTracker(this.config)
    this.cacheManager = new CacheManager(this.config)
    this.registerDefaultCheckers()
    this.validateConfiguration()
    this.startMaintenanceTimer()

    // Initialize package manager asynchronously — store the promise so
    // public methods can await it before accessing packageManager.
    this.packageManagerReady = this.initializePackageManager()

    // Run initial maintenance on startup
    setTimeout(() => {
      this.performMaintenance()
    }, 1000) // Small delay to ensure service is fully initialized
  }

  /**
   * Process-wide shared instance. This service owns an hourly maintenance
   * setInterval (see startMaintenanceTimer) which pins the whole instance for
   * the process lifetime until dispose() clears it. It must therefore NOT be
   * created per request: doing so leaks one live instance + one hourly timer on
   * every call, a trivially triggerable memory/CPU DoS. Per-request callers
   * (e.g. GraphQL resolvers) should reuse getShared() instead of `new`.
   */
  private static sharedInstance: VMRecommendationService | null = null

  /**
   * Get a lazily-created, process-wide shared VMRecommendationService.
   * Reusing a single instance avoids leaking a maintenance timer per request.
   */
  public static getShared (prisma: PrismaClient): VMRecommendationService {
    if (!VMRecommendationService.sharedInstance) {
      VMRecommendationService.sharedInstance = new VMRecommendationService(prisma)
    }
    return VMRecommendationService.sharedInstance
  }

  /**
   * Initialize the PackageManager asynchronously
   * This loads all package checkers for use in recommendations
   */
  private async initializePackageManager (): Promise<void> {
    try {
      logger.info('📦 Initializing PackageManager for recommendations...')
      this.packageManager = getPackageManager(this.prisma)
      await this.packageManager.loadAll()
      this.packageManagerInitialized = true

      const statuses = this.packageManager.getPackageStatuses()
      const totalCheckers = statuses.reduce((sum, pkg) => sum + pkg.checkerCount, 0)
      logger.info(`✅ PackageManager initialized: ${statuses.length} packages, ${totalCheckers} checkers`)
    } catch (error) {
      logger.error('❌ Failed to initialize PackageManager:', error)
      // Non-fatal: service continues without package checkers
      this.packageManager = null
      this.packageManagerInitialized = false
    }
  }

  private registerDefaultCheckers (): void {
    const enabledCheckers: string[] = []
    const disabledCheckers: string[] = []

    // Helper function to register checker with validation and logging
    const registerIfEnabled = (envVar: string, CheckerClass: new () => RecommendationChecker, description: string): void => {
      if (process.env[envVar] !== 'false') {
        try {
          const checker = new CheckerClass()
          this.registerChecker(checker)
          enabledCheckers.push(`${checker.getName()} (${checker.getCategory()})`)
          logger.debug(`VM Recommendations: ${description} enabled`)
        } catch (error) {
          const standardizedError = new AppError(
            `Failed to register VM recommendation checker: ${description}`,
            ErrorCode.VM_RECOMMENDATION_ERROR,
            500,
            true,
            { checker: description, operation: 'registerChecker' }
          )
          logger.error(`VM Recommendations: Failed to register ${description}:`, {
            message: standardizedError.message,
            code: standardizedError.code,
            context: standardizedError.context,
            originalError: (error as Error).message
          })
        }
      } else {
        disabledCheckers.push(description)
        logger.debug(`VM Recommendations: ${description} disabled via ${envVar}`)
      }
    }

    // Core resource analysis checkers
    registerIfEnabled('ENABLE_DISK_SPACE_CHECKER', DiskSpaceChecker, 'DiskSpaceChecker')
    registerIfEnabled('ENABLE_RESOURCE_OPTIMIZATION_CHECKER', ResourceOptimizationChecker, 'ResourceOptimizationChecker')
    registerIfEnabled('ENABLE_OVER_PROVISIONED_CHECKER', OverProvisionedChecker, 'OverProvisionedChecker')
    registerIfEnabled('ENABLE_UNDER_PROVISIONED_CHECKER', UnderProvisionedChecker, 'UnderProvisionedChecker')
    registerIfEnabled('ENABLE_DISK_IO_BOTTLENECK_CHECKER', DiskIOBottleneckChecker, 'DiskIOBottleneckChecker')

    // Security checkers (prioritized first for security recommendations)
    registerIfEnabled('ENABLE_DEFENDER_DISABLED_CHECKER', DefenderDisabledChecker, 'DefenderDisabledChecker')
    registerIfEnabled('ENABLE_DEFENDER_THREAT_CHECKER', DefenderThreatChecker, 'DefenderThreatChecker')
    registerIfEnabled('ENABLE_PORT_BLOCKED_CHECKER', PortConflictChecker, 'PortConflictChecker')

    // Update and maintenance checkers
    registerIfEnabled('ENABLE_OS_UPDATE_CHECKER', OsUpdateChecker, 'OsUpdateChecker')
    registerIfEnabled('ENABLE_APP_UPDATE_CHECKER', AppUpdateChecker, 'AppUpdateChecker')

    // Validation and summary logging
    const totalCheckers = this.checkers.length
    const uniqueNames = new Set(this.checkers.map(c => c.getName()))

    if (uniqueNames.size !== totalCheckers) {
      logger.warn('VM Recommendations: Duplicate checker names detected - this may cause issues')
    }

    logger.info(`VM Recommendations: Successfully registered ${totalCheckers} recommendation checkers`)
    logger.info(`VM Recommendations: Enabled checkers: ${enabledCheckers.join(', ')}`)

    if (disabledCheckers.length > 0) {
      logger.info(`VM Recommendations: Disabled checkers: ${disabledCheckers.join(', ')}`)
    }

    // Log security and update checker status
    const securityCheckers = this.checkers.filter(c => c.getCategory() === 'Security').length
    const maintenanceCheckers = this.checkers.filter(c => c.getCategory() === 'Maintenance').length
    logger.info(`VM Recommendations: Security checkers: ${securityCheckers}, Maintenance checkers: ${maintenanceCheckers}`)
  }

  registerChecker (checker: RecommendationChecker): void {
    this.checkers.push(checker)
  }

  /**
   * Safe wrapper for generating recommendations with standardized error handling
   * This method provides a service-level contract that prevents sensitive error details from leaking
   */
  public async generateRecommendationsSafe (vmId: string, snapshotId?: string): Promise<RecommendationOperationResult> {
    try {
      const recommendations = await this.generateRecommendations(vmId, snapshotId)
      return {
        success: true,
        recommendations
      }
    } catch (error) {
      // Log detailed error information (including context) for debugging
      if (error instanceof AppError) {
        logger.error('VM Recommendation Service Error:', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          snapshotId,
          timestamp: new Date().toISOString()
        })
      } else {
        logger.error('Unexpected VM Recommendation Service Error:', {
          message: (error as Error).message,
          vmId,
          snapshotId,
          timestamp: new Date().toISOString(),
          stack: (error as Error).stack?.substring(0, 500)
        })
      }

      // Return generic error message to prevent sensitive information leakage
      return {
        success: false,
        error: 'Failed to generate recommendations'
      }
    }
  }

  async generateRecommendations (vmId: string, snapshotId?: string): Promise<VMRecommendation[]> {
    // Check if service has been disposed
    if (this.isDisposed) {
      throw new AppError(
        'VM recommendation service has been disposed and cannot generate recommendations',
        ErrorCode.VM_RECOMMENDATION_GENERATION_FAILED,
        500,
        true,
        { vmId, snapshotId, operation: 'generateRecommendations', service: 'VMRecommendationService' }
      )
    }

    const startTime = Date.now()
    const cacheKey = `recommendations:${vmId}:${snapshotId || 'latest'}`

    try {
      // Check cache first if enabled
      if (this.config.enableContextCaching) {
        const cachedResult = this.getFromCache(cacheKey)
        if (cachedResult) {
          logger.info(`⚡ Cache hit for recommendations ${vmId} (${snapshotId || 'latest'})`)
          this.performanceTracker.updateCacheHitRate(true)
          return cachedResult
        }
        this.performanceTracker.updateCacheHitRate(false)
      }

      logger.info(`💡 Generating recommendations for VM ${vmId}${snapshotId ? ` snapshot ${snapshotId}` : ' (latest snapshot)'}`)

      // Build context with performance timing
      const contextStartTime = Date.now()
      const context = await this.buildContextWithCaching(vmId, snapshotId)
      const contextBuildTime = Date.now() - contextStartTime
      this.performanceTracker.updateContextBuildTime(contextBuildTime)

      if (contextBuildTime > this.config.performanceLoggingThreshold) {
        logger.warn(`⚠️ Context building took ${contextBuildTime}ms for VM ${vmId} (threshold: ${this.config.performanceLoggingThreshold}ms)`)
      }

      const results: RecommendationResult[] = []
      const checkerPerformance = new Map<string, number>()

      // Run checkers with individual performance monitoring
      for (const checker of this.checkers) {
        if (checker.isApplicable(context)) {
          const checkerStartTime = Date.now()
          try {
            const checkerResults = await this.runCheckerWithRetry(checker, context)
            results.push(...checkerResults)

            const checkerTime = Date.now() - checkerStartTime
            checkerPerformance.set(checker.getName(), checkerTime)

            // Update checker performance metrics
            this.performanceTracker.updateCheckerTime(checker.getName(), checkerTime)
          } catch (error) {
            const checkerTime = Date.now() - checkerStartTime
            this.handleCheckerError(checker.getName(), error as Error)
            logger.error(`❌ Checker ${checker.getName()} failed after ${checkerTime}ms:`, error)
          }
        }
      }

      // Ensure package manager initialization is complete before checking it
      await this.packageManagerReady
      if (this.packageManager && this.packageManagerInitialized) {
        const packageCheckerStartTime = Date.now()
        try {
          const packageResults = await this.runPackageCheckers(context, checkerPerformance)
          results.push(...packageResults)

          const packageCheckerTime = Date.now() - packageCheckerStartTime
          checkerPerformance.set('PackageCheckers', packageCheckerTime)
          logger.debug(`📦 Package checkers completed in ${packageCheckerTime}ms, produced ${packageResults.length} recommendations`)
        } catch (error) {
          logger.error('❌ Package checkers failed:', error)
          // Non-fatal: continue with built-in checker results
        }
      }

      // Save recommendations
      const savedRecommendations = await this.saveRecommendations(vmId, context.latestSnapshot?.id ?? null, results)

      const totalTime = Date.now() - startTime
      this.performanceTracker.updateMetrics(totalTime, results.length)

      // Cache results if enabled
      if (this.config.enableContextCaching) {
        this.setCache(cacheKey, savedRecommendations, this.config.cacheTTLMinutes * 60 * 1000)
      }

      // Log performance summary
      this.performanceTracker.logPerformanceSummary(vmId, totalTime, contextBuildTime, checkerPerformance, results.length)

      return savedRecommendations
    } catch (error) {
      const totalTime = Date.now() - startTime
      this.handleServiceError(error as Error, vmId, totalTime)
      throw error
    }
  }

  async getRecommendations (vmId: string, refresh?: boolean, filter?: RecommendationFilterInput): Promise<VMRecommendation[]> {
    const startTime = Date.now()

    try {
      // Check if service has been disposed
      if (this.isDisposed) {
        throw new AppError(
          'VM recommendation service has been disposed and cannot process requests',
          ErrorCode.VM_RECOMMENDATION_SERVICE_ERROR,
          500,
          true,
          { vmId, operation: 'getRecommendations', service: 'VMRecommendationService' }
        )
      }

      if (refresh) {
        return this.generateRecommendations(vmId)
      }

      // Before fetching latest snapshot
      const machine = await this.prisma.machine.findUnique({ where: { id: vmId }, select: { id: true } })
      if (!machine) {
        throw new AppError('Machine not found', ErrorCode.VM_RECOMMENDATION_SERVICE_ERROR, 404, true, { vmId, operation: 'getRecommendations' })
      }

      // Fetch the latest snapshot for this VM to filter recommendations
      const latestSnapshot = await this.prisma.vMHealthSnapshot.findFirst({
        where: { machineId: vmId },
        orderBy: { snapshotDate: 'desc' }
      })

      // If no latest snapshot exists, return empty array (no recommendations can exist without snapshots)
      if (!latestSnapshot) {
        return []
      }

      // Build where clause from filter, including snapshot filtering.
      // Exclude dismissed and actively-snoozed recommendations, mirroring the
      // global queries in VMRecommendationResolver — otherwise a resolved rec
      // (e.g. "OS updates available") keeps re-appearing in the per-VM list.
      const where: Prisma.VMRecommendationWhereInput = {
        machineId: vmId,
        snapshotId: latestSnapshot.id,
        dismissedAt: null,
        OR: [
          { snoozedUntil: null },
          { snoozedUntil: { lt: new Date() } }
        ]
      }

      if (filter?.types && filter.types.length > 0) {
        where.type = { in: filter.types }
      }

      if (filter?.createdAfter || filter?.createdBefore) {
        const dateFilter: Prisma.DateTimeFilter = {}
        if (filter.createdAfter) {
          dateFilter.gte = filter.createdAfter
        }
        if (filter.createdBefore) {
          dateFilter.lte = filter.createdBefore
        }
        where.createdAt = dateFilter
      }

      // Determine limit with safety bounds to prevent over-fetch
      const maxLimit = parseInt(process.env.RECOMMENDATION_MAX_LIMIT || '100')
      const defaultLimit = 20 // Reduced default limit to prevent over-fetch
      const take = filter?.limit && filter.limit > 0
        ? Math.min(filter.limit, maxLimit)
        : defaultLimit

      // Get existing recommendations with filters applied at DB level (now filtered by latest snapshot)
      const existing = await this.prisma.vMRecommendation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take
      })

      // If no recommendations exist or they're old (>24 hours), generate new ones (unless filtering is active)
      if (!filter && (existing.length === 0 || this.areRecommendationsStale(existing[0].createdAt))) {
        return this.generateRecommendations(vmId)
      }

      return existing
    } catch (error) {
      const totalTime = Date.now() - startTime
      this.handleServiceError(error as Error, vmId, totalTime)
      throw error
    }
  }

  /**
   * Safe wrapper for getting recommendations with standardized error handling
   * This method provides a service-level contract that prevents sensitive error details from leaking
   */
  public async getRecommendationsSafe (vmId: string, refresh?: boolean, filter?: RecommendationFilterInput): Promise<RecommendationOperationResult> {
    try {
      // Check if service has been disposed
      if (this.isDisposed) {
        return {
          success: false,
          error: 'Service unavailable'
        }
      }

      if (refresh) {
        // Use safe generation method for refresh
        return await this.generateRecommendationsSafe(vmId)
      }

      const recommendations = await this.getRecommendations(vmId, false, filter)
      return {
        success: true,
        recommendations
      }
    } catch (error) {
      // Log detailed error information (including context) for debugging
      if (error instanceof AppError) {
        logger.error('VM Recommendation Service Error (getRecommendations):', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          refresh,
          filter: filter ? JSON.stringify(filter) : undefined,
          timestamp: new Date().toISOString()
        })
      } else {
        logger.error('Unexpected VM Recommendation Service Error (getRecommendations):', {
          message: (error as Error).message,
          vmId,
          refresh,
          filter: filter ? JSON.stringify(filter) : undefined,
          timestamp: new Date().toISOString(),
          stack: (error as Error).stack?.substring(0, 500)
        })
      }

      // Return generic error message to prevent sensitive information leakage
      return {
        success: false,
        error: 'Service unavailable'
      }
    }
  }

  async deleteOldRecommendations (vmId: string, olderThanDays: number): Promise<void> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    await this.prisma.vMRecommendation.deleteMany({
      where: {
        machineId: vmId,
        createdAt: {
          lt: cutoffDate
        }
      }
    })
  }

  private async buildContext (vmId: string, snapshotId?: string): Promise<RecommendationContext> {
    // Environment-configurable limits
    const metricsWindowDays = parseInt(process.env.RECOMMENDATION_METRICS_WINDOW_DAYS || '7')
    const metricsMaxRows = parseInt(process.env.RECOMMENDATION_METRICS_MAX_ROWS || '1000')
    const portUsageMaxRows = parseInt(process.env.RECOMMENDATION_PORT_USAGE_MAX_ROWS || '100')

    // Fetch health snapshot - specific one if provided, otherwise latest
    const latestSnapshot = snapshotId
      ? await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId }
      })
      : await this.prisma.vMHealthSnapshot.findFirst({
        where: { machineId: vmId },
        orderBy: { snapshotDate: 'desc' }
      })

    // Fetch historical metrics with configurable window and limit
    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - metricsWindowDays)

    const historicalMetrics = await this.prisma.systemMetrics.findMany({
      where: {
        machineId: vmId,
        timestamp: { gte: windowStart }
      },
      orderBy: { timestamp: 'desc' },
      take: metricsMaxRows
    })

    // Fetch current port usage with configurable limit
    const portUsage = await this.prisma.portUsage.findMany({
      where: { machineId: vmId },
      orderBy: { timestamp: 'desc' },
      take: portUsageMaxRows
    })

    // Fetch machine configuration
    const machineWithDepartment = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: true
      }
    })

    // Fetch recent process snapshots (last 15-60 minutes)
    const recentProcessWindow = new Date()
    recentProcessWindow.setMinutes(recentProcessWindow.getMinutes() - 60) // 60 minutes lookback

    const recentProcessSnapshots = await this.prisma.processSnapshot.findMany({
      where: {
        machineId: vmId,
        timestamp: { gte: recentProcessWindow }
      },
      orderBy: { timestamp: 'desc' },
      take: 1000 // Limit for performance
    })

    // Use the machine config we already fetched
    const machineConfig = machineWithDepartment

    return {
      vmId,
      latestSnapshot,
      historicalMetrics,
      recentProcessSnapshots,
      portUsage,
      machineConfig
    }
  }

  /**
   * Generate a hash of recommendation results for change detection
   */
  private generateRecommendationHash (results: RecommendationResult[]): string {
    // Sort results by type and text to ensure consistent hashing
    const sortedResults = results
      .map(result => ({
        type: result.type,
        text: result.text,
        actionText: result.actionText,
        data: result.data ? JSON.stringify(result.data, Object.keys(result.data).sort()) : null
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.text.localeCompare(b.text))

    const hashContent = JSON.stringify(sortedResults)
    return createHash('sha256').update(hashContent).digest('hex')
  }

  /**
   * Check if recommendations have changed by comparing hashes
   */
  private async hasRecommendationsChanged (
    vmId: string,
    snapshotId: string | null,
    newHash: string
  ): Promise<boolean> {
    if (!snapshotId) {
      return true // Always save if no snapshot
    }

    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { customCheckResults: true }
      })

      if (!snapshot?.customCheckResults) {
        return true // No previous recommendations
      }

      const metadata = snapshot.customCheckResults as Record<string, unknown> | null
      const previousHash = metadata?.recommendationHash as string | undefined

      if (!previousHash) {
        return true // No previous hash stored
      }

      return previousHash !== newHash
    } catch (error) {
      logger.warn(`Failed to check recommendation changes for snapshot ${snapshotId}:`, error)
      return true // Default to saving on error
    }
  }

  private async saveRecommendations (
    vmId: string,
    snapshotId: string | null,
    results: RecommendationResult[]
  ): Promise<VMRecommendation[]> {
    if (results.length === 0) {
      // A scan that yields zero recommendations means previously-flagged issues
      // are resolved. Clear stale VISIBLE rows for the latest snapshot so they
      // don't linger forever (the old early-return left them in place). Rows that
      // are dismissed or under an active snooze are preserved — they're already
      // hidden and must survive a transient empty scan so a just-resolved rec is
      // not un-suppressed.
      if (snapshotId) {
        const now = new Date()
        await this.prisma.vMRecommendation.deleteMany({
          where: {
            machineId: vmId,
            snapshotId,
            dismissedAt: null,
            OR: [
              { snoozedUntil: null },
              { snoozedUntil: { lte: now } }
            ]
          }
        })
      }
      return []
    }

    // Generate hash for change detection
    const recommendationHash = this.generateRecommendationHash(results)

    // Check if recommendations have changed
    const hasChanged = await this.hasRecommendationsChanged(vmId, snapshotId, recommendationHash)

    if (!hasChanged) {
      logger.info(`📋 Recommendations unchanged for VM ${vmId}, skipping database write`)

      // Return existing recommendations instead of creating new ones
      if (snapshotId) {
        const existingRecommendations = await this.prisma.vMRecommendation.findMany({
          where: {
            machineId: vmId,
            snapshotId
          },
          orderBy: { createdAt: 'desc' }
        })
        return existingRecommendations
      }
      return []
    }

    logger.info(`📝 Recommendations changed for VM ${vmId}, saving to database`)

    // Use transaction for atomic bulk create
    return await this.prisma.$transaction(async (tx) => {
      // Preserve dismissal / snooze across the delete+recreate below. deleteMany
      // wipes dismissedAt/snoozedUntil, so a just-resolved recommendation would
      // re-materialize un-suppressed on the next ~1-min scan whenever its content
      // hash changes. Carry suppression forward keyed by recommendation type for
      // any (machineId, type) that either has an ACTIVE snooze (anywhere on this
      // machine — this is what survives a new snapshot) or was dismissed on the
      // current snapshot (this is what survives an in-place re-materialization).
      const now = new Date()
      const suppressedRows = await tx.vMRecommendation.findMany({
        where: {
          machineId: vmId,
          OR: [
            { snoozedUntil: { gt: now } },
            ...(snapshotId ? [{ snapshotId, dismissedAt: { not: null } }] : [])
          ]
        },
        select: { type: true, dismissedAt: true, snoozedUntil: true }
      })

      const laterDate = (a: Date | null, b: Date | null): Date | null => {
        if (!a) return b
        if (!b) return a
        return a.getTime() >= b.getTime() ? a : b
      }

      const suppressionByType = new Map<RecommendationType, { dismissedAt: Date | null; snoozedUntil: Date | null }>()
      for (const row of suppressedRows) {
        const prev = suppressionByType.get(row.type)
        suppressionByType.set(row.type, {
          dismissedAt: row.dismissedAt ?? prev?.dismissedAt ?? null,
          snoozedUntil: laterDate(row.snoozedUntil, prev?.snoozedUntil ?? null)
        })
      }

      // Prepare bulk data for createMany, merging any preserved suppression by type.
      const bulkData = results.map(result => {
        const suppression = suppressionByType.get(result.type)
        return {
          machineId: vmId,
          snapshotId,
          type: result.type,
          text: result.text,
          actionText: result.actionText,
          data: result.data ? JSON.parse(JSON.stringify(result.data)) : undefined,
          dismissedAt: suppression?.dismissedAt ?? null,
          snoozedUntil: suppression?.snoozedUntil ?? null
        }
      })

      // Delete existing recommendations for this VM + snapshot before inserting new ones.
      // This prevents duplicate entries when a VM is rescanned (e.g. new Edge update
      // detected alongside stale entries from a previous scan).
      await tx.vMRecommendation.deleteMany({
        where: {
          machineId: vmId,
          ...(snapshotId ? { snapshotId } : {})
        }
      })

      // Bulk create
      await tx.vMRecommendation.createMany({
        data: bulkData,
        skipDuplicates: false
      })

      // Fetch the created recommendations to return them with IDs
      const createdRecommendations = await tx.vMRecommendation.findMany({
        where: {
          machineId: vmId,
          snapshotId
        },
        orderBy: { createdAt: 'desc' },
        take: results.length
      })

      // Update snapshot with recommendation metadata if snapshotId provided
      // NOTE: Considers future schema fields recommendationCount and recommendationsGeneratedAt
      if (snapshotId) {
        try {
          const recommendationMetadata = {
            count: results.length,
            generatedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            recommendationHash
          }

          await tx.vMHealthSnapshot.update({
            where: { id: snapshotId },
            data: {
              // Store in customCheckResults for now - should be dedicated fields in schema
              customCheckResults: recommendationMetadata
            }
          })
        } catch (error) {
          const standardizedError = new AppError(
            `Failed to update snapshot recommendation metadata for snapshot ${snapshotId}`,
            ErrorCode.VM_RECOMMENDATION_ERROR,
            500,
            true,
            { snapshotId, operation: 'updateSnapshotMetadata' }
          )
          logger.error(`❌ Failed to update snapshot recommendation metadata for ${snapshotId}:`, {
            message: standardizedError.message,
            code: standardizedError.code,
            context: standardizedError.context,
            originalError: (error as Error).message
          })
          // Don't throw to avoid breaking recommendation creation
        }
      }

      return createdRecommendations
    })
  }

  private areRecommendationsStale (lastCreated: Date): boolean {
    const dayAgo = new Date()
    dayAgo.setHours(dayAgo.getHours() - 24)
    return lastCreated < dayAgo
  }

  /**
   * Load service configuration from environment variables
   */
  private loadConfiguration (): ServiceConfiguration {
    return {
      cacheTTLMinutes: Number(process.env.RECOMMENDATION_CACHE_TTL_MINUTES) || 15,
      maxCacheSize: Number(process.env.RECOMMENDATION_MAX_CACHE_SIZE) || 100,
      enablePerformanceMonitoring: process.env.RECOMMENDATION_PERFORMANCE_MONITORING !== 'false',
      enableContextCaching: process.env.RECOMMENDATION_CONTEXT_CACHING !== 'false',
      contextCacheTTLMinutes: Number(process.env.RECOMMENDATION_CONTEXT_CACHE_TTL_MINUTES) || 5,
      performanceLoggingThreshold: Number(process.env.RECOMMENDATION_PERFORMANCE_THRESHOLD) || 5000,
      maxRetries: Number(process.env.RECOMMENDATION_MAX_RETRIES) || 3,
      retryDelayMs: Number(process.env.RECOMMENDATION_RETRY_DELAY_MS) || 1000
    }
  }

  /**
   * Initialize performance metrics
   */
  private initializePerformanceMetrics (): PerformanceMetrics {
    return {
      totalGenerations: 0,
      averageGenerationTime: 0,
      cacheHitRate: 0,
      cacheHits: 0,
      cacheMisses: 0,
      contextBuildTime: 0,
      checkerTimes: new Map<string, number>(),
      errorCount: 0,
      lastError: null
    }
  }

  /**
   * Validate configuration and log settings
   */
  private validateConfiguration (): void {
    try {
      logger.info('🔧 VMRecommendationService configuration:')
      logger.info(`   - Context caching: ${this.config.enableContextCaching} (TTL: ${this.config.contextCacheTTLMinutes}min)`)
      logger.info(`   - Result caching: ${this.config.cacheTTLMinutes}min (Max size: ${this.config.maxCacheSize})`)
      logger.info(`   - Performance monitoring: ${this.config.enablePerformanceMonitoring}`)
      logger.info(`   - Performance threshold: ${this.config.performanceLoggingThreshold}ms`)
      logger.info(`   - Max retries: ${this.config.maxRetries} (Delay: ${this.config.retryDelayMs}ms)`)

      if (this.config.cacheTTLMinutes <= 0) {
        logger.warn('⚠️ Cache TTL is disabled or invalid')
      }

      logger.info('✅ VMRecommendationService configuration validated')
    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service configuration validation failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        false, // Non-operational error - indicates configuration issue
        { operation: 'validateConfiguration', service: 'VMRecommendationService' }
      )
      logger.error('❌ Configuration validation failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
      throw standardizedError
    }
  }

  /**
   * Start maintenance timer for cache cleanup
   */
  private startMaintenanceTimer (): void {
    // Run maintenance every hour
    this.maintenanceTimer = setInterval(() => {
      this.performMaintenance()
    }, 60 * 60 * 1000)

    logger.info('✅ VMRecommendationService maintenance timer started (1-hour intervals)')
  }

  /**
   * Build context with caching support
   */
  private async buildContextWithCaching (vmId: string, snapshotId?: string): Promise<RecommendationContext> {
    const cacheKey = `context:${vmId}:${snapshotId || 'latest'}`

    if (this.config.enableContextCaching) {
      const cachedContext = this.getFromContextCache(cacheKey)
      if (cachedContext) {
        return cachedContext
      }
    }

    const context = await this.buildContext(vmId, snapshotId)

    if (this.config.enableContextCaching) {
      this.setContextCache(cacheKey, context, this.config.contextCacheTTLMinutes * 60 * 1000)
    }

    return context
  }

  /**
   * Run checker with retry logic
   */
  private async runCheckerWithRetry (checker: RecommendationChecker, context: RecommendationContext): Promise<RecommendationResult[]> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await checker.analyze(context)
      } catch (error) {
        lastError = error as Error

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * attempt // Linear backoff
          logger.warn(`⚠️ Checker ${checker.getName()} failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`, error)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError || new AppError(
      'Recommendation checker failed',
      ErrorCode.VM_RECOMMENDATION_CHECKER_FAILED,
      500,
      true,
      { checker: checker.getName(), maxRetries: this.config.maxRetries.toString() }
    )
  }

  /**
   * Get data from cache
   */
  private getFromCache (key: string): any | null {
    return this.cacheManager.getFromCache(key)
  }

  /**
   * Set data in cache
   */
  private setCache (key: string, data: any, ttl: number): void {
    this.cacheManager.setCache(key, data, ttl)
  }

  /**
   * Get data from context cache
   */
  private getFromContextCache (key: string): RecommendationContext | null {
    return this.cacheManager.getFromContextCache(key)
  }

  /**
   * Set data in context cache
   */
  private setContextCache (key: string, data: RecommendationContext, ttl: number): void {
    this.cacheManager.setContextCache(key, data, ttl)
  }

  /**
   * Handle checker-specific errors
   */
  private handleCheckerError (checkerName: string, error: Error): void {
    this.performanceTracker.recordError(`${checkerName}: ${error.message}`)

    const standardizedError = error instanceof AppError
      ? error
      : new AppError(
        'Recommendation checker failed',
        ErrorCode.VM_RECOMMENDATION_CHECKER_FAILED,
        500,
        true,
        { checker: checkerName, originalError: error.name }
      )

    logger.error(`❌ Checker error in ${checkerName}:`, {
      originalError: error.message,
      errorName: error.name,
      errorStack: error.stack?.substring(0, 200) + '...',
      checkerName,
      code: standardizedError.code,
      context: standardizedError.context
    })
  }

  /**
   * Handle service-level errors
   */
  private handleServiceError (error: Error, vmId: string, totalTime: number): void {
    this.performanceTracker.recordError(`Service error for VM ${vmId}: ${error.message}`)

    const standardizedError = error instanceof AppError
      ? error
      : new AppError(
        'VM recommendation service failed',
        ErrorCode.VM_RECOMMENDATION_SERVICE_ERROR,
        500,
        true,
        {
          vmId,
          totalTime: totalTime.toString(),
          operation: 'getRecommendations',
          service: 'VMRecommendationService'
        }
      )

    logger.error(`❌ VMRecommendationService error for VM ${vmId} after ${totalTime}ms:`, {
      originalError: error.message,
      errorName: error.name,
      errorStack: error.stack?.substring(0, 300) + '...',
      vmId,
      totalTime,
      code: standardizedError.code,
      context: standardizedError.context
    })

    // Note: Error is logged but not re-thrown to allow safe wrapper methods to handle normalization
    // Re-throw the standardized error to propagate it properly (only for non-safe method calls)
    throw standardizedError
  }

  // PERFORMANCE TRACKING METHODS - Delegated to PerformanceTracker
  /**
   * Log performance summary
   */
  private logPerformanceSummary (vmId: string, totalTime: number, contextTime: number, checkerTimes: Map<string, number>, recommendationCount: number): void {
    if (!this.config.enablePerformanceMonitoring) return

    const slowCheckers = Array.from(checkerTimes.entries())
      .filter(([, time]) => time > 1000) // > 1 second
      .sort((a, b) => b[1] - a[1])

    if (totalTime > this.config.performanceLoggingThreshold || slowCheckers.length > 0) {
      logger.info(`📊 Performance summary for VM ${vmId}:`)
      logger.info(`   - Total time: ${totalTime}ms`)
      logger.info(`   - Context build: ${contextTime}ms`)
      logger.info(`   - Recommendations: ${recommendationCount}`)

      if (slowCheckers.length > 0) {
        logger.info('   - Slow checkers:')
        slowCheckers.forEach(([name, time]) => {
          logger.info(`     • ${name}: ${time}ms`)
        })
      }
    }
  }

  /**
   * Perform maintenance tasks
   */
  private performMaintenance (): void {
    try {
      // Clean expired cache entries via CacheManager
      this.cacheManager.performMaintenance()

      // Log performance statistics via PerformanceTracker
      this.performanceTracker.logStats()
    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service maintenance task failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'performMaintenance', service: 'VMRecommendationService' }
      )
      logger.error('❌ Maintenance task failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
    }
  }

  /**
   * Get service health status
   */
  public getServiceHealth (): {
    isHealthy: boolean
    cacheSize: number
    contextCacheSize: number
    performanceMetrics: PerformanceMetrics
    configuration: ServiceConfiguration
    } {
    const cacheSizes = this.cacheManager.getCacheSizes()
    const health = this.performanceTracker.getServiceHealth(cacheSizes.cacheSize, cacheSizes.contextCacheSize)

    return {
      isHealthy: health.isHealthy,
      cacheSize: health.cacheSize,
      contextCacheSize: health.contextCacheSize,
      performanceMetrics: health.performanceMetrics,
      configuration: health.configuration
    }
  }

  /**
   * Clear all caches
   */
  public clearCaches (): void {
    this.cacheManager.clearCaches()
  }

  /**
   * Reset performance metrics
   */
  public resetPerformanceMetrics (): void {
    this.performanceTracker.reset()
    logger.info('📊 VMRecommendationService performance metrics reset')
  }

  /**
   * Run all package checkers and convert results to RecommendationResult format
   * Package checkers run in addition to built-in checkers
   */
  private async runPackageCheckers (
    context: RecommendationContext,
    checkerPerformance: Map<string, number>
  ): Promise<RecommendationResult[]> {
    if (!this.packageManager) {
      return []
    }

    // Build package checker context from recommendation context
    const packageContext = {
      vmId: context.vmId,
      diskMetrics: context.latestSnapshot?.diskSpaceInfo,
      historicalMetrics: context.historicalMetrics,
      processSnapshots: context.recentProcessSnapshots,
      portUsage: context.portUsage,
      machineConfig: context.machineConfig
    }

    // Run all package checkers
    const packageResults = await this.packageManager.runAllCheckers(packageContext)

    // Convert PackageCheckerResult to RecommendationResult
    const results: RecommendationResult[] = []
    for (const result of packageResults) {
      // Map package result type to RecommendationType
      // Package checkers use string types that should match Prisma enum values
      const mappedType = this.mapPackageTypeToRecommendationType(result.type)

      if (mappedType) {
        results.push({
          type: mappedType,
          text: result.text,
          actionText: result.actionText,
          data: {
            ...result.data,
            _severity: result.severity,
            _remediation: result.remediation,
            _source: 'package'
          }
        })
      } else {
        logger.warn(`⚠️ Unknown package recommendation type: ${result.type}, skipping`)
      }
    }

    return results
  }

  /**
   * Map package checker type string to Prisma RecommendationType enum
   * Returns null if the type is not recognized
   */
  private mapPackageTypeToRecommendationType (type: string): RecommendationType | null {
    // Map common package types to Prisma enum values
    // Available enum values: DISK_SPACE_LOW, HIGH_CPU_APP, HIGH_RAM_APP, PORT_BLOCKED,
    // OVER_PROVISIONED, UNDER_PROVISIONED, OS_UPDATE_AVAILABLE, APP_UPDATE_AVAILABLE,
    // DEFENDER_DISABLED, DEFENDER_THREAT, OTHER
    const typeMapping: Record<string, RecommendationType> = {
      // Disk related
      'DISK_SPACE_LOW': RecommendationType.DISK_SPACE_LOW,
      'DISK_SPACE_CRITICAL': RecommendationType.DISK_SPACE_LOW, // Map critical to low (same category)
      // Resource related - map to closest equivalent
      'RESOURCE_OPTIMIZATION': RecommendationType.OTHER,
      'OVER_PROVISIONED': RecommendationType.OVER_PROVISIONED,
      'UNDER_PROVISIONED': RecommendationType.UNDER_PROVISIONED,
      // CPU/RAM related
      'HIGH_CPU_APP': RecommendationType.HIGH_CPU_APP,
      'HIGH_RAM_APP': RecommendationType.HIGH_RAM_APP,
      // Security related
      'SECURITY_RISK': RecommendationType.OTHER, // No specific security risk type
      'DEFENDER_DISABLED': RecommendationType.DEFENDER_DISABLED,
      'DEFENDER_THREAT': RecommendationType.DEFENDER_THREAT,
      // Updates
      'OS_UPDATE_AVAILABLE': RecommendationType.OS_UPDATE_AVAILABLE,
      'APP_UPDATE_AVAILABLE': RecommendationType.APP_UPDATE_AVAILABLE,
      // Network
      'PORT_BLOCKED': RecommendationType.PORT_BLOCKED,
      'PORT_CONFLICT': RecommendationType.PORT_BLOCKED, // Map conflict to blocked
      // Performance
      'DISK_IO_BOTTLENECK': RecommendationType.OTHER, // No specific disk IO type
      // Generic
      'OTHER': RecommendationType.OTHER
    }

    // Try direct mapping first
    if (type in typeMapping) {
      return typeMapping[type]
    }

    // Try as-is if it's already a valid RecommendationType
    if (Object.values(RecommendationType).includes(type as RecommendationType)) {
      return type as RecommendationType
    }

    // Default to OTHER for unknown types (rather than null) to avoid losing recommendations
    return RecommendationType.OTHER
  }

  /**
   * Dispose method for complete service lifecycle cleanup
   * This should be called when the service is being shut down
   */
  public dispose (): void {
    try {
      logger.info('🔄 Disposing VMRecommendationService...')

      // Mark service as disposed up front so any in-flight caller fails closed
      // immediately (see generateRecommendations/getRecommendations guards) rather
      // than running against a half-torn-down state (empty checkers / null package manager).
      this.isDisposed = true

      // Stop maintenance timer
      if (this.maintenanceTimer) {
        clearInterval(this.maintenanceTimer)
        this.maintenanceTimer = null
        logger.info('✓ Maintenance timer stopped')
      }

      // Clear all caches
      this.clearCaches()
      logger.info('✓ Caches cleared')

      // Clear checkers array
      this.checkers = []
      logger.info('✓ Checkers cleared')

      // Clear package manager reference
      this.packageManager = null
      this.packageManagerInitialized = false
      logger.info('✓ Package manager cleared')

      // Reset performance metrics
      this.performanceTracker.reset()
      logger.info('✓ Performance metrics reset')

      logger.info('✅ VMRecommendationService disposed successfully')
    } catch (error) {
      const standardizedError = new AppError(
        'Failed to dispose VM recommendation service',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'dispose', service: 'VMRecommendationService' }
      )
      logger.error('❌ Service disposal failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
      throw standardizedError
    }
  }

  /**
   * Check if the service has been disposed
   */
  public get disposed (): boolean {
    return this.isDisposed
  }

  /**
   * Cleanup method for graceful shutdown (legacy method, use dispose() instead)
   * @deprecated Use dispose() method instead for complete lifecycle management
   */
  public cleanup (): void {
    logger.warn('⚠️ cleanup() method is deprecated, use dispose() instead')
    this.dispose()
  }
}
