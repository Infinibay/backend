import { CronJob } from 'cron'
import { PrismaClient, MaintenanceTrigger, MaintenanceStatus } from '@prisma/client'
import { MaintenanceService } from '@services/MaintenanceService'
import { Debugger } from '@utils/debug'

const debug = new Debugger('ProcessMaintenanceQueue')

/**
 * Cron job to process scheduled maintenance tasks
 * Runs every minute to check for due maintenance tasks and execute them
 */
export class ProcessMaintenanceQueue {
  private job: CronJob
  private prisma: PrismaClient
  private maintenanceService: MaintenanceService
  private isRunning = false

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.maintenanceService = new MaintenanceService(prisma)

    // Run every minute to check for due tasks
    this.job = new CronJob('*/1 * * * *', () => {
      this.processDueTasks().catch(error => {
        debug.log('error', `Failed to process maintenance queue: ${error.message}`)
        console.error('ProcessMaintenanceQueue error:', error)
      })
    })
  }

  /**
   * Start the cron job
   */
  start (): void {
    if (!this.job.running) {
      debug.log('Starting ProcessMaintenanceQueue cron job')
      this.job.start()
    }
  }

  /**
   * Stop the cron job
   */
  stop (): void {
    if (this.job.running) {
      debug.log('Stopping ProcessMaintenanceQueue cron job')
      this.job.stop()
    }
  }

  /**
   * Check if the cron job is running
   */
  isJobRunning (): boolean {
    return this.job.running
  }

  /**
   * Process all due maintenance tasks
   */
  private async processDueTasks (): Promise<void> {
    // Prevent overlapping executions
    if (this.isRunning) {
      debug.log('warn', 'ProcessMaintenanceQueue already running, skipping this cycle')
      return
    }

    this.isRunning = true

    try {
      // Get all due tasks
      const dueTasks = await this.maintenanceService.getDueTasks()

      if (dueTasks.length === 0) {
        debug.log('No due maintenance tasks found')
        return
      }

      debug.log(`Found ${dueTasks.length} due maintenance tasks`)

      // Process each task
      const results = await Promise.allSettled(
        dueTasks.map(async (task) => {
          try {
            debug.log(`Executing scheduled maintenance task: ${task.name} (${task.id})`)

            const result = await this.maintenanceService.executeTask(
              task.id,
              MaintenanceTrigger.SCHEDULED
            )

            if (result.success) {
              debug.log(`Successfully executed maintenance task: ${task.name}`)
            } else {
              debug.log('error', `Failed to execute maintenance task: ${task.name} - ${result.error}`)
            }

            return { taskId: task.id, taskName: task.name, success: result.success, error: result.error }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            debug.log('error', `Error executing maintenance task ${task.name}: ${errorMessage}`)
            return { taskId: task.id, taskName: task.name, success: false, error: errorMessage }
          }
        })
      )

      // Log summary
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
      const failed = results.length - successful

      debug.log(`Maintenance queue processing complete: ${successful} successful, ${failed} failed`)

      // Log details for failed tasks
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.success) {
          debug.log('error', `Task ${result.value.taskName} failed: ${result.value.error}`)
        } else if (result.status === 'rejected') {
          debug.log('error', `Task execution rejected: ${result.reason}`)
        }
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      debug.log('error', `Critical error in processDueTasks: ${errorMessage}`)
      console.error('ProcessMaintenanceQueue critical error:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Manually trigger processing of due tasks (for testing/debugging)
   */
  async triggerManualRun (): Promise<void> {
    debug.log('Manual trigger of maintenance queue processing')
    await this.processDueTasks()
  }

  /**
   * Get statistics about the maintenance queue
   */
  async getQueueStats (): Promise<{
    totalEnabledTasks: number
    dueTasksCount: number
    runningTasksCount: number
    lastProcessedAt?: Date
  }> {
    const [totalEnabledTasks, dueTasksCount, runningTasksCount] = await Promise.all([
      // Total enabled tasks across all VMs
      this.prisma.maintenanceTask.count({
        where: { isEnabled: true }
      }),
      // Currently due tasks
      this.prisma.maintenanceTask.count({
        where: {
          isEnabled: true,
          nextRunAt: {
            lte: new Date()
          }
        }
      }),
      // Currently running tasks
      this.prisma.maintenanceHistory.count({
        where: {
          status: MaintenanceStatus.RUNNING
        }
      })
    ])

    // Get last processed task timestamp
    const lastProcessed = await this.prisma.maintenanceHistory.findFirst({
      where: {
        triggeredBy: MaintenanceTrigger.SCHEDULED
      },
      orderBy: {
        executedAt: 'desc'
      },
      select: {
        executedAt: true
      }
    })

    return {
      totalEnabledTasks,
      dueTasksCount,
      runningTasksCount,
      lastProcessedAt: lastProcessed?.executedAt
    }
  }
}

// Export the class for use in other parts of the application
export default ProcessMaintenanceQueue
