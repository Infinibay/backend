import { Arg, Authorized, Ctx, Query, Resolver } from 'type-graphql'
// import { Subscription, Root, PubSub } from 'type-graphql' // TODO: Enable when PubSub is configured
import {
  SystemMetrics,
  ProcessSnapshot,
  ApplicationUsage,
  PortUsage,
  WindowsService,
  MetricsFilterInput,
  ProcessFilterInput,
  MachineMetricsSummary
} from './type'
import { InfinibayContext } from '@main/utils/context'

// Helper function to ensure JSON fields are valid for GraphQLJSONObject
const ensureValidJSONObject = (value: any, isArrayField: boolean = false): any => {
  // For fields that should be arrays, wrap them in an object
  if (isArrayField) {
    if (Array.isArray(value)) {
      return { data: value }
    }
    if (value && typeof value === 'object' && value.constructor === Object) {
      // Already an object, check if it has the data property
      if ('data' in value) {
        return value
      }
      // Wrap the object in a data property
      return { data: [value] }
    }
    // Return empty array wrapped in object
    return { data: [] }
  }

  // For regular object fields
  if (value && typeof value === 'object' && value.constructor === Object) {
    return value
  }

  // Return empty object for any invalid input
  return {}
}

@Resolver()
export class MetricsResolver {
  @Query(() => [SystemMetrics])
  @Authorized(['ADMIN', 'USER'])
  async systemMetrics(
    @Arg('filter', { nullable: true }) filter: MetricsFilterInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<SystemMetrics[]> {
    const where: any = {}

    if (filter?.machineId) {
      where.machineId = filter.machineId
    }

    if (filter?.startDate || filter?.endDate) {
      where.timestamp = {}
      if (filter.startDate) {
        where.timestamp.gte = filter.startDate
      }
      if (filter.endDate) {
        where.timestamp.lte = filter.endDate
      }
    }

    const results = await prisma.systemMetrics.findMany({
      where,
      take: filter?.limit || 100,
      skip: filter?.offset || 0,
      orderBy: { timestamp: 'desc' }
    })

    return results.map(r => ({
      ...r,
      cpuCoresUsage: r.cpuCoresUsage as number[],
      cpuTemperature: r.cpuTemperature ?? undefined,
      totalMemoryKB: Number(r.totalMemoryKB),
      usedMemoryKB: Number(r.usedMemoryKB),
      availableMemoryKB: Number(r.availableMemoryKB),
      swapTotalKB: r.swapTotalKB ? Number(r.swapTotalKB) : undefined,
      swapUsedKB: r.swapUsedKB ? Number(r.swapUsedKB) : undefined,
      uptime: Number(r.uptime),
      // Ensure JSON fields are valid objects
      diskUsageStats: ensureValidJSONObject(r.diskUsageStats, true),
      diskIOStats: ensureValidJSONObject(r.diskIOStats),
      networkStats: ensureValidJSONObject(r.networkStats),
      loadAverage: ensureValidJSONObject(r.loadAverage)
    }))
  }

  @Query(() => SystemMetrics, { nullable: true })
  @Authorized(['ADMIN', 'USER'])
  async latestSystemMetrics(
    @Arg('machineId') machineId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<SystemMetrics | null> {
    const result = await prisma.systemMetrics.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' }
    })

    if (!result) return null

    return {
      ...result,
      cpuCoresUsage: result.cpuCoresUsage as number[],
      cpuTemperature: result.cpuTemperature ?? undefined,
      totalMemoryKB: Number(result.totalMemoryKB),
      usedMemoryKB: Number(result.usedMemoryKB),
      availableMemoryKB: Number(result.availableMemoryKB),
      swapTotalKB: result.swapTotalKB ? Number(result.swapTotalKB) : undefined,
      swapUsedKB: result.swapUsedKB ? Number(result.swapUsedKB) : undefined,
      uptime: Number(result.uptime),
      // Ensure JSON fields are valid objects
      diskUsageStats: ensureValidJSONObject(result.diskUsageStats, true),
      diskIOStats: ensureValidJSONObject(result.diskIOStats),
      networkStats: ensureValidJSONObject(result.networkStats),
      loadAverage: ensureValidJSONObject(result.loadAverage)
    }
  }

  @Query(() => [ProcessSnapshot])
  @Authorized(['ADMIN', 'USER'])
  async processSnapshots(
    @Arg('filter', { nullable: true }) filter: ProcessFilterInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ProcessSnapshot[]> {
    const where: any = {}

    if (filter?.machineId) {
      where.machineId = filter.machineId
    }

    if (filter?.name) {
      where.name = {
        contains: filter.name,
        mode: 'insensitive'
      }
    }

    if (filter?.startDate || filter?.endDate) {
      where.timestamp = {}
      if (filter.startDate) {
        where.timestamp.gte = filter.startDate
      }
      if (filter.endDate) {
        where.timestamp.lte = filter.endDate
      }
    }

    const results = await prisma.processSnapshot.findMany({
      where,
      take: filter?.limit || 20,
      orderBy: [
        { timestamp: 'desc' },
        { cpuUsagePercent: 'desc' }
      ]
    })

    return results.map(r => ({
      ...r,
      parentPid: r.parentPid ?? undefined,
      executablePath: r.executablePath ?? undefined,
      commandLine: r.commandLine ?? undefined,
      memoryUsageKB: Number(r.memoryUsageKB),
      diskReadBytes: r.diskReadBytes ? Number(r.diskReadBytes) : undefined,
      diskWriteBytes: r.diskWriteBytes ? Number(r.diskWriteBytes) : undefined,
      startTime: r.startTime ?? undefined
    }))
  }

  @Query(() => [ProcessSnapshot])
  @Authorized(['ADMIN', 'USER'])
  async topProcessesByMachine(
    @Arg('machineId') machineId: string,
    @Arg('limit', { nullable: true, defaultValue: 10 }) limit: number,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ProcessSnapshot[]> {
    // Get the most recent timestamp for this machine
    const latest = await prisma.processSnapshot.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true }
    })

    if (!latest) {
      return []
    }

    // Get processes from the most recent collection
    const results = await prisma.processSnapshot.findMany({
      where: {
        machineId,
        timestamp: latest.timestamp
      },
      take: limit,
      orderBy: { cpuUsagePercent: 'desc' }
    })

    return results.map(r => ({
      ...r,
      parentPid: r.parentPid ?? undefined,
      executablePath: r.executablePath ?? undefined,
      commandLine: r.commandLine ?? undefined,
      memoryUsageKB: Number(r.memoryUsageKB),
      diskReadBytes: r.diskReadBytes ? Number(r.diskReadBytes) : undefined,
      diskWriteBytes: r.diskWriteBytes ? Number(r.diskWriteBytes) : undefined,
      startTime: r.startTime ?? undefined
    }))
  }

  @Query(() => [ApplicationUsage])
  @Authorized(['ADMIN', 'USER'])
  async applicationUsage(
    @Arg('machineId', () => String, { nullable: true }) machineId: string | undefined,
    @Arg('limit', () => Number, { nullable: true, defaultValue: 50 }) limit: number,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ApplicationUsage[]> {
    const where: any = { isActive: true }

    if (machineId) {
      where.machineId = machineId
    }

    const results = await prisma.applicationUsage.findMany({
      where,
      take: limit,
      orderBy: [
        { totalUsageMinutes: 'desc' },
        { accessCount: 'desc' }
      ]
    })

    return results.map(r => ({
      ...r,
      version: r.version ?? undefined,
      description: r.description ?? undefined,
      publisher: r.publisher ?? undefined,
      lastAccessTime: r.lastAccessTime ?? undefined,
      lastModifiedTime: r.lastModifiedTime ?? undefined,
      iconData: r.iconData ?? undefined,
      iconFormat: r.iconFormat ?? undefined,
      fileSize: r.fileSize ? Number(r.fileSize) : undefined
    }))
  }

  @Query(() => [PortUsage])
  @Authorized(['ADMIN', 'USER'])
  async portUsage(
    @Arg('machineId') machineId: string,
    @Arg('listeningOnly', { nullable: true, defaultValue: false }) listeningOnly: boolean,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<PortUsage[]> {
    const where: any = { machineId }

    if (listeningOnly) {
      where.isListening = true
    }

    // Get the most recent port data for this machine
    const latest = await prisma.portUsage.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true }
    })

    if (latest) {
      where.timestamp = latest.timestamp
    }

    const results = await prisma.portUsage.findMany({
      where,
      orderBy: { port: 'asc' }
    })

    return results.map(r => ({
      ...r,
      processId: r.processId ?? undefined,
      processName: r.processName ?? undefined,
      executablePath: r.executablePath ?? undefined
    }))
  }

  @Query(() => [WindowsService])
  @Authorized(['ADMIN', 'USER'])
  async windowsServices(
    @Arg('machineId') machineId: string,
    @Arg('runningOnly', { nullable: true, defaultValue: false }) runningOnly: boolean,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<WindowsService[]> {
    const where: any = { machineId }

    if (runningOnly) {
      where.currentState = 'running'
    }

    const results = await prisma.windowsService.findMany({
      where,
      orderBy: [
        { isDefaultService: 'asc' },
        { usageScore: 'desc' },
        { serviceName: 'asc' }
      ]
    })

    return results.map(r => ({
      ...r,
      description: r.description ?? undefined,
      executablePath: r.executablePath ?? undefined,
      dependencies: r.dependencies ?? undefined,
      processId: r.processId ?? undefined,
      lastStateChange: r.lastStateChange ?? undefined,
      usageScore: r.usageScore ?? undefined
    }))
  }

  @Query(() => MachineMetricsSummary, { nullable: true })
  @Authorized(['ADMIN', 'USER'])
  async machineMetricsSummary(
    @Arg('machineId') machineId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<MachineMetricsSummary | null> {
    // Get latest system metrics
    const latestSystemMetrics = await prisma.systemMetrics.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' }
    })

    // Get metrics counts and date ranges
    const [systemMetricsCount, firstDataPoint, lastDataPoint] = await Promise.all([
      prisma.systemMetrics.count({ where: { machineId } }),
      prisma.systemMetrics.findFirst({
        where: { machineId },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true }
      }),
      prisma.systemMetrics.findFirst({
        where: { machineId },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true }
      })
    ])

    // Get counts for other metrics
    const [activeProcessCount, openPortsCount, installedApplicationsCount] = await Promise.all([
      prisma.processSnapshot.count({
        where: {
          machineId,
          timestamp: lastDataPoint?.timestamp || new Date()
        }
      }),
      prisma.portUsage.count({
        where: {
          machineId,
          isListening: true,
          timestamp: lastDataPoint?.timestamp || new Date()
        }
      }),
      prisma.applicationUsage.count({
        where: {
          machineId,
          isActive: true
        }
      })
    ])

    if (!latestSystemMetrics && systemMetricsCount === 0) {
      return null
    }

    const formattedMetrics = latestSystemMetrics
      ? {
        ...latestSystemMetrics,
        cpuCoresUsage: latestSystemMetrics.cpuCoresUsage as number[],
        cpuTemperature: latestSystemMetrics.cpuTemperature ?? undefined,
        totalMemoryKB: Number(latestSystemMetrics.totalMemoryKB),
        usedMemoryKB: Number(latestSystemMetrics.usedMemoryKB),
        availableMemoryKB: Number(latestSystemMetrics.availableMemoryKB),
        swapTotalKB: latestSystemMetrics.swapTotalKB ? Number(latestSystemMetrics.swapTotalKB) : undefined,
        swapUsedKB: latestSystemMetrics.swapUsedKB ? Number(latestSystemMetrics.swapUsedKB) : undefined,
        uptime: Number(latestSystemMetrics.uptime),
        // Ensure JSON fields are valid objects
        diskUsageStats: ensureValidJSONObject(latestSystemMetrics.diskUsageStats, true),
        diskIOStats: ensureValidJSONObject(latestSystemMetrics.diskIOStats),
        networkStats: ensureValidJSONObject(latestSystemMetrics.networkStats),
        loadAverage: ensureValidJSONObject(latestSystemMetrics.loadAverage)
      }
      : undefined

    return {
      machineId,
      latestSystemMetrics: formattedMetrics,
      totalDataPoints: systemMetricsCount,
      firstDataPoint: firstDataPoint?.timestamp ?? undefined,
      lastDataPoint: lastDataPoint?.timestamp ?? undefined,
      activeProcessCount,
      openPortsCount,
      installedApplicationsCount
    }
  }

  @Query(() => [SystemMetrics])
  @Authorized(['ADMIN', 'USER'])
  async systemMetricsHistory(
    @Arg('machineId') machineId: string,
    @Arg('hours', { nullable: true, defaultValue: 24 }) hours: number,
    @Arg('maxPoints', { nullable: true, defaultValue: 100 }) maxPoints: number,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<SystemMetrics[]> {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000)

    // Get total count first
    const totalCount = await prisma.systemMetrics.count({
      where: {
        machineId,
        timestamp: { gte: startDate }
      }
    })

    // Calculate skip interval to get roughly maxPoints
    const skipInterval = Math.max(1, Math.floor(totalCount / maxPoints))

    // Get raw data
    const allData = await prisma.systemMetrics.findMany({
      where: {
        machineId,
        timestamp: { gte: startDate }
      },
      orderBy: { timestamp: 'asc' }
    })

    // Sample data to reduce number of points
    const sampledData = allData.filter((_, index) => index % skipInterval === 0)

    return sampledData.map(r => ({
      ...r,
      cpuCoresUsage: r.cpuCoresUsage as number[],
      cpuTemperature: r.cpuTemperature ?? undefined,
      totalMemoryKB: Number(r.totalMemoryKB),
      usedMemoryKB: Number(r.usedMemoryKB),
      availableMemoryKB: Number(r.availableMemoryKB),
      swapTotalKB: r.swapTotalKB ? Number(r.swapTotalKB) : undefined,
      swapUsedKB: r.swapUsedKB ? Number(r.swapUsedKB) : undefined,
      uptime: Number(r.uptime),
      // Ensure JSON fields are valid objects
      diskUsageStats: ensureValidJSONObject(r.diskUsageStats, true),
      diskIOStats: ensureValidJSONObject(r.diskIOStats),
      networkStats: ensureValidJSONObject(r.networkStats),
      loadAverage: ensureValidJSONObject(r.loadAverage)
    }))
  }

  // Subscription for real-time metrics updates
  // TODO: Enable when PubSub is configured
  // @Subscription(() => SystemMetrics, {
  //   topics: 'SYSTEM_METRICS_UPDATED'
  // })
  // @Authorized(['ADMIN', 'USER'])
  // async systemMetricsUpdated (
  //   @Arg('machineId', { nullable: true }) machineId?: string,
  //   @Root() payload?: { machineId: string; metrics: SystemMetrics }
  // ): Promise<SystemMetrics> {
  //   // Filter by machineId if specified
  //   if (machineId && payload?.machineId !== machineId) {
  //     throw new Error('Machine ID filter does not match')
  //   }

  //   return payload!.metrics
  // }
}

// Helper function to publish metrics updates (to be called from VirtioSocketService)
export const publishSystemMetricsUpdate = async (
  publish: (payload: { machineId: string; metrics: SystemMetrics }) => Promise<void>,
  machineId: string,
  metrics: SystemMetrics
) => {
  await publish({ machineId, metrics })
}
