import logger from '@main/logger'
import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVirtioSocketWatcherService } from '../services/VirtioSocketWatcherService'

const debug = logger.child({ module: 'MetricsWatchdogJob' })

export class MetricsWatchdogJob {
  private job: CronJob | null = null
  private isRunning = false

  constructor (private prisma: PrismaClient) { }

  start (): void {
    if (this.job) {
      debug.debug('MetricsWatchdog job is already running')
      return
    }

    // Run every 3 minutes to check for stale metrics
    this.job = new CronJob(
      '0 */3 * * * *', // Every 3 minutes
      async () => {
        if (this.isRunning) {
          debug.debug('Previous metrics watchdog check still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.checkStaleMetrics()
        } catch (error) {
          logger.error('🗂️ Error in MetricsWatchdog job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    logger.info('🗂️ MetricsWatchdog job started (every 3 minutes)')
  }

  stop (): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      logger.info('🗂️ MetricsWatchdog job stopped')
    }
  }

  private async checkStaleMetrics (): Promise<void> {
    try {
      debug.debug('Starting stale metrics check')

      // Get all running VMs whose OS is ready (infiniservice handshaked).
      // VMs still installing won't have metrics yet — skip them.
      const runningVMs = await this.prisma.machine.findMany({
        where: {
          status: 'running',
          configuration: { setupComplete: true }
        },
        select: {
          id: true,
          name: true
        }
      })

      if (runningVMs.length === 0) {
        debug.debug('No running VMs found, skipping stale metrics check')
        return
      }

      debug.debug(`Checking ${runningVMs.length} running VMs for stale metrics`)

      const staleThresholdMs = 2 * 60 * 1000 // 2 minutes
      const now = new Date()
      let staleVMsCount = 0

      for (const vm of runningVMs) {
        try {
          // Check for recent metrics
          const recentMetrics = await this.prisma.systemMetrics.findFirst({
            where: {
              machineId: vm.id,
              timestamp: {
                gte: new Date(now.getTime() - staleThresholdMs)
              }
            },
            orderBy: {
              timestamp: 'desc'
            }
          })

          if (!recentMetrics) {
            staleVMsCount++
            logger.warn(`⚠️ VM ${vm.name} (${vm.id}) has no recent metrics (last 2 minutes)`)

            // Try to ping the VM or request metrics
            try {
              const virtioService = getVirtioSocketWatcherService()
              debug.debug(`Attempting to request metrics from VM ${vm.name}`)

              await virtioService.sendSafeCommand(
                vm.id,
                { action: 'SystemInfo' },
                30000 // 30 seconds timeout
              )
            } catch (pingError) {
              logger.error(`🗂️ Failed to ping VM ${vm.name} for metrics:`, pingError)
            }
          }
        } catch (error) {
          logger.error(`🗂️ Failed to check metrics for VM ${vm.name} (${vm.id}):`, error)
        }
      }

      if (staleVMsCount > 0) {
        logger.warn(`🗂️ Found ${staleVMsCount} VMs with stale metrics`)
      } else {
        debug.debug('All running VMs have recent metrics')
      }
    } catch (error) {
      logger.error('🗂️ Error checking stale metrics:', error)
      throw error
    }
  }
}

// Export factory function for singleton pattern
let metricsWatchdogJobInstance: MetricsWatchdogJob | null = null

export function createMetricsWatchdogJob (prisma: PrismaClient): MetricsWatchdogJob {
  if (!metricsWatchdogJobInstance) {
    metricsWatchdogJobInstance = new MetricsWatchdogJob(prisma)
  }
  return metricsWatchdogJobInstance
}
