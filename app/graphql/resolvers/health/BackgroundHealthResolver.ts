import { Resolver, Query, Mutation, Authorized, Ctx, ObjectType, Field, Int } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { BackgroundHealthService } from '@services/BackgroundHealthService'
import { VMHealthQueueManager } from '@services/VMHealthQueueManager'
import { BackgroundTaskService } from '@services/BackgroundTaskService'
import { createEventManager } from '@services/EventManager'
import { getSocketService } from '@services/SocketService'

/**
 * Background Health Service Status Type
 */
@ObjectType()
export class BackgroundHealthServiceStatus {
  @Field()
    isRunning!: boolean

  @Field()
    cronActive!: boolean

  @Field({ nullable: true })
    nextRun?: Date

  @Field()
    lastRun?: Date

  @Field(() => Int)
    totalVMsMonitored!: number

  @Field(() => Int)
    activeQueues!: number

  @Field(() => Int)
    pendingChecks!: number
}

/**
 * Health Check Round Result Type
 */
@ObjectType()
export class HealthCheckRoundResult {
  @Field()
    success!: boolean

  @Field()
    taskId!: string

  @Field()
    message!: string

  @Field({ nullable: true })
    error?: string

  @Field()
    timestamp!: Date
}

/**
 * Queue Statistics Type
 */
@ObjectType()
export class QueueStatistics {
  @Field(() => Int)
    totalQueues!: number

  @Field(() => Int)
    activeChecks!: number

  @Field(() => Int)
    pendingTasks!: number

  @Field(() => Int)
    completedToday!: number

  @Field(() => Int)
    failedToday!: number
}

@Resolver()
export class BackgroundHealthResolver {
  private backgroundHealthService: BackgroundHealthService | null = null
  private queueManager: VMHealthQueueManager | null = null

  /**
   * Get or create BackgroundHealthService instance
   */
  private getBackgroundHealthService (context: InfinibayContext): BackgroundHealthService {
    if (!this.backgroundHealthService) {
      const socketService = getSocketService()
      const eventManager = createEventManager(socketService, context.prisma)
      const backgroundTaskService = new BackgroundTaskService(context.prisma, eventManager)
      this.queueManager = new VMHealthQueueManager(context.prisma, eventManager)

      this.backgroundHealthService = new BackgroundHealthService(
        context.prisma,
        backgroundTaskService,
        eventManager,
        this.queueManager
      )
    }
    return this.backgroundHealthService
  }

  /**
   * Get background health service status
   */
  @Query(() => BackgroundHealthServiceStatus)
  @Authorized(['ADMIN'])
  async backgroundHealthServiceStatus (
    @Ctx() context: InfinibayContext
  ): Promise<BackgroundHealthServiceStatus> {
    const service = this.getBackgroundHealthService(context)
    const status = service.getStatus()

    // Get additional statistics
    const [totalVMs, activeQueues, pendingChecks] = await Promise.all([
      context.prisma.machine.count({
        where: { status: { not: 'DELETED' } }
      }),
      context.prisma.vMHealthCheckQueue.groupBy({
        by: ['machineId'],
        where: { status: { in: ['PENDING', 'RUNNING'] } }
      }).then(groups => groups.length),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: 'PENDING' }
      })
    ])

    return {
      isRunning: status.isRunning,
      cronActive: status.cronActive,
      nextRun: status.nextRun || undefined,
      lastRun: undefined, // TODO: Track last run time
      totalVMsMonitored: totalVMs,
      activeQueues,
      pendingChecks
    }
  }

  /**
   * Get queue statistics
   */
  @Query(() => QueueStatistics)
  @Authorized(['ADMIN'])
  async healthQueueStatistics (
    @Ctx() context: InfinibayContext
  ): Promise<QueueStatistics> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [totalQueues, activeChecks, pendingTasks, completedToday, failedToday] = await Promise.all([
      context.prisma.vMHealthCheckQueue.groupBy({
        by: ['machineId']
      }).then(groups => groups.length),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: 'RUNNING' }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: 'PENDING' }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: {
          status: 'COMPLETED',
          completedAt: { gte: today }
        }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: {
          status: 'FAILED',
          completedAt: { gte: today }
        }
      })
    ])

    return {
      totalQueues,
      activeChecks,
      pendingTasks,
      completedToday,
      failedToday
    }
  }

  /**
   * Manually trigger a health check round
   */
  @Mutation(() => HealthCheckRoundResult)
  @Authorized(['ADMIN'])
  async triggerHealthCheckRound (
    @Ctx() context: InfinibayContext
  ): Promise<HealthCheckRoundResult> {
    try {
      const service = this.getBackgroundHealthService(context)
      const taskId = await service.triggerHealthCheckRound()

      return {
        success: true,
        taskId,
        message: 'Health check round triggered successfully',
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        taskId: '',
        message: 'Failed to trigger health check round',
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  /**
   * Queue health checks for all VMs
   */
  @Mutation(() => HealthCheckRoundResult)
  @Authorized(['ADMIN'])
  async queueAllVMHealthChecks (
    @Ctx() context: InfinibayContext
  ): Promise<HealthCheckRoundResult> {
    try {
      if (!this.queueManager) {
        this.getBackgroundHealthService(context) // Initialize services
      }

      const activeVMs = await context.prisma.machine.findMany({
        where: { status: { not: 'DELETED' } },
        select: { id: true, name: true }
      })

      let successCount = 0
      let failureCount = 0

      for (const vm of activeVMs) {
        try {
          await this.queueManager!.queueHealthChecks(vm.id)
          successCount++
        } catch (error) {
          failureCount++
          console.error(`Failed to queue health checks for VM ${vm.name}:`, error)
        }
      }

      return {
        success: failureCount === 0,
        taskId: `manual-queue-${Date.now()}`,
        message: `Queued health checks for ${successCount} VMs${failureCount > 0 ? `, ${failureCount} failed` : ''}`,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        taskId: '',
        message: 'Failed to queue health checks',
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }
}
