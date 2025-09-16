import { PrismaClient } from '@prisma/client'
import { CronJob } from 'cron'
import { EventManager } from './EventManager'
import { BackgroundTaskService } from './BackgroundTaskService'
import { VMHealthQueueManager } from './VMHealthQueueManager'
import { VMRecommendationService } from './VMRecommendationService'
import { v4 as uuidv4 } from 'uuid'

export class BackgroundHealthService {
  private cronJob: CronJob | null = null
  private weeklyMaintenanceJob: CronJob | null = null
  private isRunning = false
  private recommendationService: VMRecommendationService

  constructor (
    private prisma: PrismaClient,
    private backgroundTaskService: BackgroundTaskService,
    private eventManager: EventManager,
    private queueManager: VMHealthQueueManager
  ) {
    this.recommendationService = new VMRecommendationService(this.prisma)
    this.validateRecommendationService()
  }

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

    // Weekly maintenance on Sundays at 3 AM - '0 3 * * 0'
    this.weeklyMaintenanceJob = new CronJob('0 3 * * 0', async () => {
      await this.executeWeeklyMaintenance()
    })

    this.cronJob.start()
    this.weeklyMaintenanceJob.start()
    console.log('🩺 BackgroundHealthService started - daily health checks scheduled at 2 AM, weekly maintenance at 3 AM on Sundays')
  }

  /**
   * Stop the background health monitoring system
   */
  public stop (): void {
    if (this.cronJob) {
      this.cronJob.stop()
      this.cronJob = null
    }
    if (this.weeklyMaintenanceJob) {
      this.weeklyMaintenanceJob.stop()
      this.weeklyMaintenanceJob = null
    }
    console.log('🩺 BackgroundHealthService stopped')
  }

  /**
   * Execute a complete round of health checks for all running VMs
   */
  public async executeHealthCheckRound (): Promise<void> {
    if (this.isRunning) {
      console.log('🩺 Health check round already in progress, skipping')
      return
    }

    this.isRunning = true

    try {
      // Execute background task and wait for completion
      await this.backgroundTaskService.queueTask(
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

      console.log('🩺 Daily health check round completed')
    } catch (error) {
      console.error('🩺 Failed to execute daily health check round:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Perform the actual health check round implementation
   */
  private async performHealthCheckRound (): Promise<void> {
    const startTime = Date.now()
    const roundId = `round-${startTime}`

    try {
      // Get all running VMs (only schedule health checks for running VMs to avoid errors on stopped VMs)
      const runningVMs = await this.prisma.machine.findMany({
        where: {
          status: 'running'
        },
        select: {
          id: true,
          name: true,
          status: true,
          os: true,
          internalName: true
        }
      })

      console.log(`🩺 Starting health check round for ${runningVMs.length} running VMs`)

      // Skip round_started event when no running VMs exist to reduce noise
      if (runningVMs.length === 0) {
        await this.eventManager.dispatchEvent('health', 'round_completed', {
          totalVMs: 0,
          successCount: 0,
          failureCount: 0,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          roundId
        })
        return
      }

      // Emit round started event
      await this.eventManager.dispatchEvent('health', 'round_started', {
        vmCount: runningVMs.length,
        timestamp: new Date().toISOString(),
        roundId
      })

      let successCount = 0
      let failureCount = 0

      // Queue health checks for each running VM
      for (const vm of runningVMs) {
        try {
          await this.queueManager.queueHealthChecks(vm.id)
          successCount++
          console.log(`🩺 Queued health checks for running VM: ${vm.name} (${vm.id})`)
        } catch (error) {
          failureCount++
          console.error(`🩺 Failed to queue health checks for VM ${vm.name}:`, error)
        }
      }

      const executionTime = Date.now() - startTime

      // Emit round completed event
      await this.eventManager.dispatchEvent('health', 'round_completed', {
        totalVMs: runningVMs.length,
        successCount,
        failureCount,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString(),
        roundId
      })

      console.log(`🩺 Health check round completed for running VMs: ${successCount} success, ${failureCount} failures (${executionTime}ms)`)

      // Perform recommendation cleanup after health checks complete
      await this.cleanupOldRecommendations()
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

  /**
   * Validate recommendation service initialization
   */
  private validateRecommendationService(): void {
    try {
      if (!this.recommendationService) {
        throw new Error('VMRecommendationService initialization failed')
      }
      console.log('✅ VMRecommendationService initialized successfully in BackgroundHealthService')
    } catch (error) {
      console.error('❌ Failed to initialize VMRecommendationService in BackgroundHealthService:', error)
      throw error
    }
  }

  /**
   * Execute weekly maintenance tasks
   */
  private async executeWeeklyMaintenance(): Promise<void> {
    const startTime = Date.now()
    console.log('🔧 Starting weekly maintenance tasks')

    try {
      await this.validateRecommendationIntegrity()
      await this.generateMissingRecommendations()

      const executionTime = Date.now() - startTime
      console.log(`✅ Weekly maintenance completed (${executionTime}ms)`)

      await this.eventManager.dispatchEvent('health', 'maintenance_completed', {
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      const executionTime = Date.now() - startTime
      console.error('❌ Weekly maintenance failed:', error)

      await this.eventManager.dispatchEvent('health', 'maintenance_failed', {
        error: (error as Error).message,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString()
      })

      throw error
    }
  }

  /**
   * Clean up old recommendations (older than configurable threshold)
   */
  public async cleanupOldRecommendations(): Promise<void> {
    try {
      const cleanupThresholdDays = Number(process.env.RECOMMENDATION_CLEANUP_DAYS) || 30
      const thresholdDate = new Date(Date.now() - (cleanupThresholdDays * 24 * 60 * 60 * 1000))

      const deletedCount = await this.prisma.vMRecommendation.deleteMany({
        where: {
          createdAt: {
            lt: thresholdDate
          }
        }
      })

      if (deletedCount.count > 0) {
        console.log(`🧹 Cleaned up ${deletedCount.count} old recommendations (older than ${cleanupThresholdDays} days)`)
      }
    } catch (error) {
      console.error('❌ Failed to cleanup old recommendations:', error)
      // Don't throw to avoid breaking health check workflow
    }
  }

  /**
   * Validate recommendation integrity - check for orphaned recommendations
   */
  public async validateRecommendationIntegrity(): Promise<void> {
    try {
      // Find recommendations with invalid snapshot references
      const orphanedRecommendations = await this.prisma.vMRecommendation.findMany({
        where: {
          snapshot: { is: null }
        },
        select: {
          id: true,
          snapshotId: true
        }
      })

      if (orphanedRecommendations.length > 0) {
        const orphanedIds = orphanedRecommendations.map(r => r.id)
        const deletedCount = await this.prisma.vMRecommendation.deleteMany({
          where: {
            id: {
              in: orphanedIds
            }
          }
        })

        console.log(`🧹 Removed ${deletedCount.count} orphaned recommendations without valid snapshots`)
      }

      // Clean up recommendations where the machine no longer exists
      // Find all recommendations that reference non-existent machines
      const validMachineIds = await this.prisma.machine.findMany({
        select: { id: true }
      })
      const validIds = new Set(validMachineIds.map(m => m.id))

      const allRecommendations = await this.prisma.vMRecommendation.findMany({
        select: { id: true, machineId: true }
      })

      const invalidMachineRecommendations = allRecommendations.filter(r => !validIds.has(r.machineId))

      if (invalidMachineRecommendations.length > 0) {
        const orphanedIds = invalidMachineRecommendations.map(r => r.id)
        const deletedCount = await this.prisma.vMRecommendation.deleteMany({
          where: {
            id: { in: orphanedIds }
          }
        })

        console.log(`🧹 Removed ${deletedCount.count} recommendations with invalid VM references`)
      }
    } catch (error) {
      console.error('❌ Failed to validate recommendation integrity:', error)
      throw error
    }
  }

  /**
   * Generate missing recommendations for recent snapshots
   */
  public async generateMissingRecommendations(): Promise<void> {
    try {
      const recentDays = Number(process.env.RECOMMENDATION_REGENERATION_DAYS) || 7
      const recentDate = new Date(Date.now() - (recentDays * 24 * 60 * 60 * 1000))

      // Find snapshots without recommendations
      const snapshotsWithoutRecommendations = await this.prisma.vMHealthSnapshot.findMany({
        where: {
          createdAt: {
            gte: recentDate
          },
          overallStatus: {
            in: ['HEALTHY', 'WARNING', 'CRITICAL']
          },
          recommendations: {
            none: {}
          }
        },
        select: {
          id: true,
          machineId: true,
          overallStatus: true
        }
      })

      if (snapshotsWithoutRecommendations.length > 0) {
        console.log(`💡 Found ${snapshotsWithoutRecommendations.length} recent snapshots without recommendations, generating...`)

        for (const snapshot of snapshotsWithoutRecommendations) {
          try {
            await this.recommendationService.generateRecommendations(snapshot.machineId, snapshot.id)
            console.log(`💡 Generated recommendations for snapshot ${snapshot.id} (${snapshot.overallStatus})`)
          } catch (error) {
            console.error(`❌ Failed to generate recommendations for snapshot ${snapshot.id}:`, error)
            // Continue with next snapshot
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to generate missing recommendations:', error)
      throw error
    }
  }

  /**
   * Manually trigger recommendation regeneration for specific VM
   */
  public async regenerateRecommendationsForVM(machineId: string): Promise<void> {
    try {
      // Get the latest snapshot for the VM
      const latestSnapshot = await this.prisma.vMHealthSnapshot.findFirst({
        where: {
          machineId,
          overallStatus: {
            in: ['HEALTHY', 'WARNING', 'CRITICAL']
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          id: true
        }
      })

      if (!latestSnapshot) {
        throw new Error(`No completed health snapshot found for VM ${machineId}`)
      }

      // Clear existing recommendations for this snapshot
      await this.prisma.vMRecommendation.deleteMany({
        where: {
          snapshotId: latestSnapshot.id
        }
      })

      // Generate new recommendations
      await this.recommendationService.generateRecommendations(machineId, latestSnapshot.id)
      console.log(`💡 Regenerated recommendations for VM ${machineId} snapshot ${latestSnapshot.id}`)
    } catch (error) {
      console.error(`❌ Failed to regenerate recommendations for VM ${machineId}:`, error)
      throw error
    }
  }

  /**
   * Manually trigger recommendation regeneration for all VMs
   */
  public async regenerateAllRecommendations(): Promise<void> {
    try {
      const runningVMs = await this.prisma.machine.findMany({
        where: {
          status: 'running'
        },
        select: {
          id: true,
          name: true
        }
      })

      console.log(`💡 Starting recommendation regeneration for ${runningVMs.length} running VMs`)

      for (const vm of runningVMs) {
        try {
          await this.regenerateRecommendationsForVM(vm.id)
        } catch (error) {
          console.error(`❌ Failed to regenerate recommendations for VM ${vm.name} (${vm.id}):`, error)
          // Continue with next VM
        }
      }

      console.log(`✅ Completed recommendation regeneration for all VMs`)
    } catch (error) {
      console.error('❌ Failed to regenerate all recommendations:', error)
      throw error
    }
  }

  /**
   * Get recommendation maintenance statistics
   */
  public async getRecommendationStats(): Promise<{
    totalRecommendations: number
    recentRecommendations: number
    snapshotsWithoutRecommendations: number
    averageRecommendationsPerSnapshot: number
  }> {
    try {
      const recentDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)) // Last 7 days

      const [totalRecommendations, recentRecommendations, snapshotsWithoutRecommendations] = await Promise.all([
        this.prisma.vMRecommendation.count(),
        this.prisma.vMRecommendation.count({
          where: {
            createdAt: {
              gte: recentDate
            }
          }
        }),
        this.prisma.vMHealthSnapshot.count({
          where: {
            overallStatus: {
              in: ['HEALTHY', 'WARNING', 'CRITICAL']
            },
            recommendations: {
              none: {}
            }
          }
        })
      ])

      const totalSnapshots = await this.prisma.vMHealthSnapshot.count({
        where: {
          overallStatus: {
            in: ['HEALTHY', 'WARNING', 'CRITICAL']
          }
        }
      })

      const averageRecommendationsPerSnapshot = totalSnapshots > 0 ? totalRecommendations / totalSnapshots : 0

      return {
        totalRecommendations,
        recentRecommendations,
        snapshotsWithoutRecommendations,
        averageRecommendationsPerSnapshot: Math.round(averageRecommendationsPerSnapshot * 100) / 100
      }
    } catch (error) {
      console.error('❌ Failed to get recommendation stats:', error)
      throw error
    }
  }
}
