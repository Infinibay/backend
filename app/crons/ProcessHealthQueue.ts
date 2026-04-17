import logger from '@main/logger'
import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVMHealthQueueManager, QUEUE_PROCESSING_INTERVAL_SECONDS } from '../services/VMHealthQueueManager'
import { EventManager } from '../services/EventManager'

const debug = logger.child({ module: 'ProcessHealthQueueJob' })

export class ProcessHealthQueueJob {
  private job: CronJob | null = null
  private queueManager: ReturnType<typeof getVMHealthQueueManager>
  private isRunning = false

  constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    this.queueManager = getVMHealthQueueManager(prisma, eventManager)
  }

  start (): void {
    if (this.job) {
      debug.debug('ProcessHealthQueue job is already running')
      return
    }

    // Run every 30 seconds (configurable via QUEUE_PROCESSING_INTERVAL_SECONDS)
    const cronPattern = `*/${QUEUE_PROCESSING_INTERVAL_SECONDS} * * * * *`

    this.job = new CronJob(
      cronPattern,
      async () => {
        if (this.isRunning) {
          debug.debug('Previous health queue processing still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.processHealthQueues()
        } catch (error) {
          logger.error('🗂️ Error in ProcessHealthQueue job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    logger.info(`🗂️ ProcessHealthQueue job started (every ${QUEUE_PROCESSING_INTERVAL_SECONDS} seconds)`)
  }

  stop (): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      logger.info('🗂️ ProcessHealthQueue job stopped')
    }
  }

  private async processHealthQueues (): Promise<void> {
    try {
      debug.debug('Starting health queue processing cycle')

      // Sync from database first
      await this.queueManager.syncFromDatabase()

      // Get all running VMs
      const runningVMs = await this.prisma.machine.findMany({
        where: {
          status: 'running'
        },
        select: {
          id: true,
          name: true
        }
      })

      if (runningVMs.length === 0) {
        debug.debug('No running VMs found, skipping queue processing')
        return
      }

      debug.debug(`Processing health queues for ${runningVMs.length} running VMs`)

      // Process VMs in batches to respect system-wide concurrency limits
      const BATCH_SIZE = 50 // Process up to 50 VMs at a time
      const batches = []
      for (let i = 0; i < runningVMs.length; i += BATCH_SIZE) {
        batches.push(runningVMs.slice(i, i + BATCH_SIZE))
      }

      for (const batch of batches) {
        const processingPromises = batch.map(async (vm) => {
          try {
            await this.queueManager.processQueue(vm.id)
          } catch (error) {
            logger.error(`🗂️ Failed to process health queue for VM ${vm.name} (${vm.id}):`, error)
          }
        })

        await Promise.allSettled(processingPromises)
      }

      // Log queue statistics
      const stats = this.queueManager.getQueueStatistics()
      if (stats.totalQueued > 0 || stats.activeChecks > 0) {
        debug.debug(`Queue stats: ${stats.totalQueued} queued, ${stats.activeChecks} active, ${stats.vmQueues} VM queues`)
      }
    } catch (error) {
      logger.error('🗂️ Error processing health queues:', error)
      throw error
    }
  }
}

// Export factory function for singleton pattern
let processHealthQueueJobInstance: ProcessHealthQueueJob | null = null

export function createProcessHealthQueueJob (
  prisma: PrismaClient,
  eventManager: EventManager
): ProcessHealthQueueJob {
  if (!processHealthQueueJobInstance) {
    processHealthQueueJobInstance = new ProcessHealthQueueJob(prisma, eventManager)
  }
  return processHealthQueueJobInstance
}
