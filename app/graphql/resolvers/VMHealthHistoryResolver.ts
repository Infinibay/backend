import { Arg, Ctx, Query, Resolver, ObjectType, Field, ID, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { TaskStatus, TaskPriority, HealthCheckType } from '@prisma/client'
import { InfinibayContext } from '@utils/context'
import { Can } from '@main/permissions'
import { UserInputError } from '@utils/errors'

@ObjectType()
export class VMHealthSnapshotType {
  @Field(() => ID)
    id: string = ''

  @Field(() => ID)
    machineId: string = ''

  @Field(() => Date)
    snapshotDate: Date = new Date()

  @Field(() => String)
    overallStatus: string = ''

  @Field(() => GraphQLJSONObject, { nullable: true })
    diskSpaceInfo?: unknown

  @Field(() => GraphQLJSONObject, { nullable: true })
    resourceOptInfo?: unknown

  @Field(() => GraphQLJSONObject, { nullable: true })
    windowsUpdateInfo?: unknown

  @Field(() => GraphQLJSONObject, { nullable: true })
    defenderStatus?: unknown

  @Field(() => GraphQLJSONObject, { nullable: true })
    applicationInventory?: unknown

  @Field(() => GraphQLJSONObject, { nullable: true })
    customCheckResults?: unknown

  @Field(() => String, { nullable: true })
    osType?: string

  @Field(() => Int)
    checksCompleted: number = 0

  @Field(() => Int)
    checksFailed: number = 0

  @Field(() => Int, { nullable: true })
    executionTimeMs?: number

  @Field(() => String, { nullable: true })
    errorSummary?: string

  @Field(() => Date)
    createdAt: Date = new Date()

  @Field(() => Date)
    updatedAt: Date = new Date()
}

@ObjectType()
export class VMHealthCheckQueueType {
  @Field(() => ID)
    id: string = ''

  @Field(() => ID)
    machineId: string = ''

  @Field(() => String)
    checkType: HealthCheckType = HealthCheckType.OVERALL_STATUS

  @Field(() => String)
    priority: TaskPriority = TaskPriority.MEDIUM

  @Field(() => String)
    status: TaskStatus = TaskStatus.PENDING

  @Field(() => GraphQLJSONObject, { nullable: true })
    payload?: unknown

  @Field(() => Int)
    attempts: number = 0

  @Field(() => Int)
    maxAttempts: number = 3

  @Field(() => Date)
    scheduledFor: Date = new Date()

  @Field(() => Date, { nullable: true })
    executedAt?: Date

  @Field(() => Date, { nullable: true })
    completedAt?: Date

  @Field(() => String, { nullable: true })
    error?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    result?: unknown

  @Field(() => Int, { nullable: true })
    executionTimeMs?: number

  @Field(() => Date)
    createdAt: Date = new Date()

  @Field(() => Date)
    updatedAt: Date = new Date()
}

@ObjectType()
export class VMHealthStatsType {
  @Field(() => Int)
    totalSnapshots: number = 0

  @Field(() => Int)
    healthySnapshots: number = 0

  @Field(() => Int)
    warningSnapshots: number = 0

  @Field(() => Int)
    errorSnapshots: number = 0

  @Field(() => Date, { nullable: true })
    lastHealthCheck?: Date

  @Field(() => String, { nullable: true })
    lastHealthStatus?: string
}

@ObjectType()
export class QueueStatsType {
  @Field(() => Int)
    pending: number = 0

  @Field(() => Int)
    running: number = 0

  @Field(() => Int)
    completed: number = 0

  @Field(() => Int)
    failed: number = 0

  @Field(() => Int)
    retryScheduled: number = 0

  @Field(() => Int)
    totalToday: number = 0
}

@Resolver()
export class VMHealthHistoryResolver {
  @Query(() => [VMHealthSnapshotType])
  @Can('vmHealth:view', { id: (a) => a.machineId, scopeVia: 'vm' })
  async vmHealthHistory (
    @Arg('machineId', () => ID) machineId: string,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 20 }) limit: number,
    @Arg('offset', () => Int, { nullable: true, defaultValue: 0 }) offset: number,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType[]> {
    // Clamp pagination to prevent unbounded over-fetch of large JSON snapshot blobs
    // and to reject negative offsets that Prisma would surface as a raw 500.
    const take = Math.min(Math.max(limit ?? 20, 1), 100)
    const skip = Math.max(offset ?? 0, 0)
    const snapshots = await context.prisma.vMHealthSnapshot.findMany({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' },
      take,
      skip
    })

    return snapshots as VMHealthSnapshotType[]
  }

  @Query(() => VMHealthSnapshotType, { nullable: true })
  @Can('vmHealth:view', { id: (a) => a.machineId, scopeVia: 'vm' })
  async latestVMHealthSnapshot (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType | null> {
    const snapshot = await context.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })

    return snapshot as VMHealthSnapshotType | null
  }

  @Query(() => [VMHealthCheckQueueType])
  @Can('vmHealth:view')
  async vmHealthCheckQueue (
    @Ctx() context: InfinibayContext,
    @Arg('machineId', () => ID, { nullable: true }) machineId?: string,
    @Arg('status', () => String, { nullable: true }) status?: string,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 20 }) limit: number = 20,
    @Arg('offset', () => Int, { nullable: true, defaultValue: 0 }) offset: number = 0
  ): Promise<VMHealthCheckQueueType[]> {
    const where: {
      machineId?: string | { in: string[] }
      status?: TaskStatus
    } = {}

    // If machineId is specified, check access
    if (machineId) {
      const machine = await context.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true, departmentId: true }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      await context.assertCan!('vmHealth:view', machine)

      where.machineId = machineId
    } else {
      // Limit to machines the caller can view
      const machineWhere = await context.scopedWhere!('vmHealth:view')
      const userMachines = await context.prisma.machine.findMany({
        where: machineWhere,
        select: { id: true }
      })
      where.machineId = { in: userMachines.map(m => m.id) }
    }

    if (status) {
      // Validate against the enum so an unknown value yields a clean input error
      // rather than an opaque Prisma validation 500.
      if (!Object.values(TaskStatus).includes(status as TaskStatus)) {
        throw new UserInputError('Invalid status')
      }
      where.status = status as TaskStatus
    }

    // Clamp pagination to prevent unbounded over-fetch of large payload/result JSON
    // blobs and to reject negative offsets that Prisma would surface as a raw 500.
    const take = Math.min(Math.max(limit ?? 20, 1), 100)
    const skip = Math.max(offset ?? 0, 0)
    const queueItems = await context.prisma.vMHealthCheckQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    return queueItems as VMHealthCheckQueueType[]
  }

  @Query(() => VMHealthSnapshotType, { nullable: true })
  @Can('vmHealth:view', { id: (a) => a.machineId, scopeVia: 'vm' })
  async getLatestVMHealth (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType | null> {
    const snapshot = await context.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })

    return snapshot as VMHealthSnapshotType | null
  }

  @Query(() => VMHealthStatsType)
  @Can('vmHealth:view', { id: (a) => a.machineId, scopeVia: 'vm' })
  async vmHealthStats (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthStatsType> {
    const [
      totalSnapshots,
      healthySnapshots,
      warningSnapshots,
      errorSnapshots,
      latestSnapshot
    ] = await Promise.all([
      context.prisma.vMHealthSnapshot.count({
        where: { machineId }
      }),
      context.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'healthy' }
      }),
      context.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'warning' }
      }),
      context.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'error' }
      }),
      context.prisma.vMHealthSnapshot.findFirst({
        where: { machineId },
        orderBy: { snapshotDate: 'desc' },
        select: { snapshotDate: true, overallStatus: true }
      })
    ])

    return {
      totalSnapshots,
      healthySnapshots,
      warningSnapshots,
      errorSnapshots,
      lastHealthCheck: latestSnapshot?.snapshotDate,
      lastHealthStatus: latestSnapshot?.overallStatus
    }
  }

  @Query(() => QueueStatsType)
  @Can('vmHealth:view')
  async healthCheckQueueStats (@Ctx() context: InfinibayContext): Promise<QueueStatsType> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [pending, running, completed, failed, retryScheduled, totalToday] = await Promise.all([
      context.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.PENDING }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.RUNNING }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.COMPLETED }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.FAILED }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.RETRY_SCHEDULED }
      }),
      context.prisma.vMHealthCheckQueue.count({
        where: {
          createdAt: {
            gte: today
          }
        }
      })
    ])

    return {
      pending,
      running,
      completed,
      failed,
      retryScheduled,
      totalToday
    }
  }
}
