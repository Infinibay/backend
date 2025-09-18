import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVirtioSocketWatcherService } from '../services/VirtioSocketWatcherService'
import { Debugger } from '../utils/debug'

const debug = new Debugger('MetricsWatchdogJob')

export class MetricsWatchdogJob {
  private job: CronJob | null = null
  private isRunning = false

  constructor(private prisma: PrismaClient) { }

  start(): void {
    if (this.job) {
      debug.log('MetricsWatchdog job is already running')
      return
    }

    // Run every 3 minutes to check for stale metrics
    this.job = new CronJob(
      '0 */3 * * * *', // Every 3 minutes
      async () => {
        if (this.isRunning) {
          debug.log('Previous metrics watchdog check still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.checkStaleMetrics()
        } catch (error) {
          console.error('🗂️ Error in MetricsWatchdog job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    console.log('🗂️ MetricsWatchdog job started (every 3 minutes)')
  }

  stop(): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      console.log('🗂️ MetricsWatchdog job stopped')
    }
  }

  private async checkStaleMetrics(): Promise<void> {
    try {
      debug.log('Starting stale metrics check')

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
        debug.log('No running VMs found, skipping stale metrics check')
        return
      }

      debug.log(`Checking ${runningVMs.length} running VMs for stale metrics`)

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
            console.warn(`⚠️ VM ${vm.name} (${vm.id}) has no recent metrics (last 2 minutes)`)

            // Try to ping the VM or request metrics
            try {
              const virtioService = getVirtioSocketWatcherService()
              debug.log(`Attempting to request metrics from VM ${vm.name}`)

              await virtioService.sendSafeCommand(
                vm.id,
                { action: 'SystemInfo' },
                30000 // 30 seconds timeout
              )
            } catch (pingError) {
              console.error(`🗂️ Failed to ping VM ${vm.name} for metrics:`, pingError)
            }
          }
        } catch (error) {
          console.error(`🗂️ Failed to check metrics for VM ${vm.name} (${vm.id}):`, error)
        }
      }

      if (staleVMsCount > 0) {
        console.warn(`🗂️ Found ${staleVMsCount} VMs with stale metrics`)
      } else {
        debug.log('All running VMs have recent metrics')
      }
    } catch (error) {
      console.error('🗂️ Error checking stale metrics:', error)
      throw error
    }
  }
}

// Export factory function for singleton pattern
let metricsWatchdogJobInstance: MetricsWatchdogJob | null = null

export function createMetricsWatchdogJob(prisma: PrismaClient): MetricsWatchdogJob {
  if (!metricsWatchdogJobInstance) {
    metricsWatchdogJobInstance = new MetricsWatchdogJob(prisma)
  }
  return metricsWatchdogJobInstance
}
