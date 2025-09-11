import { Arg, Authorized, Ctx, Query, Resolver, ObjectType, Field, ID, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { PrismaClient, TaskStatus, TaskPriority, HealthCheckType } from '@prisma/client'
import { InfinibayContext } from '@utils/context'

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
  private prisma: PrismaClient

  constructor () {
    this.prisma = new PrismaClient()
  }

  @Query(() => [VMHealthSnapshotType])
  @Authorized(['USER'])
  async vmHealthHistory (
    @Arg('machineId', () => ID) machineId: string,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 20 }) limit: number,
    @Arg('offset', () => Int, { nullable: true, defaultValue: 0 }) offset: number,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType[]> {
    // Check if user has access to this machine
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new Error('Machine not found')
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new Error('Access denied')
    }

    const snapshots = await this.prisma.vMHealthSnapshot.findMany({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' },
      take: limit,
      skip: offset
    })

    return snapshots as VMHealthSnapshotType[]
  }

  @Query(() => VMHealthSnapshotType, { nullable: true })
  @Authorized(['USER'])
  async latestVMHealthSnapshot (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType | null> {
    // Check if user has access to this machine
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new Error('Machine not found')
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new Error('Access denied')
    }

    const snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })

    return snapshot as VMHealthSnapshotType | null
  }

  @Query(() => [VMHealthCheckQueueType])
  @Authorized(['USER'])
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
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      // Regular users can only see their own machines
      if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
        throw new Error('Access denied')
      }

      where.machineId = machineId
    } else if (context.user?.role !== 'ADMIN') {
      // Regular users can only see their own machines' queues
      const userMachines = await this.prisma.machine.findMany({
        where: { userId: context.user?.id },
        select: { id: true }
      })
      where.machineId = { in: userMachines.map(m => m.id) }
    }

    if (status) {
      where.status = status as TaskStatus
    }

    const queueItems = await this.prisma.vMHealthCheckQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    })

    return queueItems as VMHealthCheckQueueType[]
  }

  @Query(() => VMHealthSnapshotType, { nullable: true })
  @Authorized(['USER'])
  async getLatestVMHealth (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthSnapshotType | null> {
    // Check if user has access to this machine
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new Error('Machine not found')
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new Error('Access denied')
    }

    const snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })

    return snapshot as VMHealthSnapshotType | null
  }

  @Query(() => VMHealthStatsType)
  @Authorized(['USER'])
  async vmHealthStats (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<VMHealthStatsType> {
    // Check if user has access to this machine
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new Error('Machine not found')
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new Error('Access denied')
    }

    const [
      totalSnapshots,
      healthySnapshots,
      warningSnapshots,
      errorSnapshots,
      latestSnapshot
    ] = await Promise.all([
      this.prisma.vMHealthSnapshot.count({
        where: { machineId }
      }),
      this.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'healthy' }
      }),
      this.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'warning' }
      }),
      this.prisma.vMHealthSnapshot.count({
        where: { machineId, overallStatus: 'error' }
      }),
      this.prisma.vMHealthSnapshot.findFirst({
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
  @Authorized(['ADMIN'])
  async healthCheckQueueStats (): Promise<QueueStatsType> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [pending, running, completed, failed, retryScheduled, totalToday] = await Promise.all([
      this.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.PENDING }
      }),
      this.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.RUNNING }
      }),
      this.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.COMPLETED }
      }),
      this.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.FAILED }
      }),
      this.prisma.vMHealthCheckQueue.count({
        where: { status: TaskStatus.RETRY_SCHEDULED }
      }),
      this.prisma.vMHealthCheckQueue.count({
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
