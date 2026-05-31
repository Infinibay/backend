import logger from '@main/logger'
import { PrismaClient, HealthCheckType, TaskPriority } from '@prisma/client'
import { EventManager } from './EventManager'
import { MachineStatus } from '../graphql/resolvers/machine/type'
import { v4 as uuidv4 } from 'uuid'
import { VMRecommendationService } from './VMRecommendationService'
import { VMHealthQueueRepository } from './VMHealthQueueRepository'
import type { QueuedHealthCheck } from './VMHealthQueueRepository'
import { HealthCheckConcurrencyManager } from './HealthCheckConcurrencyManager'
import { HealthCheckExecutor, DEFAULT_MAX_ATTEMPTS } from './HealthCheckExecutor'
import { HealthSnapshotManager } from './HealthSnapshotManager'

// Re-export types from repository for backward compatibility
export { type QueuedHealthCheck } from './VMHealthQueueRepository'

// Health check payload — compatible with Prisma JSON fields
export interface HealthCheckPayload {
  [key: string]: string | number | boolean | undefined
}

// Configuration constants for health monitoring intervals
export const OVERALL_SCAN_INTERVAL_MINUTES = 60 // 1 hour
export const QUEUE_PROCESSING_INTERVAL_SECONDS = 30 // 30 seconds


export class VMHealthQueueManager {
  private inMemoryQueues: Map<string, QueuedHealthCheck[]> = new Map()
  private readonly MAX_QUEUE_SIZE_PER_VM = 100
  private readonly repository: VMHealthQueueRepository
  private readonly healthCheckExecutor: HealthCheckExecutor
  private readonly concurrencyManager: HealthCheckConcurrencyManager
  private readonly snapshotManager: HealthSnapshotManager
  private recommendationService: VMRecommendationService

  constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    this.repository = new VMHealthQueueRepository(prisma)
    this.concurrencyManager = new HealthCheckConcurrencyManager()
    this.recommendationService = new VMRecommendationService(this.prisma)
    this.snapshotManager = new HealthSnapshotManager(
      this.repository,
      this.eventManager,
      this.prisma,
      this.recommendationService,
    )
    this.healthCheckExecutor = new HealthCheckExecutor(
      this.repository,
      this.eventManager,
      this.snapshotManager,
    )

    try {
      logger.info('✅ VMRecommendationService initialized successfully')

      // Validate configuration on startup
      this.validateConfiguration()

      // Load existing queues from database on startup
      this.loadQueuesFromDatabase()
    } catch (error) {
      logger.error('❌ Failed to initialize VMHealthQueueManager:', error)
      throw error
    }
  }

  /**
   * Validate configuration on startup
   */
  private validateConfiguration (): void {
    try {
      // Validate VMRecommendationService
      if (!this.recommendationService) {
        throw new Error('VMRecommendationService initialization failed')
      }

      // Validate required environment variables
      const requiredEnvVars = ['DATABASE_URL', 'RPC_URL', 'APP_HOST']
      const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

      if (missingEnvVars.length > 0) {
        logger.warn(`⚠️ Missing environment variables: ${missingEnvVars.join(', ')}`)
      }

      // Log configuration status
      const enabledCheckTypes = this.getEnabledCheckTypes()
      logger.info('🔧 Health check configuration:')
      logger.info(`   - Enabled check types: ${enabledCheckTypes.join(', ')}`)
      logger.info(`   - Concurrency limits managed by HealthCheckConcurrencyManager`)
      logger.info(`   - Overall scan interval: ${OVERALL_SCAN_INTERVAL_MINUTES} minutes`)

      logger.info('✅ VMHealthQueueManager configuration validated successfully')
    } catch (error) {
      logger.error('❌ Configuration validation failed:', error)
      throw error
    }
  }

  /**
   * Queue all standard health checks for a VM
   */
  async queueHealthChecks (machineId: string): Promise<void> {
    // Check if VM exists and is running before queuing any health checks
    const vm = await this.repository.findMachine(machineId)

    if (!vm) {
      throw new Error(`VM with ID ${machineId} not found`)
    }

    if (vm.status !== MachineStatus.RUNNING || !vm.setupComplete) {
      logger.info(`🗂️ Skipping health checks for VM ${vm.name} (${machineId}) - status='${vm.status}' setupComplete=${vm.setupComplete}`)
      return
    }

    const isWindows = vm.os?.toLowerCase().includes('windows') ?? false

    // Cross-platform checks
    const standardChecks: HealthCheckType[] = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'APPLICATION_INVENTORY',
      'APPLICATION_UPDATES'
    ]

    // OS-specific checks
    if (isWindows) {
      standardChecks.push('WINDOWS_UPDATES', 'WINDOWS_DEFENDER')
    } else {
      standardChecks.push('LINUX_UPDATES')
    }

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
          logger.info(`🗂️ Skipped health check due to VM status: ${error.message}`)
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
    vm?: { id: string; name: string; status: string; setupComplete: boolean }
  ): Promise<string> {
    // Use provided VM object or fetch from database
    let vmData = vm
    if (!vmData) {
      const fetchedVm = await this.repository.findMachine(machineId)

      if (!fetchedVm) {
        throw new Error(`VM with ID ${machineId} not found`)
      }
      vmData = fetchedVm
    }

    // Idempotency guard: check for existing pending/running tasks of the same type first
    // This preserves the duplicate-return behavior regardless of VM status
    const existingTask = await this.repository.findExistingTask(machineId, checkType)

    if (existingTask) {
      logger.info(`🗂️ Skipping duplicate health check ${checkType} for VM ${vmData.name} (${machineId}) - task already exists`)
      return existingTask.id
    }

    // Check if VM is running and OS is ready before queuing new health check
    if (vmData.status !== MachineStatus.RUNNING || !vmData.setupComplete) {
      logger.info(`🗂️ Skipping health check ${checkType} for VM ${vmData.name} (${machineId}) - status='${vmData.status}' setupComplete=${vmData.setupComplete}`)
      throw new Error(`Cannot queue health check for VM ${vmData.name} (${machineId}) - status='${vmData.status}' setupComplete=${vmData.setupComplete}`)
    }

    // For OVERALL_STATUS, also check if completed recently within per-VM interval
    if (checkType === 'OVERALL_STATUS') {
      const scanIntervalMinutes = await this.getOverallScanIntervalMinutes(machineId)
      const scanIntervalMs = scanIntervalMinutes * 60 * 1000
      const recentScan = await this.repository.findRecentCompletedOverallScan(machineId, scanIntervalMs)

      if (recentScan) {
        logger.info(`🗂️ Skipping OVERALL_STATUS check for VM ${vmData.name} (${machineId}) - completed recently (interval: ${scanIntervalMinutes}min)`)
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
    await this.repository.insertTask(
      machineId,
      checkType,
      priority,
      payload,
      DEFAULT_MAX_ATTEMPTS,
      queuedCheck.id,
      queuedCheck.scheduledFor
    )

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

    logger.info(`🗂️ Queued health check ${checkType} for VM ${vmData.name} (${machineId})`)
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

    // Quick system-wide guard — avoid unnecessary DB call when system is saturated
    if (this.concurrencyManager.getActiveCount() >= 50) {
      logger.info(`🗂️ System-wide concurrent limit reached, delaying VM ${machineId} queue processing`)
      return
    }

    // Get ready tasks (sorted by priority) with DB-level locking
    const slotsAvailable = Math.max(0, 2 - this.concurrencyManager.getVmActiveCount(machineId))
    const allReadyTasks = await this.getReadyTasksWithLocking(machineId, slotsAvailable)

    // Filter tasks that can actually run given current concurrency state
    const readyTasks = allReadyTasks.filter(task => {
      const check = this.concurrencyManager.canExecute(machineId, task.checkType)
      if (!check.allowed) {
        logger.info(`🗂️ ${check.reason}, skipping task ${task.id}`)
        return false
      }
      return true
    })

    if (readyTasks.length === 0) {
      return
    }

    // Queue latency metrics
    const now = Date.now()
    const latencies = readyTasks.map(task => now - (task.scheduledFor instanceof Date ? task.scheduledFor.getTime() : new Date(task.scheduledFor).getTime()))
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
    const maxLatency = latencies.length ? Math.max(...latencies) : 0
    logger.info(`🗂️ Processing ${readyTasks.length} health checks for VM ${machineId} (avg queue latency: ${avgLatency}ms, max: ${maxLatency}ms)`)

    // Process tasks concurrently — delegate execution to HealthCheckExecutor
    const processingPromises = readyTasks.map(async task => {
      this.concurrencyManager.markRunning(task.id, machineId, task.checkType)

      try {
        await this.healthCheckExecutor.executeHealthCheck(task)
        await this.removeFromQueue(machineId, task.id, false) // Don't delete completed tasks from DB
      } catch (error) {
        // handleTaskFailure returns true if the task should be retried
        const shouldRetry = await this.healthCheckExecutor.handleTaskFailure(task, error as Error)
        if (!shouldRetry) {
          await this.removeFromQueue(machineId, task.id, false) // Keep failed record in DB
        }
      } finally {
        this.concurrencyManager.markDone(task.id, machineId)
      }
    })

    await Promise.allSettled(processingPromises)
  }

  private async removeFromQueue (machineId: string, taskId: string, deleteFromDB: boolean = true): Promise<void> {
    // Remove from in-memory queue
    const queue = this.inMemoryQueues.get(machineId) || []
    const filteredQueue = queue.filter(task => task.id !== taskId)
    this.inMemoryQueues.set(machineId, filteredQueue)

    // Only delete from database if requested
    if (deleteFromDB) {
      await this.repository.deleteTask(taskId)
    }
  }



  /**
   * Get list of enabled check types for health monitoring
   */
  private getEnabledCheckTypes (): string[] {
    // Standard health check types - can be made configurable via environment
    const defaultCheckTypes = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES',
      'WINDOWS_DEFENDER',
      'LINUX_UPDATES',
      'APPLICATION_INVENTORY',
      'APPLICATION_UPDATES'
    ]

    // Check for environment configuration
    const enabledChecks = process.env.HEALTH_CHECK_ENABLED_TYPES?.split(',') || defaultCheckTypes
    return enabledChecks.map(check => check.trim()).filter(Boolean)
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
      const pendingTasks = await this.repository.findAllPendingTasks()

      for (const task of pendingTasks) {
        if (!this.inMemoryQueues.has(task.machineId)) {
          this.inMemoryQueues.set(task.machineId, [])
        }
        this.inMemoryQueues.get(task.machineId)!.push(task)
      }

      logger.info(`🗂️ Loaded ${pendingTasks.length} pending health checks from database`)
    } catch (error) {
      logger.error('🗂️ Failed to load queues from database:', error)
    }
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
      activeChecks: this.concurrencyManager.getActiveCount(),
      vmQueues: this.inMemoryQueues.size
    }
  }

  /**
   * Clear queue for a VM (for maintenance)
   */
  public async clearQueue (machineId: string): Promise<void> {
    this.inMemoryQueues.delete(machineId)
    await this.repository.deleteTasksForVm(machineId)
    logger.info(`🗂️ Cleared queue for VM ${machineId}`)
  }

  /**
   * Get overall scan interval for a specific VM (per-VM config overrides global)
   */
  public async getOverallScanIntervalMinutes (machineId: string): Promise<number> {
    try {
      // Check for per-VM configuration first
      const vmConfig = await this.repository.getVmConfig(machineId)
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
      logger.error(`🗂️ Failed to get scan interval for VM ${machineId}, using default:`, error)
      return OVERALL_SCAN_INTERVAL_MINUTES
    }
  }

  /**
   * Clean up orphaned tasks for deleted VMs
   */
  public async cleanupOrphanedTasks (): Promise<void> {
    try {
      const deletedVMIds = await this.repository.getDeletedVmIds()
      if (deletedVMIds.length === 0) return

      // Clear in-memory queues for deleted VMs
      for (const vmId of deletedVMIds) {
        this.inMemoryQueues.delete(vmId)
      }

      const deletedCount = await this.repository.deleteOrphanedTasks()
      if (deletedCount > 0) {
        logger.info(`🗂️ Cleaned up ${deletedCount} orphaned tasks for ${deletedVMIds.length} deleted VMs`)
      }
    } catch (error) {
      logger.error('🗂️ Failed to cleanup orphaned tasks:', error)
    }
  }

  /**
   * Get the timestamp of the last successful overall health scan for a VM
   */
  public async getLastOverallScanTime (machineId: string): Promise<Date | null> {
    try {
      return await this.repository.getLastOverallScanTime(machineId)
    } catch (error) {
      logger.error(`🗂️ Failed to get last overall scan time for VM ${machineId}:`, error)
      return null
    }
  }

  /**
   * Sync pending tasks from database for a specific VM
   */
  public async loadPendingTasksForVm (machineId: string): Promise<void> {
    try {
      const pendingTasks = await this.repository.findPendingTasksForVm(machineId)

      // Initialize queue if it doesn't exist
      if (!this.inMemoryQueues.has(machineId)) {
        this.inMemoryQueues.set(machineId, [])
      }

      const currentQueue = this.inMemoryQueues.get(machineId)!

      // Add new tasks that aren't already in memory
      for (const task of pendingTasks) {
        const existsInMemory = currentQueue.some(memTask => memTask.id === task.id)
        if (!existsInMemory) {
          currentQueue.push(task)
        }
      }

      // Sort queue by priority after adding new tasks
      this.sortQueue(machineId)
    } catch (error) {
      logger.error(`🗂️ Failed to load pending tasks for VM ${machineId}:`, error)
    }
  }

  /**
   * Get ready tasks with DB-level locking for cross-process safety
   */
  private async getReadyTasksWithLocking (machineId: string, maxTasks: number): Promise<QueuedHealthCheck[]> {
    try {
      return await this.repository.claimReadyTasks(machineId, maxTasks)
    } catch (error) {
      logger.error(`🗂️ Failed to get ready tasks with locking for VM ${machineId}:`, error)
      return []
    }
  }

  /**
   * Sync all pending tasks from database
   */
  public async syncFromDatabase (): Promise<void> {
    try {
      const pendingTasks = await this.repository.findAllPendingTasks()

      // Group tasks by machine ID
      const tasksByMachine = new Map<string, QueuedHealthCheck[]>()
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
            currentQueue.push(task)
          }
        }

        // Sort queue by priority after adding new tasks
        this.sortQueue(machineId)
      }
    } catch (error) {
      logger.error('🗂️ Failed to sync from database:', error)
    }
  }

  /**
   * Get or create today's snapshot with snapshot-scoped expected checks
   */
  private async getOrCreateTodaySnapshot (machineId: string, expectedChecks: number, scheduledCheckTypes: HealthCheckType[]): Promise<{ id: string }> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let snapshot = await this.repository.findTodaySnapshot(machineId)

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

      logger.info(`📊 Created snapshot ${snapshot.id} for VM ${machineId} with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`)
    } else {
      // Update existing snapshot with new expected checks if not already set
      const existingMetadata = snapshot.customCheckResults as Record<string, unknown> | null
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

        logger.info(`📊 Updated snapshot ${snapshot.id} for VM ${machineId} with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`)
      }
    }

    return { id: snapshot.id }
  }

  /**
   * Queue health check for a specific snapshot (snapshot-scoped version)
   */
  private async queueHealthCheckForSnapshot (
    machineId: string,
    checkType: HealthCheckType,
    priority: TaskPriority = 'MEDIUM',
    snapshotId: string,
    payload?: HealthCheckPayload,
    vm?: { id: string; name: string; status: string; setupComplete: boolean }
  ): Promise<string> {
    // Use the existing queueHealthCheck logic but associate with snapshot
    // For now, we'll use the existing method and add snapshot association in a comment
    // In the future, this should add snapshotId to the queue entry

    const taskId = await this.queueHealthCheck(machineId, checkType, priority, payload, vm)

    // TODO: Add snapshotId field to VMHealthCheckQueue schema and associate here
    // This would enable precise snapshot-scoped queue queries
    logger.info(`📋 Queued health check ${checkType} for VM ${machineId} associated with snapshot ${snapshotId}`)

    return taskId
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
