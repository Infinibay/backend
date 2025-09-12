import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVMHealthQueueManager, QUEUE_PROCESSING_INTERVAL_SECONDS } from '../services/VMHealthQueueManager'
import { EventManager } from '../services/EventManager'
import { Debugger } from '../utils/debug'

const debug = new Debugger('ProcessHealthQueueJob')

export class ProcessHealthQueueJob {
  private job: CronJob | null = null
  private queueManager: ReturnType<typeof getVMHealthQueueManager>
  private isRunning = false

  constructor(
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    this.queueManager = getVMHealthQueueManager(prisma, eventManager)
  }

  start(): void {
    if (this.job) {
      debug.log('ProcessHealthQueue job is already running')
      return
    }

    // Run every 30 seconds (configurable via QUEUE_PROCESSING_INTERVAL_SECONDS)
    const cronPattern = `*/${QUEUE_PROCESSING_INTERVAL_SECONDS} * * * * *`

    this.job = new CronJob(
      cronPattern,
      async () => {
        if (this.isRunning) {
          debug.log('Previous health queue processing still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.processHealthQueues()
        } catch (error) {
          console.error('🗂️ Error in ProcessHealthQueue job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    console.log(`🗂️ ProcessHealthQueue job started (every ${QUEUE_PROCESSING_INTERVAL_SECONDS} seconds)`)
  }

  stop(): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      console.log('🗂️ ProcessHealthQueue job stopped')
    }
  }

  private async processHealthQueues(): Promise<void> {
    try {
      debug.log('Starting health queue processing cycle')

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
        debug.log('No running VMs found, skipping queue processing')
        return
      }

      debug.log(`Processing health queues for ${runningVMs.length} running VMs`)

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
            console.error(`🗂️ Failed to process health queue for VM ${vm.name} (${vm.id}):`, error)
          }
        })

        await Promise.allSettled(processingPromises)
      }

      // Log queue statistics
      const stats = this.queueManager.getQueueStatistics()
      if (stats.totalQueued > 0 || stats.activeChecks > 0) {
        debug.log(`Queue stats: ${stats.totalQueued} queued, ${stats.activeChecks} active, ${stats.vmQueues} VM queues`)
      }

    } catch (error) {
      console.error('🗂️ Error processing health queues:', error)
      throw error
    }
  }
}

// Export factory function for singleton pattern
let processHealthQueueJobInstance: ProcessHealthQueueJob | null = null

export function createProcessHealthQueueJob(
  prisma: PrismaClient,
  eventManager: EventManager
): ProcessHealthQueueJob {
  if (!processHealthQueueJobInstance) {
    processHealthQueueJobInstance = new ProcessHealthQueueJob(prisma, eventManager)
  }
  return processHealthQueueJobInstance
}
