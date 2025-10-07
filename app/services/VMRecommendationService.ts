import { PrismaClient, Machine, VMHealthSnapshot, SystemMetrics, ProcessSnapshot, PortUsage, VMRecommendation, RecommendationType, Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { RecommendationFilterInput } from '../graphql/types/RecommendationTypes'
import { AppError, ErrorCode, ErrorContext } from '../utils/errors/ErrorHandler'
import {
  RecommendationChecker,
  RecommendationData,
  RecommendationResult,
  RecommendationContext,
  AppUpdateInfo,
  ThreatTimelineInfo,
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

export type RecommendationOperationResult = {
  success: true;
  recommendations: VMRecommendation[];
} | {
  success: false;
  error: string; // generic, e.g., 'Service unavailable' or 'Failed to generate recommendations'
}

interface CacheEntry {
  data: any
  timestamp: number
  ttl: number
}

interface PerformanceMetrics {
  totalGenerations: number
  averageGenerationTime: number
  cacheHitRate: number
  cacheHits: number
  cacheMisses: number
  contextBuildTime: number
  checkerTimes: Map<string, number>
  errorCount: number
  lastError: string | null
}

interface ServiceConfiguration {
  cacheTTLMinutes: number
  maxCacheSize: number
  enablePerformanceMonitoring: boolean
  enableContextCaching: boolean
  contextCacheTTLMinutes: number
  performanceLoggingThreshold: number
  maxRetries: number
  retryDelayMs: number
}

export class VMRecommendationService {
  private checkers: RecommendationChecker[] = []
  private cache = new Map<string, CacheEntry>()
  private contextCache = new Map<string, CacheEntry>()
  private performanceMetrics: PerformanceMetrics
  private config: ServiceConfiguration
  private maintenanceTimer: NodeJS.Timeout | null = null
  private isDisposed: boolean = false

  constructor (private prisma: PrismaClient) {
    this.config = this.loadConfiguration()
    this.performanceMetrics = this.initializePerformanceMetrics()
    this.registerDefaultCheckers()
    this.validateConfiguration()
    this.startMaintenanceTimer()

    // Run initial maintenance on startup
    setTimeout(() => {
      this.performMaintenance()
    }, 1000) // Small delay to ensure service is fully initialized
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
          console.debug(`VM Recommendations: ${description} enabled`)
        } catch (error) {
          const standardizedError = new AppError(
            `Failed to register VM recommendation checker: ${description}`,
            ErrorCode.VM_RECOMMENDATION_ERROR,
            500,
            true,
            { checker: description, operation: 'registerChecker' }
          )
          console.error(`VM Recommendations: Failed to register ${description}:`, {
            message: standardizedError.message,
            code: standardizedError.code,
            context: standardizedError.context,
            originalError: (error as Error).message
          })
        }
      } else {
        disabledCheckers.push(description)
        console.debug(`VM Recommendations: ${description} disabled via ${envVar}`)
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
      console.warn('VM Recommendations: Duplicate checker names detected - this may cause issues')
    }

    console.log(`VM Recommendations: Successfully registered ${totalCheckers} recommendation checkers`)
    console.log(`VM Recommendations: Enabled checkers: ${enabledCheckers.join(', ')}`)

    if (disabledCheckers.length > 0) {
      console.log(`VM Recommendations: Disabled checkers: ${disabledCheckers.join(', ')}`)
    }

    // Log security and update checker status
    const securityCheckers = this.checkers.filter(c => c.getCategory() === 'Security').length
    const maintenanceCheckers = this.checkers.filter(c => c.getCategory() === 'Maintenance').length
    console.log(`VM Recommendations: Security checkers: ${securityCheckers}, Maintenance checkers: ${maintenanceCheckers}`)
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
        console.error('VM Recommendation Service Error:', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          snapshotId,
          timestamp: new Date().toISOString()
        })
      } else {
        console.error('Unexpected VM Recommendation Service Error:', {
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
          console.log(`⚡ Cache hit for recommendations ${vmId} (${snapshotId || 'latest'})`)
          this.updateCacheHitRate(true)
          return cachedResult
        }
        this.updateCacheHitRate(false)
      }

      console.log(`💡 Generating recommendations for VM ${vmId}${snapshotId ? ` snapshot ${snapshotId}` : ' (latest snapshot)'}`)

      // Build context with performance timing
      const contextStartTime = Date.now()
      const context = await this.buildContextWithCaching(vmId, snapshotId)
      const contextBuildTime = Date.now() - contextStartTime
      this.performanceMetrics.contextBuildTime = this.updateAverageTime(this.performanceMetrics.contextBuildTime, contextBuildTime)

      if (contextBuildTime > this.config.performanceLoggingThreshold) {
        console.warn(`⚠️ Context building took ${contextBuildTime}ms for VM ${vmId} (threshold: ${this.config.performanceLoggingThreshold}ms)`)
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
            const existingTime = this.performanceMetrics.checkerTimes.get(checker.getName()) || 0
            this.performanceMetrics.checkerTimes.set(checker.getName(), this.updateAverageTime(existingTime, checkerTime))
          } catch (error) {
            const checkerTime = Date.now() - checkerStartTime
            this.handleCheckerError(checker.getName(), error as Error)
            console.error(`❌ Checker ${checker.getName()} failed after ${checkerTime}ms:`, error)
          }
        }
      }

      // Save recommendations
      const savedRecommendations = await this.saveRecommendations(vmId, context.latestSnapshot?.id ?? null, results)

      const totalTime = Date.now() - startTime
      this.updatePerformanceMetrics(totalTime, results.length)

      // Cache results if enabled
      if (this.config.enableContextCaching) {
        this.setCache(cacheKey, savedRecommendations, this.config.cacheTTLMinutes * 60 * 1000)
      }

      // Log performance summary
      this.logPerformanceSummary(vmId, totalTime, contextBuildTime, checkerPerformance, results.length)

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

      // Build where clause from filter, including snapshot filtering
      const where: Prisma.VMRecommendationWhereInput = {
        machineId: vmId,
        snapshotId: latestSnapshot.id
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
        console.error('VM Recommendation Service Error (getRecommendations):', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          refresh,
          filter: filter ? JSON.stringify(filter) : undefined,
          timestamp: new Date().toISOString()
        })
      } else {
        console.error('Unexpected VM Recommendation Service Error (getRecommendations):', {
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

      const metadata = snapshot.customCheckResults as any
      const previousHash = metadata.recommendationHash

      if (!previousHash) {
        return true // No previous hash stored
      }

      return previousHash !== newHash
    } catch (error) {
      console.warn(`Failed to check recommendation changes for snapshot ${snapshotId}:`, error)
      return true // Default to saving on error
    }
  }

  private async saveRecommendations (
    vmId: string,
    snapshotId: string | null,
    results: RecommendationResult[]
  ): Promise<VMRecommendation[]> {
    if (results.length === 0) {
      return []
    }

    // Generate hash for change detection
    const recommendationHash = this.generateRecommendationHash(results)

    // Check if recommendations have changed
    const hasChanged = await this.hasRecommendationsChanged(vmId, snapshotId, recommendationHash)

    if (!hasChanged) {
      console.log(`📋 Recommendations unchanged for VM ${vmId}, skipping database write`)

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

    console.log(`📝 Recommendations changed for VM ${vmId}, saving to database`)

    // Prepare bulk data for createMany
    const bulkData = results.map(result => ({
      machineId: vmId,
      snapshotId,
      type: result.type,
      text: result.text,
      actionText: result.actionText,
      data: result.data ? JSON.parse(JSON.stringify(result.data)) : undefined
    }))

    // Use transaction for atomic bulk create
    return await this.prisma.$transaction(async (tx) => {
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
          console.error(`❌ Failed to update snapshot recommendation metadata for ${snapshotId}:`, {
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
      console.log('🔧 VMRecommendationService configuration:')
      console.log(`   - Context caching: ${this.config.enableContextCaching} (TTL: ${this.config.contextCacheTTLMinutes}min)`)
      console.log(`   - Result caching: ${this.config.cacheTTLMinutes}min (Max size: ${this.config.maxCacheSize})`)
      console.log(`   - Performance monitoring: ${this.config.enablePerformanceMonitoring}`)
      console.log(`   - Performance threshold: ${this.config.performanceLoggingThreshold}ms`)
      console.log(`   - Max retries: ${this.config.maxRetries} (Delay: ${this.config.retryDelayMs}ms)`)

      if (this.config.cacheTTLMinutes <= 0) {
        console.warn('⚠️ Cache TTL is disabled or invalid')
      }

      console.log('✅ VMRecommendationService configuration validated')
    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service configuration validation failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        false, // Non-operational error - indicates configuration issue
        { operation: 'validateConfiguration', service: 'VMRecommendationService' }
      )
      console.error('❌ Configuration validation failed:', {
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

    console.log('✅ VMRecommendationService maintenance timer started (1-hour intervals)')
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
          console.warn(`⚠️ Checker ${checker.getName()} failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`, error)
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
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data
    }

    if (entry) {
      this.cache.delete(key) // Clean up expired entry
    }

    return null
  }

  /**
   * Set data in cache
   */
  private setCache (key: string, data: any, ttl: number): void {
    // Implement cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * Get data from context cache
   */
  private getFromContextCache (key: string): RecommendationContext | null {
    const entry = this.contextCache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data
    }

    if (entry) {
      this.contextCache.delete(key) // Clean up expired entry
    }

    return null
  }

  /**
   * Set data in context cache
   */
  private setContextCache (key: string, data: RecommendationContext, ttl: number): void {
    // Context cache has separate size limit
    if (this.contextCache.size >= 50) { // Fixed limit for context cache
      const firstKey = this.contextCache.keys().next().value
      if (firstKey) {
        this.contextCache.delete(firstKey)
      }
    }

    this.contextCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * Update cache hit rate
   */
  private updateCacheHitRate (isHit: boolean): void {
    if (isHit) {
      this.performanceMetrics.cacheHits++
    } else {
      this.performanceMetrics.cacheMisses++
    }

    const total = this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses
    this.performanceMetrics.cacheHitRate = this.performanceMetrics.cacheHits / total
  }

  /**
   * Update average time metric
   */
  private updateAverageTime (currentAverage: number, newTime: number): number {
    const count = this.performanceMetrics.totalGenerations || 1
    return ((currentAverage * (count - 1)) + newTime) / count
  }

  /**
   * Update performance metrics after recommendation generation
   */
  private updatePerformanceMetrics (totalTime: number, recommendationCount: number): void {
    this.performanceMetrics.totalGenerations++
    this.performanceMetrics.averageGenerationTime = this.updateAverageTime(
      this.performanceMetrics.averageGenerationTime,
      totalTime
    )

    console.debug(`📊 Generated ${recommendationCount} recommendations in ${totalTime}ms (avg: ${Math.round(this.performanceMetrics.averageGenerationTime)}ms)`)
  }

  /**
   * Handle checker-specific errors
   */
  private handleCheckerError (checkerName: string, error: Error): void {
    this.performanceMetrics.errorCount++
    this.performanceMetrics.lastError = `${checkerName}: ${error.message}`

    const standardizedError = error instanceof AppError
      ? error
      : new AppError(
        'Recommendation checker failed',
        ErrorCode.VM_RECOMMENDATION_CHECKER_FAILED,
        500,
        true,
        { checker: checkerName, originalError: error.name }
      )

    console.error(`❌ Checker error in ${checkerName}:`, {
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
    this.performanceMetrics.errorCount++
    this.performanceMetrics.lastError = `Service error for VM ${vmId}: ${error.message}`

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

    console.error(`❌ VMRecommendationService error for VM ${vmId} after ${totalTime}ms:`, {
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

  /**
   * Log performance summary
   */
  private logPerformanceSummary (vmId: string, totalTime: number, contextTime: number, checkerTimes: Map<string, number>, recommendationCount: number): void {
    if (!this.config.enablePerformanceMonitoring) return

    const slowCheckers = Array.from(checkerTimes.entries())
      .filter(([, time]) => time > 1000) // > 1 second
      .sort((a, b) => b[1] - a[1])

    if (totalTime > this.config.performanceLoggingThreshold || slowCheckers.length > 0) {
      console.log(`📊 Performance summary for VM ${vmId}:`)
      console.log(`   - Total time: ${totalTime}ms`)
      console.log(`   - Context build: ${contextTime}ms`)
      console.log(`   - Recommendations: ${recommendationCount}`)

      if (slowCheckers.length > 0) {
        console.log('   - Slow checkers:')
        slowCheckers.forEach(([name, time]) => {
          console.log(`     • ${name}: ${time}ms`)
        })
      }
    }
  }

  /**
   * Perform maintenance tasks
   */
  private performMaintenance (): void {
    try {
      // Clean expired cache entries
      let cacheCleanedCount = 0
      let contextCacheCleanedCount = 0

      const now = Date.now()

      // Clean main cache
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp >= entry.ttl) {
          this.cache.delete(key)
          cacheCleanedCount++
        }
      }

      // Clean context cache
      for (const [key, entry] of this.contextCache.entries()) {
        if (now - entry.timestamp >= entry.ttl) {
          this.contextCache.delete(key)
          contextCacheCleanedCount++
        }
      }

      if (cacheCleanedCount > 0 || contextCacheCleanedCount > 0) {
        console.log(`🧹 Cache maintenance: cleaned ${cacheCleanedCount} main cache entries, ${contextCacheCleanedCount} context cache entries`)
      }

      // Log performance statistics
      if (this.config.enablePerformanceMonitoring && this.performanceMetrics.totalGenerations > 0) {
        console.debug('📊 VMRecommendationService performance stats:')
        console.debug(`   - Total generations: ${this.performanceMetrics.totalGenerations}`)
        console.debug(`   - Average time: ${Math.round(this.performanceMetrics.averageGenerationTime)}ms`)
        console.debug(`   - Cache hit rate: ${(this.performanceMetrics.cacheHitRate * 100).toFixed(1)}%`)
        console.debug(`   - Error count: ${this.performanceMetrics.errorCount}`)

        if (this.performanceMetrics.lastError) {
          console.debug(`   - Last error: ${this.performanceMetrics.lastError}`)
        }
      }
    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service maintenance task failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'performMaintenance', service: 'VMRecommendationService' }
      )
      console.error('❌ Maintenance task failed:', {
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
    const recentErrorThreshold = 10 // Consider unhealthy if more than 10 errors recently
    const slowResponseThreshold = 30000 // 30 seconds

    const isHealthy =
      this.performanceMetrics.errorCount < recentErrorThreshold &&
      this.performanceMetrics.averageGenerationTime < slowResponseThreshold

    return {
      isHealthy,
      cacheSize: this.cache.size,
      contextCacheSize: this.contextCache.size,
      performanceMetrics: { ...this.performanceMetrics },
      configuration: { ...this.config }
    }
  }

  /**
   * Clear all caches
   */
  public clearCaches (): void {
    this.cache.clear()
    this.contextCache.clear()
    console.log('🧹 All VMRecommendationService caches cleared')
  }

  /**
   * Reset performance metrics
   */
  public resetPerformanceMetrics (): void {
    this.performanceMetrics = this.initializePerformanceMetrics()
    console.log('📊 VMRecommendationService performance metrics reset')
  }

  /**
   * Dispose method for complete service lifecycle cleanup
   * This should be called when the service is being shut down
   */
  public dispose (): void {
    try {
      console.log('🔄 Disposing VMRecommendationService...')

      // Stop maintenance timer
      if (this.maintenanceTimer) {
        clearInterval(this.maintenanceTimer)
        this.maintenanceTimer = null
        console.log('✓ Maintenance timer stopped')
      }

      // Clear all caches
      this.clearCaches()
      console.log('✓ Caches cleared')

      // Clear checkers array
      this.checkers = []
      console.log('✓ Checkers cleared')

      // Reset performance metrics
      this.performanceMetrics = this.initializePerformanceMetrics()
      console.log('✓ Performance metrics reset')

      // Mark service as disposed
      this.isDisposed = true
      console.log('✓ Service marked as disposed')

      console.log('✅ VMRecommendationService disposed successfully')
    } catch (error) {
      const standardizedError = new AppError(
        'Failed to dispose VM recommendation service',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'dispose', service: 'VMRecommendationService' }
      )
      console.error('❌ Service disposal failed:', {
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
    console.warn('⚠️ cleanup() method is deprecated, use dispose() instead')
    this.dispose()
  }
}
