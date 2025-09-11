import { PrismaClient, HealthCheckType, TaskStatus, TaskPriority } from '@prisma/client'
import { EventManager } from './EventManager'
import { getVirtioSocketWatcherService, CommandResponse } from './VirtioSocketWatcherService'
import { v4 as uuidv4 } from 'uuid'

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
  private readonly MAX_CONCURRENT_CHECKS_PER_VM = 5
  private readonly MAX_SYSTEM_WIDE_CONCURRENT = 50
  private activeChecks = new Set<string>()

  constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    // Load existing queues from database on startup
    this.loadQueuesFromDatabase()
  }

  /**
   * Queue all standard health checks for a VM
   */
  async queueHealthChecks (machineId: string): Promise<void> {
    const standardChecks: HealthCheckType[] = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES',
      'WINDOWS_DEFENDER',
      'APPLICATION_INVENTORY'
    ]

    const queuePromises = standardChecks.map(checkType =>
      this.queueHealthCheck(machineId, checkType, 'MEDIUM')
    )

    await Promise.all(queuePromises)
  }

  /**
   * Queue a single health check for a VM
   */
  async queueHealthCheck (
    machineId: string,
    checkType: HealthCheckType,
    priority: TaskPriority = 'MEDIUM',
    payload?: HealthCheckPayload
  ): Promise<string> {
    // Check if VM exists
    const vm = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, name: true, status: true }
    })

    if (!vm) {
      throw new Error(`VM with ID ${machineId} not found`)
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
      maxAttempts: 3,
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
        maxAttempts: 3,
        scheduledFor: queuedCheck.scheduledFor
      }
    })

    // Sort queue by priority
    this.sortQueue(machineId)

    // Emit queue updated event
    await this.eventManager.dispatchEvent('health', 'status_changed', {
      machineId,
      queueSize: this.getQueueSize(machineId),
      checkType,
      action: 'queued'
    })

    console.log(`🗂️ Queued health check ${checkType} for VM ${vm.name} (${machineId})`)
    return queuedCheck.id
  }

  /**
   * Process queue for a specific VM when it comes online
   */
  async processQueue (machineId: string): Promise<void> {
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

    // Get ready tasks (sorted by priority)
    const readyTasks = queue.filter(task =>
      new Date() >= task.scheduledFor &&
      task.attempts < task.maxAttempts
    ).slice(0, this.MAX_CONCURRENT_CHECKS_PER_VM - vmActiveChecks.length)

    if (readyTasks.length === 0) {
      return
    }

    console.log(`🗂️ Processing ${readyTasks.length} health checks for VM ${machineId}`)

    // Process tasks concurrently
    const processingPromises = readyTasks.map(async task => {
      const checkId = `${machineId}_${task.id}`
      this.activeChecks.add(checkId)

      try {
        await this.executeHealthCheck(task)
        await this.removeFromQueue(machineId, task.id)
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
      // Update status to RUNNING
      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
          executedAt: new Date(),
          attempts: task.attempts + 1
        }
      })

      // Get VirtioSocketWatcherService for health check execution
      const virtioService = getVirtioSocketWatcherService()

      // Execute the health check via InfiniService
      let result: CommandResponse
      switch (task.checkType) {
      case 'OVERALL_STATUS':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'RunAllHealthChecks', params: task.payload || undefined },
          300000 // 5 minutes timeout
        )
        break
      case 'DISK_SPACE':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'CheckDiskSpace', params: task.payload || undefined },
          60000 // 1 minute timeout
        )
        break
      case 'RESOURCE_OPTIMIZATION':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'CheckResourceOptimization', params: task.payload || undefined },
          120000 // 2 minutes timeout
        )
        break
      case 'WINDOWS_UPDATES':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'CheckWindowsUpdates', params: task.payload || undefined },
          300000 // 5 minutes timeout
        )
        break
      case 'WINDOWS_DEFENDER':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'CheckWindowsDefender', params: task.payload || undefined },
          60000 // 1 minute timeout
        )
        break
      case 'APPLICATION_INVENTORY':
        result = await virtioService.sendSafeCommand(
          task.machineId,
          { action: 'GetInstalledApplicationsWMI', params: task.payload || undefined },
          180000 // 3 minutes timeout
        )
        break
      default:
        throw new Error(`Unsupported health check type: ${task.checkType}`)
      }

      const executionTime = Date.now() - startTime

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

      console.log(`🩺 Completed health check ${task.checkType} for VM ${task.machineId} (${executionTime}ms)`)
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error(`🩺 Health check ${task.checkType} failed for VM ${task.machineId}:`, error)

      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: (error as Error).message,
          executionTimeMs: executionTime
        }
      })

      throw error
    }
  }

  /**
   * Handle task failure with retry logic
   */
  private async handleTaskFailure (task: QueuedHealthCheck, error: Error): Promise<void> {
    task.attempts++

    if (task.attempts >= task.maxAttempts) {
      // Max retries reached, remove from queue
      await this.removeFromQueue(task.machineId, task.id)
      console.log(`🗂️ Health check ${task.checkType} for VM ${task.machineId} failed after ${task.maxAttempts} attempts`)
    } else {
      // Schedule retry with exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, task.attempts - 1), 30000)
      task.scheduledFor = new Date(Date.now() + backoffMs)

      await this.prisma.vMHealthCheckQueue.update({
        where: { id: task.id },
        data: {
          status: 'RETRY_SCHEDULED',
          scheduledFor: task.scheduledFor,
          attempts: task.attempts
        }
      })

      console.log(`🗂️ Retrying health check ${task.checkType} for VM ${task.machineId} in ${backoffMs}ms (attempt ${task.attempts}/${task.maxAttempts})`)
    }

    // Emit failure event
    await this.eventManager.dispatchEvent('health', 'status_changed', {
      machineId: task.machineId,
      checkType: task.checkType,
      status: task.attempts >= task.maxAttempts ? 'failed' : 'retry_scheduled',
      error: error.message,
      attempts: task.attempts
    })
  }

  /**
   * Remove task from queue
   */
  private async removeFromQueue (machineId: string, taskId: string): Promise<void> {
    // Remove from in-memory queue
    const queue = this.inMemoryQueues.get(machineId) || []
    const filteredQueue = queue.filter(task => task.id !== taskId)
    this.inMemoryQueues.set(machineId, filteredQueue)

    // Remove from database (keep completed/failed records for history)
    // Only delete pending/retry_scheduled tasks
    await this.prisma.vMHealthCheckQueue.deleteMany({
      where: {
        id: taskId,
        status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
      }
    })
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
      // Create new snapshot
      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING', // Will be updated when all checks complete
          checksCompleted: 0,
          checksFailed: 0
        }
      })
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
}
