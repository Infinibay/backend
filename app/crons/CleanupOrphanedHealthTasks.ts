import logger from '@main/logger'
import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVMHealthQueueManager } from '../services/VMHealthQueueManager'
import { getEventManager } from '../services/EventManager'
import { VMHealthQueueRepository } from '../services/VMHealthQueueRepository'

const debug = logger.child({ module: 'CleanupOrphanedHealthTasksJob' })

export class CleanupOrphanedHealthTasksJob {
  private job: CronJob | null = null
  private isRunning = false

  constructor (private prisma: PrismaClient) {}

  start (): void {
    if (this.job) {
      debug.debug('CleanupOrphanedHealthTasks job is already running')
      return
    }

    // Run every hour to clean up orphaned tasks
    this.job = new CronJob(
      '0 0 * * * *', // Every hour at minute 0
      async () => {
        if (this.isRunning) {
          debug.debug('Previous cleanup still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.cleanupOrphanedTasks()
        } catch (error) {
          logger.error('🗂️ Error in CleanupOrphanedHealthTasks job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    logger.info('🗂️ CleanupOrphanedHealthTasks job started (every hour)')
  }

  stop (): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      logger.info('🗂️ CleanupOrphanedHealthTasks job stopped')
    }
  }

  private async cleanupOrphanedTasks (): Promise<void> {
    try {
      debug.debug('Starting orphaned health tasks cleanup')

      // Get the singleton queue manager
      const eventManager = getEventManager()
      const queueManager = getVMHealthQueueManager(this.prisma, eventManager)

      // Run the cleanup
      await queueManager.cleanupOrphanedTasks()

      // Prune terminal (COMPLETED/FAILED) queue rows past the retention window so
      // the queue table doesn't grow without bound (one row per check per VM per
      // run). Default 7 days; tune via HEALTH_QUEUE_RETENTION_DAYS.
      const retentionDays = Number(process.env.HEALTH_QUEUE_RETENTION_DAYS) || 7
      if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
        const pruned = await new VMHealthQueueRepository(this.prisma).pruneTerminalBefore(cutoff)
        if (pruned > 0) debug.info(`🗂️ Pruned ${pruned} terminal health-check queue row(s) older than ${retentionDays}d`)
      }

      debug.debug('Orphaned health tasks cleanup completed')
    } catch (error) {
      logger.error('🗂️ Error during orphaned tasks cleanup:', error)
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
