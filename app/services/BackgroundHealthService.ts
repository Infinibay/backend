import { PrismaClient } from '@prisma/client'
import { CronJob } from 'cron'
import { EventManager } from './EventManager'
import { BackgroundTaskService } from './BackgroundTaskService'
import { VMHealthQueueManager } from './VMHealthQueueManager'
import { v4 as uuidv4 } from 'uuid'

export class BackgroundHealthService {
  private cronJob: CronJob | null = null
  private isRunning = false

  constructor (
    private prisma: PrismaClient,
    private backgroundTaskService: BackgroundTaskService,
    private eventManager: EventManager,
    private queueManager: VMHealthQueueManager
  ) {}

  /**
   * Initialize and start the background health monitoring system
   * Schedules daily health checks at 2 AM
   */
  public start (): void {
    if (this.cronJob) {
      console.log('BackgroundHealthService is already running')
      return
    }

    // Daily at 2 AM - '0 2 * * *'
    this.cronJob = new CronJob('0 2 * * *', async () => {
      await this.executeHealthCheckRound()
    })

    this.cronJob.start()
    console.log('🩺 BackgroundHealthService started - daily health checks scheduled at 2 AM')
  }

  /**
   * Stop the background health monitoring system
   */
  public stop (): void {
    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
      console.log('🩺 BackgroundHealthService stopped')
    }
  }

  /**
   * Execute a complete round of health checks for all active VMs
   */
  public async executeHealthCheckRound (): Promise<void> {
    if (this.isRunning) {
      console.log('🩺 Health check round already in progress, skipping')
      return
    }

    const startTime = Date.now()
    this.isRunning = true

    try {
      // Queue background task for execution
      const taskId = await this.backgroundTaskService.queueTask(
        'daily-health-check-round',
        async () => {
          await this.performHealthCheckRound()
        },
        {
          retryPolicy: {
            maxRetries: 2,
            backoffMs: 5000,
            backoffMultiplier: 2,
            maxBackoffMs: 30000
          },
          onError: async (error: Error) => {
            console.error('🩺 Daily health check round failed:', error)
            await this.eventManager.dispatchEvent('health', 'round_failed', {
              error: error.message,
              timestamp: new Date().toISOString()
            })
          }
        }
      )

      console.log(`🩺 Daily health check round queued with task ID: ${taskId}`)
    } catch (error) {
      console.error('🩺 Failed to queue daily health check round:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Perform the actual health check round implementation
   */
  private async performHealthCheckRound (): Promise<void> {
    const startTime = Date.now()

    try {
      // Get all active VMs (exclude DELETED status)
      const activeVMs = await this.prisma.machine.findMany({
        where: {
          status: { not: 'DELETED' }
        },
        select: {
          id: true,
          name: true,
          status: true,
          os: true,
          internalName: true
        }
      })

      console.log(`🩺 Starting health check round for ${activeVMs.length} VMs`)

      // Emit round started event
      await this.eventManager.dispatchEvent('health', 'round_started', {
        vmCount: activeVMs.length,
        timestamp: new Date().toISOString()
      })

      let successCount = 0
      let failureCount = 0

      // Queue health checks for each VM
      for (const vm of activeVMs) {
        try {
          await this.queueManager.queueHealthChecks(vm.id)
          successCount++
          console.log(`🩺 Queued health checks for VM: ${vm.name} (${vm.id})`)
        } catch (error) {
          failureCount++
          console.error(`🩺 Failed to queue health checks for VM ${vm.name}:`, error)
        }
      }

      const executionTime = Date.now() - startTime

      // Emit round completed event
      await this.eventManager.dispatchEvent('health', 'round_completed', {
        totalVMs: activeVMs.length,
        successCount,
        failureCount,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      })

      console.log(`🩺 Health check round completed: ${successCount} success, ${failureCount} failures (${executionTime}ms)`)
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error('🩺 Health check round failed:', error)

      await this.eventManager.dispatchEvent('health', 'round_failed', {
        error: (error as Error).message,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      })

      throw error
    }
  }

  /**
   * Manually trigger a health check round (for testing/debugging)
   */
  public async triggerHealthCheckRound (): Promise<string> {
    const taskId = uuidv4()

    console.log(`🩺 Manually triggering health check round (task: ${taskId})`)

    // Execute immediately without cron
    setImmediate(async () => {
      try {
        await this.executeHealthCheckRound()
      } catch (error) {
        console.error('🩺 Manually triggered health check round failed:', error)
      }
    })

    return taskId
  }

  /**
   * Get health check service status
   */
  public getStatus (): {
    isRunning: boolean
    cronActive: boolean
    nextRun: Date | null
    } {
    return {
      isRunning: this.isRunning,
      cronActive: this.cronJob !== null && this.cronJob.running,
      nextRun: this.cronJob ? this.cronJob.nextDate().toJSDate() : null
    }
  }

  /**
   * Update cron schedule (for configuration changes)
   */
  public updateSchedule (cronExpression: string): void {
    if (this.cronJob) {
      this.cronJob.stop()
    }

    this.cronJob = new CronJob(cronExpression, async () => {
      await this.executeHealthCheckRound()
    })

    this.cronJob.start()
    console.log(`🩺 BackgroundHealthService schedule updated to: ${cronExpression}`)
  }
}
