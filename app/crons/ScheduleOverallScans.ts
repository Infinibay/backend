import { CronJob } from 'cron'
import { PrismaClient } from '@prisma/client'
import { getVMHealthQueueManager, OVERALL_SCAN_INTERVAL_MINUTES } from '../services/VMHealthQueueManager'
import { EventManager } from '../services/EventManager'
import { Debugger } from '../utils/debug'

const debug = new Debugger('ScheduleOverallScansJob')

export class ScheduleOverallScansJob {
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
      debug.log('ScheduleOverallScans job is already running')
      return
    }

    // Run every 30 minutes to check for overdue scans
    this.job = new CronJob(
      '0 */30 * * * *', // Every 30 minutes
      async () => {
        if (this.isRunning) {
          debug.log('Previous overall scan scheduling still running, skipping...')
          return
        }

        this.isRunning = true
        try {
          await this.scheduleOverdueScans()
        } catch (error) {
          console.error('🗂️ Error in ScheduleOverallScans job:', error)
        } finally {
          this.isRunning = false
        }
      },
      null,
      true,
      'UTC'
    )

    console.log(`🗂️ ScheduleOverallScans job started (every 30 minutes, scan interval: ${OVERALL_SCAN_INTERVAL_MINUTES} minutes)`)
  }

  stop (): void {
    if (this.job) {
      this.job.stop()
      this.job = null
      console.log('🗂️ ScheduleOverallScans job stopped')
    }
  }

  private async scheduleOverdueScans (): Promise<void> {
    try {
      debug.log('Starting overdue scan scheduling cycle')

      // Get all running VMs (only schedule scans for running VMs to avoid wasting queue capacity)
      const runningVMs = await this.prisma.machine.findMany({
        where: {
          status: 'running'
        },
        select: {
          id: true,
          name: true,
          status: true
        }
      })

      if (runningVMs.length === 0) {
        debug.log('No running VMs found, skipping overdue scan scheduling')
        return
      }

      debug.log(`Checking ${runningVMs.length} running VMs for overdue overall scans`)

      const now = new Date()
      let scansScheduled = 0

      // Check each VM for overdue scans
      for (const vm of runningVMs) {
        try {
          // Get per-VM scan interval
          const scanIntervalMinutes = await this.queueManager.getOverallScanIntervalMinutes(vm.id)
          const scanThresholdMs = scanIntervalMinutes * 60 * 1000

          const lastScanTime = await this.queueManager.getLastOverallScanTime(vm.id)

          let needsScan = false
          if (!lastScanTime) {
            // No previous scan found
            needsScan = true
            debug.log(`VM ${vm.name} (${vm.id}) has no previous overall scan (interval: ${scanIntervalMinutes}min)`)
          } else {
            // Check if last scan is older than per-VM threshold
            const timeSinceLastScan = now.getTime() - lastScanTime.getTime()
            if (timeSinceLastScan > scanThresholdMs) {
              needsScan = true
              const minutesOverdue = Math.floor(timeSinceLastScan / (60 * 1000))
              debug.log(`VM ${vm.name} (${vm.id}) overall scan is overdue by ${minutesOverdue} minutes (interval: ${scanIntervalMinutes}min)`)
            }
          }

          if (needsScan) {
            // Check for exponential backoff if there were recent failures
            const backoffDelay = await this.calculateBackoffDelay(vm.id)
            if (backoffDelay > 0) {
              debug.log(`VM ${vm.name} (${vm.id}) is in backoff period, skipping scan (${Math.ceil(backoffDelay / 1000)}s remaining)`)
              continue
            }

            // Check if there's already a pending OVERALL_STATUS check
            const existingPendingCheck = await this.prisma.vMHealthCheckQueue.findFirst({
              where: {
                machineId: vm.id,
                checkType: 'OVERALL_STATUS',
                status: {
                  in: ['PENDING', 'RETRY_SCHEDULED', 'RUNNING']
                }
              }
            })

            if (!existingPendingCheck) {
              // Queue new overall status check
              await this.queueManager.queueHealthCheck(vm.id, 'OVERALL_STATUS', 'MEDIUM')
              scansScheduled++
              console.log(`🗂️ Scheduled overdue overall scan for VM ${vm.name} (${vm.id})`)
            } else {
              debug.log(`VM ${vm.name} (${vm.id}) already has pending overall scan, skipping`)
            }
          }
        } catch (error) {
          console.error(`🗂️ Failed to check/schedule overall scan for VM ${vm.name} (${vm.id}):`, error)
        }
      }

      if (scansScheduled > 0) {
        console.log(`🗂️ Scheduled ${scansScheduled} overdue overall scans`)
      } else {
        debug.log('No overdue overall scans found')
      }
    } catch (error) {
      console.error('🗂️ Error scheduling overdue scans:', error)
      throw error
    }
  }

  /**
   * Calculate exponential backoff delay for failed scans
   */
  private async calculateBackoffDelay (machineId: string): Promise<number> {
    try {
      const now = new Date()
      const backoffWindow = 60 * 60 * 1000 // 1 hour window

      // Get recent failed attempts within the backoff window
      const recentFailures = await this.prisma.vMHealthCheckQueue.findMany({
        where: {
          machineId,
          checkType: 'OVERALL_STATUS',
          status: 'FAILED',
          executedAt: {
            gte: new Date(now.getTime() - backoffWindow)
          }
        },
        orderBy: {
          executedAt: 'desc'
        },
        take: 5 // Consider last 5 failures for backoff calculation
      })

      if (recentFailures.length === 0) {
        return 0 // No recent failures, no backoff needed
      }

      // Calculate exponential backoff: 2^failures * base_delay (in minutes)
      const baseDelayMinutes = 5 // Start with 5 minutes
      const maxDelayMinutes = 60 // Cap at 1 hour
      const failureCount = recentFailures.length

      const backoffMinutes = Math.min(
        baseDelayMinutes * Math.pow(2, failureCount - 1),
        maxDelayMinutes
      )

      const lastFailureTime = recentFailures[0].executedAt
      if (!lastFailureTime) {
        return 0
      }

      const timeSinceLastFailure = now.getTime() - lastFailureTime.getTime()
      const backoffDelayMs = backoffMinutes * 60 * 1000
      const remainingBackoff = backoffDelayMs - timeSinceLastFailure

      if (remainingBackoff > 0) {
        // Raise alert for repeated failures
        if (failureCount >= 3) {
          await this.raiseHealthAlert(machineId, failureCount, backoffMinutes)
        }
        return remainingBackoff
      }

      return 0
    } catch (error) {
      console.error(`🗂️ Failed to calculate backoff delay for VM ${machineId}:`, error)
      return 0 // Don't block scheduling on backoff calculation errors
    }
  }

  /**
   * Raise health alert for repeated scan failures
   */
  private async raiseHealthAlert (machineId: string, failureCount: number, backoffMinutes: number): Promise<void> {
    try {
      // Create VMHealthAlert record
      await this.prisma.vMHealthAlert.create({
        data: {
          machineId,
          type: 'REPEATED_SCAN_FAILURES',
          severity: failureCount >= 5 ? 'CRITICAL' : 'WARNING',
          title: 'Repeated Health Scan Failures',
          description: `VM has ${failureCount} consecutive overall scan failures. Next retry in ${backoffMinutes} minutes.`,
          metadata: {
            failureCount,
            backoffMinutes,
            checkType: 'OVERALL_STATUS'
          }
        }
      })

      console.warn(`🚨 Health alert raised for VM ${machineId}: ${failureCount} consecutive scan failures`)
    } catch (error) {
      console.error(`🗂️ Failed to raise health alert for VM ${machineId}:`, error)
    }
  }
}

// Export factory function for singleton pattern
let scheduleOverallScansJobInstance: ScheduleOverallScansJob | null = null

export function createScheduleOverallScansJob (
  prisma: PrismaClient,
  eventManager: EventManager
): ScheduleOverallScansJob {
  if (!scheduleOverallScansJobInstance) {
    scheduleOverallScansJobInstance = new ScheduleOverallScansJob(prisma, eventManager)
  }
  return scheduleOverallScansJobInstance
}
