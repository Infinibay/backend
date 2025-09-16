import { PrismaClient, HealthCheckType, TaskPriority } from '@prisma/client'
import { EventManager } from './EventManager'
import { getVirtioSocketWatcherService, CommandResponse, SafeCommandType } from './VirtioSocketWatcherService'
import { MachineStatus } from '../graphql/resolvers/machine/type'
import { v4 as uuidv4 } from 'uuid'
import { VMRecommendationService } from './VMRecommendationService'

// Configuration constants for health monitoring intervals
export const OVERALL_SCAN_INTERVAL_MINUTES = 60 // 1 hour
export const QUEUE_PROCESSING_INTERVAL_SECONDS = 30 // 30 seconds

// Configuration constants for health check retry logic
export const DEFAULT_MAX_ATTEMPTS = 20 // 20 attempts for VM startup scenarios
export const INITIAL_BACKOFF_MS = 30000 // Start with 30 seconds
export const MAX_BACKOFF_MS = 300000 // Cap at 5 minutes
export const BACKOFF_MULTIPLIER = 1.5 // Gentler exponential growth

// Health check payload interface - using record for Prisma JSON compatibility
export interface HealthCheckPayload {
  [key: string]: string | number | boolean | undefined
}

export interface QueuedHealthCheck {
  id: string
  machineId: string
  checkType: HealthCheckType
  priority: TaskPriority
  attempts: number
  maxAttempts: number
  scheduledFor: Date
  payload?: HealthCheckPayload | null
  createdAt: Date
}

export class VMHealthQueueManager {
  private inMemoryQueues: Map<string, QueuedHealthCheck[]> = new Map()
  private readonly MAX_QUEUE_SIZE_PER_VM = 100
  private readonly MAX_CONCURRENT_CHECKS_PER_VM = 2 // Lowered for heavy checks
  // Per-check concurrency limits for heavy checks
  private readonly HEAVY_CHECK_TYPES: HealthCheckType[] = ['OVERALL_STATUS', 'RESOURCE_OPTIMIZATION', 'WINDOWS_DEFENDER', 'WINDOWS_UPDATES']
  private readonly MAX_HEAVY_CHECKS_PER_VM = 1
  private readonly MAX_SYSTEM_WIDE_CONCURRENT = 50
  private activeChecks = new Set<string>()
  private recommendationService: VMRecommendationService

  // Health check timeout constants (in milliseconds)
  private static readonly HEALTH_CHECK_TIMEOUTS: Record<HealthCheckType, number> = {
    OVERALL_STATUS: 300000, // 5 minutes
    DISK_SPACE: 60000, // 1 minute
    RESOURCE_OPTIMIZATION: 240000, // 4 minutes
    WINDOWS_UPDATES: 300000, // 5 minutes
    WINDOWS_DEFENDER: 300000, // 5 minutes
    APPLICATION_INVENTORY: 180000, // 3 minutes
    APPLICATION_UPDATES: 180000, // 3 minutes (default)
    SECURITY_CHECK: 180000, // 3 minutes (default)
    PERFORMANCE_CHECK: 180000, // 3 minutes (default)
    SYSTEM_HEALTH: 300000, // 5 minutes (default)
    CUSTOM_CHECK: 120000 // 2 minutes (default)
  }

  constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    try {
      this.recommendationService = new VMRecommendationService(this.prisma)
      console.log('✅ VMRecommendationService initialized successfully')

      // Validate configuration on startup
      this.validateConfiguration()

      // Load existing queues from database on startup
      this.loadQueuesFromDatabase()
    } catch (error) {
      console.error('❌ Failed to initialize VMHealthQueueManager:', error)
      throw error
    }
  }

  /**
   * Validate configuration on startup
   */
  private validateConfiguration(): void {
    try {
      // Validate VMRecommendationService
      if (!this.recommendationService) {
        throw new Error('VMRecommendationService initialization failed')
      }

      // Validate required environment variables
      const requiredEnvVars = ['DATABASE_URL', 'RPC_URL', 'APP_HOST']
      const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

      if (missingEnvVars.length > 0) {
        console.warn(`⚠️ Missing environment variables: ${missingEnvVars.join(', ')}`)}

      // Log configuration status
      const enabledCheckTypes = this.getEnabledCheckTypes()
      console.log(`🔧 Health check configuration:`)
      console.log(`   - Enabled check types: ${enabledCheckTypes.join(', ')}`)
      console.log(`   - Max concurrent checks per VM: ${this.MAX_CONCURRENT_CHECKS_PER_VM}`)
      console.log(`   - Max heavy checks per VM: ${this.MAX_HEAVY_CHECKS_PER_VM}`)
      console.log(`   - System-wide concurrent limit: ${this.MAX_SYSTEM_WIDE_CONCURRENT}`)
      console.log(`   - Overall scan interval: ${OVERALL_SCAN_INTERVAL_MINUTES} minutes`)

      console.log(`✅ VMHealthQueueManager configuration validated successfully`)
    } catch (error) {
      console.error(`❌ Configuration validation failed:`, error)
      throw error
    }
  }

  /**
   * Get timeout for a specific health check type
   * Reads from environment variables with fallback to constants
   */
  private getHealthCheckTimeout (checkType: HealthCheckType): number {
    const envKey = `HEALTH_CHECK_TIMEOUT_${checkType}`
    const envValue = process.env[envKey]
    if (envValue) {
      const parsed = parseInt(envValue, 10)
      if (!isNaN(parsed) && parsed > 0) {
        return parsed
      } else {
        const fallback = VMHealthQueueManager.HEALTH_CHECK_TIMEOUTS[checkType] ?? 120000
        console.warn(`⚠️ Invalid value for ${envKey}: '${envValue}'. Using default: ${fallback}ms`)
      }
    }
    // Fallback to constants
    return VMHealthQueueManager.HEALTH_CHECK_TIMEOUTS[checkType] ?? 120000 // Default 2 minutes
  }

  /**
   * Queue all standard health checks for a VM
   */
  async queueHealthChecks (machineId: string): Promise<void> {
    // Check if VM exists and is running before queuing any health checks
    const vm = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, name: true, status: true }
    })

    if (!vm) {
      throw new Error(`VM with ID ${machineId} not found`)
    }

    if (vm.status !== MachineStatus.RUNNING) {
      console.log(`🗂️ Skipping health checks for VM ${vm.name} (${machineId}) - VM status is '${vm.status}', expected '${MachineStatus.RUNNING}'`)
      return
    }

    const standardChecks: HealthCheckType[] = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES',
      'WINDOWS_DEFENDER',
      'APPLICATION_INVENTORY'
    ]

    // Create or get today's snapshot and set expected checks for snapshot-scoped tracking
    const snapshot = await this.getOrCreateTodaySnapshot(machineId, standardChecks.length, standardChecks)

    const queuePromises = standardChecks.map(checkType =>
      this.queueHealthCheckForSnapshot(machineId, checkType, 'MEDIUM', snapshot.id, undefined, vm)
    )

    const results = await Promise.allSettled(queuePromises)

    // Handle any rejected results
    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason
        // If it's a non-running VM error, we already logged it in queueHealthCheck, just continue
        if (error instanceof Error && error.message.includes('VM status is')) {
          console.log(`🗂️ Skipped health check due to VM status: ${error.message}`)
          continue
        }
        // For other unexpected errors, rethrow
        throw error
      }
    }
  }

  /**
   * Queue a single health check for a VM
   *
   * @param machineId - The ID of the VM to queue health check for
   * @param checkType - The type of health check to queue
   * @param priority - Priority level for the health check (default: MEDIUM)
   * @param payload - Optional payload data for the health check
   * @param vm - Optional VM object to avoid redundant DB lookup (must contain id, name, status)
   * @returns Promise<string> - The ID of the queued health check task
   *
   * @throws {Error} When VM is not found
   * @throws {Error} When VM status is not MachineStatus.RUNNING - health checks can only be queued for running VMs
   * @throws {Error} When VM queue is full (exceeds MAX_QUEUE_SIZE_PER_VM)
   *
   * @note This method validates VM status and only allows health checks for running VMs.
   *       Callers should either pre-filter for running VMs or handle the thrown errors.
   */
  async queueHealthCheck (
    machineId: string,
    checkType: HealthCheckType,
    priority: TaskPriority = 'MEDIUM',
    payload?: HealthCheckPayload,
    vm?: { id: string; name: string; status: string }
  ): Promise<string> {
    // Use provided VM object or fetch from database
    let vmData = vm
    if (!vmData) {
      const fetchedVm = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, status: true }
      })

      if (!fetchedVm) {
        throw new Error(`VM with ID ${machineId} not found`)
      }
      vmData = fetchedVm
    }

    // Idempotency guard: check for existing pending/running tasks of the same type first
    // This preserves the duplicate-return behavior regardless of VM status
    const existingTask = await this.prisma.vMHealthCheckQueue.findFirst({
      where: {
        machineId,
        checkType,
        status: { in: ['PENDING', 'RETRY_SCHEDULED', 'RUNNING'] }
      }
    })

    if (existingTask) {
      console.log(`🗂️ Skipping duplicate health check ${checkType} for VM ${vmData.name} (${machineId}) - task already exists`)
      return existingTask.id
    }

    // Check if VM is running before queuing new health check
    if (vmData.status !== MachineStatus.RUNNING) {
      console.log(`🗂️ Skipping health check ${checkType} for VM ${vmData.name} (${machineId}) - VM status is '${vmData.status}', expected '${MachineStatus.RUNNING}'`)
      throw new Error(`Cannot queue health check for VM ${vmData.name} (${machineId}) - VM status is '${vmData.status}', expected '${MachineStatus.RUNNING}'`)
    }

    // For OVERALL_STATUS, also check if completed recently within per-VM interval
    if (checkType === 'OVERALL_STATUS') {
      const scanIntervalMinutes = await this.getOverallScanIntervalMinutes(machineId)
      const scanIntervalMs = scanIntervalMinutes * 60 * 1000
      const recentScan = await this.prisma.vMHealthCheckQueue.findFirst({
        where: {
          machineId,
          checkType: 'OVERALL_STATUS',
          status: 'COMPLETED',
          completedAt: {
            gte: new Date(Date.now() - scanIntervalMs)
          }
        }
      })

      if (recentScan) {
        console.log(`🗂️ Skipping OVERALL_STATUS check for VM ${vmData.name} (${machineId}) - completed recently (interval: ${scanIntervalMinutes}min)`)
        return recentScan.id
      }
    }

    // Check queue size limits
    const currentQueue = this.inMemoryQueues.get(machineId) || []
    if (currentQueue.length >= this.MAX_QUEUE_SIZE_PER_VM) {
      throw new Error(`Queue for VM ${machineId} is full (max ${this.MAX_QUEUE_SIZE_PER_VM})`)
    }

    // Create queued check
    const queuedCheck: QueuedHealthCheck = {
      id: uuidv4(),
      machineId,
      checkType,
      priority,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      scheduledFor: new Date(),
      payload: payload || null,
      createdAt: new Date()
    }

    // Add to in-memory queue
    if (!this.inMemoryQueues.has(machineId)) {
      this.inMemoryQueues.set(machineId, [])
    }
    this.inMemoryQueues.get(machineId)!.push(queuedCheck)

    // Persist to database
    await this.prisma.vMHealthCheckQueue.create({
      data: {
        id: queuedCheck.id,
        machineId,
        checkType,
        priority,
        status: 'PENDING',
        payload: payload || undefined,
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        scheduledFor: queuedCheck.scheduledFor
      }
    })

    // Sort queue by priority
    this.sortQueue(machineId)

    // Emit queue updated event
    await this.eventManager.dispatchEvent('vms', 'update', {
      id: machineId,
      healthQueueUpdated: {
        queueSize: this.getQueueSize(machineId),
        checkType,
        action: 'queued'
      }
    })

    console.log(`🗂️ Queued health check ${checkType} for VM ${vmData.name} (${machineId})`)
    return queuedCheck.id
  }

  /**
   * Process queue for a specific VM when it comes online
   */
  async processQueue (machineId: string): Promise<void> {
    // Load pending tasks from database first to ensure DB is source of truth
    await this.loadPendingTasksForVm(machineId)

    const queue = this.inMemoryQueues.get(machineId) || []
    if (queue.length === 0) {
      return
    }

    // Check system-wide concurrency limit
    if (this.activeChecks.size >= this.MAX_SYSTEM_WIDE_CONCURRENT) {
      console.log(`🗂️ System-wide concurrent limit reached, delaying VM ${machineId} queue processing`)
      return
    }

    // Check per-VM concurrency limit
    const vmActiveChecks = Array.from(this.activeChecks).filter(id => id.startsWith(machineId))
    if (vmActiveChecks.length >= this.MAX_CONCURRENT_CHECKS_PER_VM) {
      console.log(`🗂️ VM ${machineId} concurrent limit reached, delaying queue processing`)
      return
    }

    // Check per-VM heavy check concurrency
    const vmHeavyChecks = vmActiveChecks.filter(id => {
      const parts = id.split(':')
      return this.HEAVY_CHECK_TYPES.includes(parts[1] as HealthCheckType)
    })
    if (vmHeavyChecks.length >= this.MAX_HEAVY_CHECKS_PER_VM) {
      console.log(`🗂️ VM ${machineId} heavy check limit reached, delaying queue processing`)
      return
    }

    // Get ready tasks (sorted by priority) with DB-level locking
    const readyTasks = await this.getReadyTasksWithLocking(
      machineId,
      this.MAX_CONCURRENT_CHECKS_PER_VM - vmActiveChecks.length
    )

    if (readyTasks.length === 0) {
      return
    }

    // Queue latency metrics
    const now = Date.now()
    const latencies = readyTasks.map(task => now - (task.scheduledFor instanceof Date ? task.scheduledFor.getTime() : new Date(task.scheduledFor).getTime()))
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
    const maxLatency = latencies.length ? Math.max(...latencies) : 0
    console.log(`🗂️ Processing ${readyTasks.length} health checks for VM ${machineId} (avg queue latency: ${avgLatency}ms, max: ${maxLatency}ms)`)

    // Process tasks concurrently
    const processingPromises = readyTasks.map(async task => {
      const checkId = `${machineId}_${task.id}`
      this.activeChecks.add(checkId)

      try {
        await this.executeHealthCheck(task)
        await this.removeFromQueue(machineId, task.id, false) // Don't delete completed tasks from DB
      } catch (error) {
        await this.handleTaskFailure(task, error as Error)
      } finally {
        this.activeChecks.delete(checkId)
      }
    })

    await Promise.allSettled(processingPromises)
  }

  /**
   * Execute a single health check
   */
  private async executeHealthCheck (task: QueuedHealthCheck): Promise<void> {
    const startTime = Date.now()
    try {
      // First, verify the VM is running before attempting health check
      const vm = await this.prisma.machine.findUnique({
        where: { id: task.machineId },
        select: { id: true, name: true, status: true }
      })
      if (!vm) {
        throw new Error(`VM ${task.machineId} not found in database`)
      }
      if (vm.status !== MachineStatus.RUNNING) {
        throw new Error(`VM ${vm.name} (${task.machineId}) is not running (status: ${vm.status}). Cannot execute health check.`)
      }
      // Update status to RUNNING
      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
          executedAt: new Date(),
          attempts: task.attempts + 1
        }
      })
      // Emit task started event to vms resource (since health is VM-related)
      await this.eventManager.dispatchEvent('vms', 'update', {
        id: task.machineId,
        healthCheckStarted: {
          taskId: task.id,
          checkType: task.checkType,
          attempt: task.attempts + 1
        }
      })
      // Get VirtioSocketWatcherService for health check execution
      const virtioService = getVirtioSocketWatcherService()
      // Determine action and timeout
      let action: SafeCommandType['action']
      switch (task.checkType) {
      case 'OVERALL_STATUS':
        action = 'RunAllHealthChecks'; break
      case 'DISK_SPACE':
        action = 'CheckDiskSpace'; break
      case 'RESOURCE_OPTIMIZATION':
        action = 'CheckResourceOptimization'; break
      case 'WINDOWS_UPDATES':
        action = 'CheckWindowsUpdates'; break
      case 'WINDOWS_DEFENDER':
        action = 'CheckWindowsDefender'; break
      case 'APPLICATION_INVENTORY':
        action = 'GetInstalledApplicationsWMI'; break
      default:
        throw new Error(`Unsupported health check type: ${task.checkType}`)
      }
      const timeout = this.getHealthCheckTimeout(task.checkType)
      let result: CommandResponse
      result = await virtioService.sendSafeCommand(
        task.machineId,
        { action, params: task.payload || undefined },
        timeout
      )
      const executionTime = Date.now() - startTime
      // Log if execution is taking longer than expected
      if (executionTime > timeout * 0.8) {
        console.warn(`🩺 Health check ${task.checkType} for VM ${task.machineId} is taking longer than expected (${executionTime}ms)`)
      }
      // Update status to COMPLETED and store result
      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: JSON.parse(JSON.stringify(result)),
          executionTimeMs: executionTime
        }
      })
      // Store result in health snapshot if needed
      await this.storeHealthSnapshot(task.machineId, task.checkType, result, executionTime)
      // Emit task completed event
      await this.eventManager.dispatchEvent('vms', 'update', {
        id: task.machineId,
        healthCheckCompleted: {
          taskId: task.id,
          checkType: task.checkType,
          executionTimeMs: executionTime,
          success: result.success
        }
      })
      console.log(`🩺 Completed health check ${task.checkType} for VM ${task.machineId} (${executionTime}ms) - Success: ${result.success}`)
    } catch (error) {
      const executionTime = Date.now() - startTime
      const err = error as unknown
      const errorMessage = (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') ? err.message : ''
      const errorCode = (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') ? err.code : ''
      // Categorize error types for better debugging
      let errorCategory = 'unknown'
      if (
        errorMessage.includes('timeout') ||
        errorCode === 'ETIMEDOUT'
      ) {
        errorCategory = 'timeout'
      } else if (
        errorMessage.includes('No connection') ||
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ECONNRESET' ||
        errorCode === 'EPIPE'
      ) {
        errorCategory = 'connection'
      } else if (errorMessage.includes('not connected')) {
        errorCategory = 'disconnected'
      }
      console.error(`🩺 Health check ${task.checkType} failed for VM ${task.machineId} [${errorCategory}]:`, error)
      console.error(`🩺 Execution time: ${executionTime}ms, Configured timeout: ${this.getHealthCheckTimeout(task.checkType)}ms`)
      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: (error as Error).message,
          executionTimeMs: executionTime
        }
      })
      // Emit task failed event
      await this.eventManager.dispatchEvent('vms', 'update', {
        id: task.machineId,
        healthCheckFailed: {
          taskId: task.id,
          checkType: task.checkType,
          error: (error as Error).message,
          executionTimeMs: executionTime
        }
      })
      // Update health snapshot with failure
      await this.updateHealthSnapshotFailure(task.machineId, task.checkType, executionTime)
      throw error
    }
  }

  /**
   * Handle task failure with retry logic
   */
  private async handleTaskFailure (task: QueuedHealthCheck, error: Error): Promise<void> {
    task.attempts++

    if (task.attempts >= task.maxAttempts) {
      // Max retries reached, remove from queue (delete from DB since it's failed)
      await this.removeFromQueue(task.machineId, task.id, false) // Keep failed records for history
      console.log(`🗂️ Health check ${task.checkType} for VM ${task.machineId} failed after ${task.maxAttempts} attempts - InfiniService may not be running or VM may have issues`)
    } else {
      // Detect if this is a connection/startup issue vs other errors
      const isConnectionError = error.message.includes('No connection to VM') ||
        error.message.includes('Connection refused') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('timeout')

      // Schedule retry with exponential backoff optimized for VM startup scenarios
      // For connection errors (VM/InfiniService starting up): Start with 30s, then 45s, 67s, 100s, 150s, 225s, 300s
      // For other errors: Use shorter backoff
      const baseBackoff = isConnectionError ? INITIAL_BACKOFF_MS : 10000 // 10s for non-connection errors
      const backoffMs = Math.min(
        baseBackoff * Math.pow(BACKOFF_MULTIPLIER, task.attempts - 1),
        MAX_BACKOFF_MS
      )
      task.scheduledFor = new Date(Date.now() + backoffMs)

      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'RETRY_SCHEDULED',
          scheduledFor: task.scheduledFor,
          attempts: task.attempts
        }
      })

      const backoffSeconds = Math.round(backoffMs / 1000)
      const errorType = isConnectionError ? 'VM/InfiniService starting up' : 'other error'
      console.log(`🗂️ Retrying health check ${task.checkType} for VM ${task.machineId} in ${backoffSeconds}s (attempt ${task.attempts}/${task.maxAttempts}) - ${errorType}: ${error.message}`)
    }

    // Emit failure event
    await this.eventManager.dispatchEvent('vms', 'update', {
      id: task.machineId,
      healthCheckStatusChanged: {
        checkType: task.checkType,
        status: task.attempts >= task.maxAttempts ? 'failed' : 'retry_scheduled',
        error: error.message,
        attempts: task.attempts
      }
    })
  }

  /**
   * Remove task from queue
   */
  private async removeFromQueue (machineId: string, taskId: string, deleteFromDB: boolean = true): Promise<void> {
    // Remove from in-memory queue
    const queue = this.inMemoryQueues.get(machineId) || []
    const filteredQueue = queue.filter(task => task.id !== taskId)
    this.inMemoryQueues.set(machineId, filteredQueue)

    // Only delete from database if requested and task is still pending
    if (deleteFromDB) {
      await this.prisma.vMHealthCheckQueue.deleteMany({
        where: {
          id: taskId,
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        }
      })
    }
  }

  /**
   * Store health check result in snapshot
   */
  private async storeHealthSnapshot (
    machineId: string,
    checkType: HealthCheckType,
    result: CommandResponse,
    executionTimeMs: number
  ): Promise<void> {
    // Get or create today's snapshot
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: {
        machineId,
        snapshotDate: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    })

    if (!snapshot) {
      // Create new snapshot - note: this is a fallback creation without expectedChecks
      // The main entry point should be through getOrCreateTodaySnapshot() for snapshot-scoped tracking
      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING', // Will be updated when all checks complete
          checksCompleted: 0,
          checksFailed: 0,
          // Add minimal metadata to indicate this wasn't created via snapshot-scoped method
          customCheckResults: {
            createdBy: 'storeHealthSnapshot-fallback',
            timestamp: new Date().toISOString(),
            note: 'Created without snapshot-scoped expectedChecks - may need backfill'
          }
        }
      })
      console.log(`⚠️ Created fallback snapshot ${snapshot.id} for VM ${machineId} via storeHealthSnapshot - consider using getOrCreateTodaySnapshot()`)
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {
      checksCompleted: { increment: 1 },
      executionTimeMs: (snapshot.executionTimeMs || 0) + executionTimeMs
    }

    // Store result in appropriate field
    switch (checkType) {
    case 'DISK_SPACE':
      updateData.diskSpaceInfo = result.data
      break
    case 'RESOURCE_OPTIMIZATION':
      updateData.resourceOptInfo = result.data
      break
    case 'WINDOWS_UPDATES':
      updateData.windowsUpdateInfo = result.data
      break
    case 'WINDOWS_DEFENDER':
      updateData.defenderStatus = result.data
      break
    case 'APPLICATION_INVENTORY':
      updateData.applicationInventory = result.data
      break
    }

    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshot.id },
      data: updateData
    })

    // Update overall status if all expected checks are complete
    await this.updateSnapshotOverallStatus(snapshot.id, machineId)
  }

  /**
   * Update health snapshot with failure information
   */
  private async updateHealthSnapshotFailure (
    machineId: string,
    _checkType: HealthCheckType, // Prefixed with _ to indicate intentionally unused
    executionTimeMs: number
  ): Promise<void> {
    // Get or create today's snapshot
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: {
        machineId,
        snapshotDate: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    })

    if (!snapshot) {
      // Create new snapshot
      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0
        }
      })
    }

    // Update failure count and execution time
    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshot.id },
      data: {
        checksFailed: { increment: 1 },
        executionTimeMs: (snapshot.executionTimeMs || 0) + executionTimeMs
      }
    })

    // Update overall status
    await this.updateSnapshotOverallStatus(snapshot.id, machineId)
  }

  /**
   * Get list of enabled check types for health monitoring
   */
  private getEnabledCheckTypes(): string[] {
    // Standard health check types - can be made configurable via environment
    const defaultCheckTypes = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES',
      'WINDOWS_DEFENDER',
      'APPLICATION_INVENTORY'
    ]

    // Check for environment configuration
    const enabledChecks = process.env.HEALTH_CHECK_ENABLED_TYPES?.split(',') || defaultCheckTypes
    return enabledChecks.map(check => check.trim()).filter(Boolean)
  }

  /**
   * Update snapshot overall status based on completed and failed checks with enhanced logging
   */
  private async updateSnapshotOverallStatus (snapshotId: string, machineId: string): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId }
      })

      if (!snapshot) {
        console.warn(`⚠️ Snapshot ${snapshotId} not found for status update`)
        return
      }

      const totalChecks = snapshot.checksCompleted + snapshot.checksFailed

      // Snapshot-scoped expected check computation - prioritizes snapshot-stored data
      let expectedChecks: number
      let expectedChecksSource: string

      // Step 1: Try to read expectedChecks from snapshot metadata (preferred approach)
      const snapshotMetadata = snapshot.customCheckResults as any
      if (snapshotMetadata?.expectedChecks && typeof snapshotMetadata.expectedChecks === 'number') {
        expectedChecks = snapshotMetadata.expectedChecks
        expectedChecksSource = 'snapshot-metadata'
        console.log(`📊 Using snapshot-scoped expectedChecks: ${expectedChecks} for snapshot ${snapshotId}`)
      } else {
        // Step 2: Fallback to queue-based computation (TODO: enhance with snapshotId when schema updated)
        // Note: This is still day-scoped but better than static config
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

        const scheduledChecksCount = await this.prisma.vMHealthCheckQueue.groupBy({
          by: ['checkType'],
          where: {
            machineId,
            createdAt: {
              gte: today,
              lt: tomorrow
            },
            status: { in: ['PENDING', 'RETRY_SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED'] }
          }
        })

        if (scheduledChecksCount.length > 0) {
          expectedChecks = scheduledChecksCount.length
          expectedChecksSource = 'queue-grouped-by-day'
          console.log(`📊 Using day-scoped queue expectedChecks: ${expectedChecks} for snapshot ${snapshotId}`)
        } else {
          // Step 3: Final fallback to configuration
          expectedChecks = this.getEnabledCheckTypes().length || 6
          expectedChecksSource = 'fallback-config'
          console.log(`📊 Using fallback expectedChecks: ${expectedChecks} for snapshot ${snapshotId}`)
        }

        // Backfill expectedChecks in snapshot metadata for future consistency
        if (expectedChecks > 0 && expectedChecksSource !== 'snapshot-metadata') {
          await this.backfillSnapshotExpectedChecks(snapshotId, expectedChecks, expectedChecksSource)
        }
      }

      let overallStatus = 'PENDING'
      if (totalChecks >= expectedChecks) {
        if (snapshot.checksFailed === 0) {
          overallStatus = 'HEALTHY'
        } else if (snapshot.checksFailed < snapshot.checksCompleted) {
          overallStatus = 'WARNING'
        } else {
          overallStatus = 'CRITICAL'
        }
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: { overallStatus }
      })

      console.log(`📊 Updated snapshot ${snapshotId} status to ${overallStatus} (${totalChecks}/${expectedChecks} checks complete, ${snapshot.checksFailed} failed) [source: ${expectedChecksSource}]`)

      // Generate recommendations when all health checks are complete
      if (totalChecks >= expectedChecks) {
        console.log(`🏁 All health checks complete for VM ${machineId} snapshot ${snapshotId}, triggering recommendation generation [expectedChecks source: ${expectedChecksSource}]`)
        await this.generateRecommendationsForSnapshot(snapshotId, machineId)
      }
    } catch (error) {
      console.error(`❌ Failed to update snapshot overall status for ${snapshotId}:`, error)
      // Continue execution to avoid breaking the health check workflow
    }
  }

  /**
   * Generate recommendations for a completed health snapshot with enhanced error handling and monitoring
   */
  private async generateRecommendationsForSnapshot(snapshotId: string, machineId: string): Promise<void> {
    const startTime = Date.now()
    const correlationId = `${machineId}-${snapshotId}-${Date.now()}`

    try {
      console.log(`💡 [${correlationId}] Starting recommendation generation for VM ${machineId} snapshot ${snapshotId}`)

      // Validate recommendation service initialization
      if (!this.recommendationService) {
        throw new Error('VMRecommendationService not initialized')
      }

      // Check if recommendations already exist for this snapshot
      const existingCount = await this.prisma.vMRecommendation.count({
        where: { snapshotId }
      })

      if (existingCount > 0) {
        console.log(`📋 [${correlationId}] Recommendations already exist for snapshot ${snapshotId} (${existingCount} found), skipping generation`)
        return
      }

      // Emit recommendation generation start event
      await this.eventManager.dispatchEvent('recommendations', 'started', {
        correlationId,
        machineId,
        snapshotId,
        startTime: new Date()
      })

      // Generate recommendations with performance timing
      const recommendations = await this.recommendationService.generateRecommendations(machineId, snapshotId)
      const generationTime = Date.now() - startTime

      const recommendationCount = recommendations ? recommendations.length : 0
      const recommendationTypes = recommendations ? [...new Set(recommendations.map(r => r.type))] : []

      console.log(`💡 [${correlationId}] Generated ${recommendationCount} recommendations for VM ${machineId} snapshot ${snapshotId} (${generationTime}ms)`)
      console.log(`💡 [${correlationId}] Recommendation types: ${recommendationTypes.join(', ')}`)

      // Emit recommendation generation success event
      await this.eventManager.dispatchEvent('recommendations', 'completed', {
        correlationId,
        machineId,
        snapshotId,
        recommendationCount,
        recommendationTypes,
        generationTimeMs: generationTime,
        completedAt: new Date()
      })

      // Update snapshot with recommendation metadata for quick reads
      await this.updateSnapshotRecommendationMetadata(snapshotId, recommendationCount)

      // Log performance warning if generation took too long
      if (generationTime > 10000) { // 10 seconds threshold
        console.warn(`⚠️ [${correlationId}] Recommendation generation took longer than expected: ${generationTime}ms`)
      }

    } catch (error) {
      const generationTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Categorize error types
      let errorCategory = 'unknown'
      if (errorMessage.includes('database') || errorMessage.includes('connection')) {
        errorCategory = 'database'
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorCategory = 'network'
      } else if (errorMessage.includes('analysis') || errorMessage.includes('checker')) {
        errorCategory = 'analysis'
      }

      console.error(`❌ [${correlationId}] Failed to generate recommendations for VM ${machineId} [${errorCategory}]:`, error)
      console.error(`❌ [${correlationId}] Generation time before failure: ${generationTime}ms`)

      // Emit recommendation generation failure event
      await this.eventManager.dispatchEvent('recommendations', 'failed', {
        correlationId,
        machineId,
        snapshotId,
        error: errorMessage,
        errorCategory,
        generationTimeMs: generationTime,
        failedAt: new Date()
      })

      // Don't throw error to prevent breaking health check workflow
      // Instead, implement graceful degradation
      console.log(`🔄 [${correlationId}] Continuing health check workflow despite recommendation generation failure`)

      // TODO: Implement retry logic with exponential backoff for transient failures
      // TODO: Add circuit breaker pattern for repeated recommendation failures
    }
  }

  /**
   * Sort queue by priority (URGENT > HIGH > MEDIUM > LOW)
   */
  private sortQueue (machineId: string): void {
    const queue = this.inMemoryQueues.get(machineId)
    if (!queue) return

    const priorityOrder = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }
    queue.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 999
      const bPriority = priorityOrder[b.priority] || 999
      return aPriority - bPriority
    })
  }

  /**
   * Load existing queues from database on startup
   */
  private async loadQueuesFromDatabase (): Promise<void> {
    try {
      const pendingTasks = await this.prisma.vMHealthCheckQueue.findMany({
        where: {
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledFor: 'asc' }
        ]
      })

      for (const task of pendingTasks) {
        const queuedCheck: QueuedHealthCheck = {
          id: task.id,
          machineId: task.machineId,
          checkType: task.checkType,
          priority: task.priority,
          attempts: task.attempts,
          maxAttempts: task.maxAttempts,
          scheduledFor: task.scheduledFor,
          payload: this.parsePayload(task.payload),
          createdAt: task.createdAt
        }

        if (!this.inMemoryQueues.has(task.machineId)) {
          this.inMemoryQueues.set(task.machineId, [])
        }
        this.inMemoryQueues.get(task.machineId)!.push(queuedCheck)
      }

      console.log(`🗂️ Loaded ${pendingTasks.length} pending health checks from database`)
    } catch (error) {
      console.error('🗂️ Failed to load queues from database:', error)
    }
  }

  /**
   * Parse payload from database JSON
   */
  private parsePayload (payload: unknown): HealthCheckPayload | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }
    return payload as HealthCheckPayload
  }

  /**
   * Get queue size for a VM
   */
  public getQueueSize (machineId: string): number {
    return this.inMemoryQueues.get(machineId)?.length || 0
  }

  /**
   * Get queue statistics
   */
  public getQueueStatistics (): {
    totalQueued: number
    activeChecks: number
    vmQueues: number
    } {
    const totalQueued = Array.from(this.inMemoryQueues.values())
      .reduce((sum, queue) => sum + queue.length, 0)

    return {
      totalQueued,
      activeChecks: this.activeChecks.size,
      vmQueues: this.inMemoryQueues.size
    }
  }

  /**
   * Clear queue for a VM (for maintenance)
   */
  public async clearQueue (machineId: string): Promise<void> {
    this.inMemoryQueues.delete(machineId)

    await this.prisma.vMHealthCheckQueue.deleteMany({
      where: {
        machineId,
        status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
      }
    })

    console.log(`🗂️ Cleared queue for VM ${machineId}`)
  }

  /**
   * Get overall scan interval for a specific VM (per-VM config overrides global)
   */
  public async getOverallScanIntervalMinutes (machineId: string): Promise<number> {
    try {
      // Check for per-VM configuration first
      const vmConfig = await this.prisma.vMHealthConfig.findUnique({
        where: { machineId },
        select: { checkIntervalMinutes: true }
      })

      if (vmConfig?.checkIntervalMinutes) {
        return vmConfig.checkIntervalMinutes
      }

      // Fall back to environment variable if set and valid
      const envInterval = process.env.OVERALL_SCAN_INTERVAL_MINUTES
      if (envInterval) {
        const parsed = Number(envInterval)
        if (!isNaN(parsed) && parsed > 0) {
          return parsed
        }
      }

      // Default to global constant
      return OVERALL_SCAN_INTERVAL_MINUTES
    } catch (error) {
      console.error(`🗂️ Failed to get scan interval for VM ${machineId}, using default:`, error)
      return OVERALL_SCAN_INTERVAL_MINUTES
    }
  }

  /**
   * Clean up orphaned tasks for deleted VMs
   */
  public async cleanupOrphanedTasks (): Promise<void> {
    try {
      // Get all VMs with DELETED status
      const deletedVMs = await this.prisma.machine.findMany({
        where: { status: 'DELETED' },
        select: { id: true }
      })

      if (deletedVMs.length === 0) {
        return
      }

      const deletedVMIds = deletedVMs.map(vm => vm.id)

      // Clear in-memory queues for deleted VMs
      for (const vmId of deletedVMIds) {
        this.inMemoryQueues.delete(vmId)
      }

      // Delete pending tasks for deleted VMs
      const deletedCount = await this.prisma.vMHealthCheckQueue.deleteMany({
        where: {
          machineId: { in: deletedVMIds },
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        }
      })

      if (deletedCount.count > 0) {
        console.log(`🗂️ Cleaned up ${deletedCount.count} orphaned tasks for ${deletedVMs.length} deleted VMs`)
      }
    } catch (error) {
      console.error('🗂️ Failed to cleanup orphaned tasks:', error)
    }
  }

  /**
   * Get the timestamp of the last successful overall health scan for a VM
   */
  public async getLastOverallScanTime (machineId: string): Promise<Date | null> {
    try {
      const lastScan = await this.prisma.vMHealthCheckQueue.findFirst({
        where: {
          machineId,
          checkType: 'OVERALL_STATUS',
          status: 'COMPLETED'
        },
        orderBy: {
          completedAt: 'desc'
        },
        select: {
          completedAt: true
        }
      })

      return lastScan?.completedAt || null
    } catch (error) {
      console.error(`🗂️ Failed to get last overall scan time for VM ${machineId}:`, error)
      return null
    }
  }

  /**
   * Sync pending tasks from database for a specific VM
   */
  public async loadPendingTasksForVm (machineId: string): Promise<void> {
    try {
      const pendingTasks = await this.prisma.vMHealthCheckQueue.findMany({
        where: {
          machineId,
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledFor: 'asc' }
        ]
      })

      // Initialize queue if it doesn't exist
      if (!this.inMemoryQueues.has(machineId)) {
        this.inMemoryQueues.set(machineId, [])
      }

      const currentQueue = this.inMemoryQueues.get(machineId)!

      // Add new tasks that aren't already in memory
      for (const task of pendingTasks) {
        const existsInMemory = currentQueue.some(memTask => memTask.id === task.id)
        if (!existsInMemory) {
          const queuedCheck: QueuedHealthCheck = {
            id: task.id,
            machineId: task.machineId,
            checkType: task.checkType,
            priority: task.priority,
            attempts: task.attempts,
            maxAttempts: task.maxAttempts,
            scheduledFor: task.scheduledFor,
            payload: this.parsePayload(task.payload),
            createdAt: task.createdAt
          }
          currentQueue.push(queuedCheck)
        }
      }

      // Sort queue by priority after adding new tasks
      this.sortQueue(machineId)
    } catch (error) {
      console.error(`🗂️ Failed to load pending tasks for VM ${machineId}:`, error)
    }
  }

  /**
   * Get ready tasks with DB-level locking for cross-process safety
   */
  private async getReadyTasksWithLocking (machineId: string, maxTasks: number): Promise<QueuedHealthCheck[]> {
    try {
      // Use database transaction to atomically claim tasks
      const claimedTasks = await this.prisma.$transaction(async (tx) => {
        // Find ready tasks that aren't already running
        const readyTasks = await tx.vMHealthCheckQueue.findMany({
          where: {
            machineId,
            status: { in: ['PENDING', 'RETRY_SCHEDULED'] },
            scheduledFor: { lte: new Date() }
          },
          orderBy: [
            { priority: 'asc' },
            { scheduledFor: 'asc' }
          ],
          take: maxTasks
        })

        if (readyTasks.length === 0) {
          return []
        }

        // Mark tasks as RUNNING to claim them
        const taskIds = readyTasks.map(task => task.id)
        await tx.vMHealthCheckQueue.updateMany({
          where: {
            id: { in: taskIds },
            status: { in: ['PENDING', 'RETRY_SCHEDULED'] } // Double-check status hasn't changed
          },
          data: {
            status: 'RUNNING',
            executedAt: new Date()
          }
        })

        return readyTasks
      })

      // Convert to QueuedHealthCheck format
      return claimedTasks.map(task => ({
        id: task.id,
        machineId: task.machineId,
        checkType: task.checkType,
        priority: task.priority,
        attempts: task.attempts,
        maxAttempts: task.maxAttempts,
        scheduledFor: task.scheduledFor,
        payload: this.parsePayload(task.payload),
        createdAt: task.createdAt
      }))
    } catch (error) {
      console.error(`🗂️ Failed to get ready tasks with locking for VM ${machineId}:`, error)
      return []
    }
  }

  /**
   * Sync all pending tasks from database
   */
  public async syncFromDatabase (): Promise<void> {
    try {
      const pendingTasks = await this.prisma.vMHealthCheckQueue.findMany({
        where: {
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledFor: 'asc' }
        ]
      })

      // Group tasks by machine ID
      const tasksByMachine = new Map<string, typeof pendingTasks>()
      for (const task of pendingTasks) {
        if (!tasksByMachine.has(task.machineId)) {
          tasksByMachine.set(task.machineId, [])
        }
        tasksByMachine.get(task.machineId)!.push(task)
      }

      // Update in-memory queues
      for (const [machineId, tasks] of tasksByMachine) {
        if (!this.inMemoryQueues.has(machineId)) {
          this.inMemoryQueues.set(machineId, [])
        }

        const currentQueue = this.inMemoryQueues.get(machineId)!

        // Add new tasks that aren't already in memory
        for (const task of tasks) {
          const existsInMemory = currentQueue.some(memTask => memTask.id === task.id)
          if (!existsInMemory) {
            const queuedCheck: QueuedHealthCheck = {
              id: task.id,
              machineId: task.machineId,
              checkType: task.checkType,
              priority: task.priority,
              attempts: task.attempts,
              maxAttempts: task.maxAttempts,
              scheduledFor: task.scheduledFor,
              payload: this.parsePayload(task.payload),
              createdAt: task.createdAt
            }
            currentQueue.push(queuedCheck)
          }
        }

        // Sort queue by priority after adding new tasks
        this.sortQueue(machineId)
      }
    } catch (error) {
      console.error('🗂️ Failed to sync from database:', error)
    }
  }

  /**
   * Get or create today's snapshot with snapshot-scoped expected checks
   */
  private async getOrCreateTodaySnapshot(machineId: string, expectedChecks: number, scheduledCheckTypes: HealthCheckType[]): Promise<{ id: string }> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: {
        machineId,
        snapshotDate: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        }
      }
    })

    if (!snapshot) {
      // Create new snapshot with snapshot-scoped expected checks and scheduled check types
      const snapshotMetadata = {
        expectedChecks,
        scheduledCheckTypes,
        createdFor: 'snapshot-scoped-tracking',
        timestamp: new Date().toISOString()
      }

      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
          // Store snapshot-scoped metadata in customCheckResults until schema extension
          customCheckResults: snapshotMetadata
        }
      })

      console.log(`📊 Created snapshot ${snapshot.id} for VM ${machineId} with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`)
    } else {
      // Update existing snapshot with new expected checks if not already set
      const existingMetadata = snapshot.customCheckResults as any
      if (!existingMetadata?.expectedChecks) {
        const snapshotMetadata = {
          ...existingMetadata,
          expectedChecks,
          scheduledCheckTypes,
          updatedFor: 'snapshot-scoped-tracking',
          timestamp: new Date().toISOString()
        }

        await this.prisma.vMHealthSnapshot.update({
          where: { id: snapshot.id },
          data: {
            customCheckResults: snapshotMetadata
          }
        })

        console.log(`📊 Updated snapshot ${snapshot.id} for VM ${machineId} with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`)
      }
    }

    return { id: snapshot.id }
  }

  /**
   * Queue health check for a specific snapshot (snapshot-scoped version)
   */
  private async queueHealthCheckForSnapshot(
    machineId: string,
    checkType: HealthCheckType,
    priority: TaskPriority = 'MEDIUM',
    snapshotId: string,
    payload?: HealthCheckPayload,
    vm?: { id: string; name: string; status: string }
  ): Promise<string> {
    // Use the existing queueHealthCheck logic but associate with snapshot
    // For now, we'll use the existing method and add snapshot association in a comment
    // In the future, this should add snapshotId to the queue entry

    const taskId = await this.queueHealthCheck(machineId, checkType, priority, payload, vm)

    // TODO: Add snapshotId field to VMHealthCheckQueue schema and associate here
    // This would enable precise snapshot-scoped queue queries
    console.log(`📋 Queued health check ${checkType} for VM ${machineId} associated with snapshot ${snapshotId}`)

    return taskId
  }

  /**
   * Update snapshot with recommendation metadata for quick reads
   * NOTE: This method assumes VMHealthSnapshot schema includes recommendationCount (int)
   * and recommendationsGeneratedAt (DateTime) fields. If not available, implement via
   * a separate metadata table or JSON field until schema can be updated.
   */
  private async updateSnapshotRecommendationMetadata(snapshotId: string, recommendationCount: number): Promise<void> {
    try {
      // Get existing metadata to preserve snapshot-scoped data
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { customCheckResults: true }
      })

      const existingMetadata = (snapshot?.customCheckResults as any) || {}

      // Merge recommendation metadata with existing snapshot-scoped data
      const updatedMetadata = {
        ...existingMetadata,
        recommendationCount: recommendationCount,
        recommendationsGeneratedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: {
          customCheckResults: updatedMetadata
        }
      })

      console.log(`📊 Updated snapshot ${snapshotId} with recommendation metadata: ${recommendationCount} recommendations generated`)
    } catch (error) {
      console.error(`❌ Failed to update snapshot recommendation metadata for ${snapshotId}:`, error)
      // Don't throw to avoid breaking recommendation workflow
    }
  }

  /**
   * Backfill expectedChecks in snapshot metadata for consistency
   */
  private async backfillSnapshotExpectedChecks(snapshotId: string, expectedChecks: number, source: string): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { customCheckResults: true }
      })

      if (!snapshot) return

      const existingMetadata = (snapshot.customCheckResults as any) || {}

      const updatedMetadata = {
        ...existingMetadata,
        expectedChecks,
        backfilledFrom: source,
        backfilledAt: new Date().toISOString()
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: {
          customCheckResults: updatedMetadata
        }
      })

      console.log(`📋 Backfilled snapshot ${snapshotId} with expectedChecks: ${expectedChecks} (source: ${source})`)
    } catch (error) {
      console.error(`❌ Failed to backfill snapshot ${snapshotId}:`, error)
      // Don't throw to avoid breaking workflow
    }
  }
}

// Singleton instance
let vmHealthQueueManagerInstance: VMHealthQueueManager | null = null

export function getVMHealthQueueManager (
  prisma: PrismaClient,
  eventManager: EventManager
): VMHealthQueueManager {
  if (!vmHealthQueueManagerInstance) {
    vmHealthQueueManagerInstance = new VMHealthQueueManager(prisma, eventManager)
  }
  return vmHealthQueueManagerInstance
}
