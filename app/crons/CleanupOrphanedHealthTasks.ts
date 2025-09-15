import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVMHealthQueueManager } from '../services/VMHealthQueueManager'
import { getEventManager } from '../services/EventManager'
import { Debugger } from '../utils/debug'

const debug = new Debugger('CleanupOrphanedHealthTasksJob')

export class CleanupOrphanedHealthTasksJob {
  private job: CronJob | null = null
  private isRunning = false

  constructor (private prisma: PrismaClient) {}

  start (): void {
    if (this.job) {
      debug.log('CleanupOrphanedHealthTasks job is already running')
      return
    }

    // Run every hour to clean up orphaned tasks
    this.job = new CronJob(
      '0 0 * * * *', // Every hour at minute 0
      async () => {
        if (this.isRunning) {
          debug.log('Previous cleanup still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.cleanupOrphanedTasks()
        } catch (error) {
          console.error('🗂️ Error in CleanupOrphanedHealthTasks job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    console.log('🗂️ CleanupOrphanedHealthTasks job started (every hour)')
  }

  stop (): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      console.log('🗂️ CleanupOrphanedHealthTasks job stopped')
    }
  }

  private async cleanupOrphanedTasks (): Promise<void> {
    try {
      debug.log('Starting orphaned health tasks cleanup')

      // Get the singleton queue manager
      const eventManager = getEventManager()
      const queueManager = getVMHealthQueueManager(this.prisma, eventManager)

      // Run the cleanup
      await queueManager.cleanupOrphanedTasks()

      debug.log('Orphaned health tasks cleanup completed')
    } catch (error) {
      console.error('🗂️ Error during orphaned tasks cleanup:', error)
      throw error
    }
  }
}

// Export factory function for singleton pattern
let cleanupOrphanedHealthTasksJobInstance: CleanupOrphanedHealthTasksJob | null = null

export function createCleanupOrphanedHealthTasksJob (prisma: PrismaClient): CleanupOrphanedHealthTasksJob {
  if (!cleanupOrphanedHealthTasksJobInstance) {
    cleanupOrphanedHealthTasksJobInstance = new CleanupOrphanedHealthTasksJob(prisma)
  }
  return cleanupOrphanedHealthTasksJobInstance
}
