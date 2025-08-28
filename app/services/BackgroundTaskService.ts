import { PrismaClient } from '@prisma/client'
import { EventManager } from './EventManager'
import { ErrorHandler, AppError, ErrorCode } from '../utils/errors/ErrorHandler'
import { v4 as uuidv4 } from 'uuid'

export interface BackgroundTask {
  id: string
  name: string
  execute: () => Promise<void>
  onError?: (error: Error) => Promise<void>
  retryPolicy?: RetryPolicy
}

export interface RetryPolicy {
  maxRetries: number
  backoffMs: number
  backoffMultiplier: number
  maxBackoffMs: number
}

export interface TaskState {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startTime: number
  endTime?: number
  retryCount: number
  error?: Error
}

export class BackgroundTaskService {
  private tasks = new Map<string, TaskState>()
  private errorHandler: ErrorHandler
  private runningTasks = new Set<string>()

  constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    this.errorHandler = ErrorHandler.getInstance()
  }

  async executeTask (task: BackgroundTask): Promise<void> {
    const taskState: TaskState = {
      id: task.id,
      name: task.name,
      status: 'running',
      startTime: Date.now(),
      retryCount: 0
    }

    this.tasks.set(task.id, taskState)
    this.runningTasks.add(task.id)

    try {
      await this.executeWithRetry(task, taskState)
      taskState.status = 'completed'
      taskState.endTime = Date.now()
      await this.notifyCompletion(task)
    } catch (error) {
      taskState.status = 'failed'
      taskState.error = error as Error
      taskState.endTime = Date.now()
      await this.handleTaskFailure(task, error as Error)
    } finally {
      this.runningTasks.delete(task.id)
      // Keep task state for a while for debugging
      setTimeout(() => {
        this.tasks.delete(task.id)
      }, 300000) // 5 minutes
    }
  }

  private async executeWithRetry (
    task: BackgroundTask,
    state: TaskState
  ): Promise<void> {
    const policy = task.retryPolicy || this.getDefaultRetryPolicy()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = this.calculateBackoff(attempt, policy)
          await this.delay(backoff)
          console.log(`Retrying task ${task.name} (attempt ${attempt + 1}/${policy.maxRetries + 1}) after ${backoff}ms backoff`)
        }

        await task.execute()
        return // Success
      } catch (error) {
        lastError = error as Error
        state.retryCount = attempt

        await this.logRetry(task, attempt, lastError)

        if (attempt === policy.maxRetries) {
          throw lastError
        }
      }
    }

    if (lastError) {
      throw lastError
    }
  }

  private calculateBackoff (attempt: number, policy: RetryPolicy): number {
    const backoff = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1)
    return Math.min(backoff, policy.maxBackoffMs)
  }

  private async handleTaskFailure (task: BackgroundTask, error: Error): Promise<void> {
    // Execute custom error handler if provided
    if (task.onError) {
      try {
        await task.onError(error)
      } catch (handlerError) {
        console.error(`Error handler failed for task ${task.id}:`, handlerError)
      }
    }

    // Log to error tracking
    await this.errorHandler.handleError(
      new AppError(
        `Background task failed: ${task.name}`,
        ErrorCode.INTERNAL_ERROR,
        500,
        true,
        {
          taskId: task.id,
          taskName: task.name,
          error: error.message
        }
      )
    )

    // Emit failure event
    await this.eventManager.dispatchEvent('background_task', 'status_changed', {
      taskId: task.id,
      taskName: task.name,
      status: 'failed',
      error: error.message
    })
  }

  private getDefaultRetryPolicy (): RetryPolicy {
    return {
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 30000
    }
  }

  private delay (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async logRetry (task: BackgroundTask, attempt: number, error: Error): Promise<void> {
    console.log(`Retrying task ${task.name} (attempt ${attempt + 1}):`, error.message)
    
    await this.eventManager.dispatchEvent('background_task', 'status_changed', {
      taskId: task.id,
      taskName: task.name,
      status: 'retrying',
      attempt: attempt + 1,
      error: error.message
    })
  }

  private async notifyCompletion (task: BackgroundTask): Promise<void> {
    await this.eventManager.dispatchEvent('background_task', 'status_changed', {
      taskId: task.id,
      taskName: task.name,
      status: 'completed'
    })
  }

  // Queue a task for immediate execution
  async queueTask (
    name: string,
    execute: () => Promise<void>,
    options?: {
      onError?: (error: Error) => Promise<void>
      retryPolicy?: RetryPolicy
    }
  ): Promise<string> {
    const task: BackgroundTask = {
      id: uuidv4(),
      name,
      execute,
      onError: options?.onError,
      retryPolicy: options?.retryPolicy
    }

    // Execute in background
    setImmediate(() => {
      this.executeTask(task).catch(error => {
        console.error(`Failed to execute background task ${task.id}:`, error)
      })
    })

    return task.id
  }

  // Get status of a specific task
  getTaskStatus (taskId: string): TaskState | undefined {
    return this.tasks.get(taskId)
  }

  // Get all running tasks
  getRunningTasks (): TaskState[] {
    return Array.from(this.runningTasks)
      .map(id => this.tasks.get(id))
      .filter((task): task is TaskState => task !== undefined)
  }

  // Cancel a running task (if possible)
  async cancelTask (taskId: string): Promise<boolean> {
    if (!this.runningTasks.has(taskId)) {
      return false
    }

    const taskState = this.tasks.get(taskId)
    if (taskState) {
      taskState.status = 'failed'
      taskState.error = new Error('Task cancelled by user')
      taskState.endTime = Date.now()
    }

    this.runningTasks.delete(taskId)

    await this.eventManager.dispatchEvent('background_task', 'status_changed', {
      taskId,
      status: 'cancelled'
    })

    return true
  }

  // Get statistics about background tasks
  getStatistics (): {
    total: number
    running: number
    completed: number
    failed: number
  } {
    const stats = {
      total: this.tasks.size,
      running: 0,
      completed: 0,
      failed: 0
    }

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'running':
          stats.running++
          break
        case 'completed':
          stats.completed++
          break
        case 'failed':
          stats.failed++
          break
      }
    }

    return stats
  }
}