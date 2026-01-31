import { Arg, Authorized, Ctx, Query, Mutation, Resolver, ID, Int } from 'type-graphql'
import { GraphQLError } from 'graphql'
import { InfinibayContext } from '../../utils/context'
import {
  VMRecommendationType,
  RecommendationFilterInput,
  GlobalRecommendationType,
  DismissRecommendationResult,
  SnoozeRecommendationResult
} from '../types/RecommendationTypes'
import { VMRecommendationService } from '../../services/VMRecommendationService'

@Resolver()
export class VMRecommendationResolver {
  @Query(() => [VMRecommendationType], {
    description: 'Get automated recommendations for VM optimization, security, and maintenance based on system analysis. Returns up to 20 recommendations by default to prevent over-fetch. Use pagination for more results.'
  })
  @Authorized(['USER'])
  async getVMRecommendations(
    @Arg('vmId', () => ID, { description: 'ID of the virtual machine to get recommendations for' }) vmId: string,
    @Ctx() context: InfinibayContext,
    @Arg('refresh', {
      nullable: true,
      defaultValue: false,
      description: 'If true, regenerate recommendations from latest health data instead of returning cached results'
    }) refresh?: boolean,
    @Arg('filter', () => RecommendationFilterInput, {
      nullable: true,
      description: 'Optional filters to limit recommendations by type, date range, or count'
    }) filter?: RecommendationFilterInput
  ): Promise<VMRecommendationType[]> {
    // Check if user has access to this machine
    const machine = await context.prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new GraphQLError('Machine not found', {
        extensions: { code: 'NOT_FOUND' }
      })
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new GraphQLError('Access denied', {
        extensions: { code: 'FORBIDDEN' }
      })
    }

    // Create service instance per request
    const recommendationService = new VMRecommendationService(context.prisma)

    // Use safe method to get recommendations with standardized error handling
    const recommendations = await recommendationService.getRecommendations(vmId, refresh ?? false, filter || undefined)

    // Transform raw Prisma objects to proper GraphQL format
    return recommendations.map(rec => ({
      id: rec.id,
      machineId: rec.machineId,
      snapshotId: rec.snapshotId,
      type: rec.type,
      text: rec.text,
      actionText: rec.actionText,
      data: rec.data ? JSON.parse(JSON.stringify(rec.data)) : null, // Ensure JSON-serializable
      createdAt: new Date(rec.createdAt) // Ensure Date object
    }))
  }

  // ==========================================================================
  // GLOBAL RECOMMENDATION QUERIES
  // ==========================================================================

  @Query(() => Int, {
    description: 'Get the count of pending (non-dismissed, non-snoozed) recommendations across all VMs'
  })
  @Authorized(['USER'])
  async pendingRecommendationCount(
    @Ctx() context: InfinibayContext
  ): Promise<number> {
    const now = new Date()

    // Build where clause based on user role
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Regular users can only see recommendations for their own machines
    if (context.user?.role !== 'ADMIN') {
      whereClause.machine = { userId: context.user?.id }
    }

    return context.prisma.vMRecommendation.count({
      where: whereClause
    })
  }

  @Query(() => [GlobalRecommendationType], {
    description: 'Get all pending recommendations across all VMs the user has access to'
  })
  @Authorized(['USER'])
  async globalPendingRecommendations(
    @Ctx() context: InfinibayContext,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 50 }) limit?: number
  ): Promise<GlobalRecommendationType[]> {
    const now = new Date()

    // Build where clause based on user role
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Regular users can only see recommendations for their own machines
    if (context.user?.role !== 'ADMIN') {
      whereClause.machine = { userId: context.user?.id }
    }

    const recommendations = await context.prisma.vMRecommendation.findMany({
      where: whereClause,
      include: {
        machine: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit || 50
    })

    // Determine severity from data or type
    return recommendations.map(rec => {
      const data = rec.data as Record<string, any> | null
      let severity = 'MEDIUM'

      // Try to get severity from data
      if (data?._severity) {
        severity = String(data._severity).toUpperCase()
      } else if (data?.severity) {
        severity = String(data.severity).toUpperCase()
      } else {
        // Infer severity from type
        const criticalTypes = ['DEFENDER_DISABLED', 'DEFENDER_THREAT']
        const highTypes = ['DISK_SPACE_LOW', 'OS_UPDATE_AVAILABLE']
        if (criticalTypes.includes(rec.type)) severity = 'CRITICAL'
        else if (highTypes.includes(rec.type)) severity = 'HIGH'
      }

      return {
        id: rec.id,
        machineId: rec.machineId,
        machineName: rec.machine.name,
        type: rec.type,
        text: rec.text,
        actionText: rec.actionText,
        severity,
        data: data ? JSON.parse(JSON.stringify(data)) : null,
        createdAt: new Date(rec.createdAt)
      }
    })
  }

  // ==========================================================================
  // RECOMMENDATION MUTATIONS
  // ==========================================================================

  @Mutation(() => DismissRecommendationResult, {
    description: 'Dismiss a single recommendation'
  })
  @Authorized(['USER'])
  async dismissRecommendation(
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<DismissRecommendationResult> {
    // Verify access
    const rec = await context.prisma.vMRecommendation.findUnique({
      where: { id },
      include: { machine: { select: { userId: true } } }
    })

    if (!rec) {
      return { success: false, error: 'Recommendation not found' }
    }

    if (context.user?.role !== 'ADMIN' && rec.machine.userId !== context.user?.id) {
      return { success: false, error: 'Access denied' }
    }

    await context.prisma.vMRecommendation.update({
      where: { id },
      data: { dismissedAt: new Date() }
    })

    return { success: true, dismissedCount: 1 }
  }

  @Mutation(() => DismissRecommendationResult, {
    description: 'Dismiss all pending recommendations the user has access to'
  })
  @Authorized(['USER'])
  async dismissAllRecommendations(
    @Ctx() context: InfinibayContext
  ): Promise<DismissRecommendationResult> {
    const now = new Date()

    // Build where clause based on user role
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    if (context.user?.role !== 'ADMIN') {
      whereClause.machine = { userId: context.user?.id }
    }

    const result = await context.prisma.vMRecommendation.updateMany({
      where: whereClause,
      data: { dismissedAt: now }
    })

    return { success: true, dismissedCount: result.count }
  }

  @Mutation(() => SnoozeRecommendationResult, {
    description: 'Snooze a single recommendation for a duration (ISO 8601 duration format: PT1H, P1D, etc.)'
  })
  @Authorized(['USER'])
  async snoozeRecommendation(
    @Arg('id', () => ID) id: string,
    @Arg('duration', () => String) duration: string,
    @Ctx() context: InfinibayContext
  ): Promise<SnoozeRecommendationResult> {
    // Verify access
    const rec = await context.prisma.vMRecommendation.findUnique({
      where: { id },
      include: { machine: { select: { userId: true } } }
    })

    if (!rec) {
      return { success: false, error: 'Recommendation not found' }
    }

    if (context.user?.role !== 'ADMIN' && rec.machine.userId !== context.user?.id) {
      return { success: false, error: 'Access denied' }
    }

    const snoozedUntil = this.parseDuration(duration)

    await context.prisma.vMRecommendation.update({
      where: { id },
      data: { snoozedUntil }
    })

    return { success: true, snoozedCount: 1, snoozedUntil }
  }

  @Mutation(() => SnoozeRecommendationResult, {
    description: 'Snooze all pending recommendations for a duration (ISO 8601 duration format: PT1H, P1D, etc.)'
  })
  @Authorized(['USER'])
  async snoozeAllRecommendations(
    @Arg('duration', () => String) duration: string,
    @Ctx() context: InfinibayContext
  ): Promise<SnoozeRecommendationResult> {
    const now = new Date()
    const snoozedUntil = this.parseDuration(duration)

    // Build where clause based on user role
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    if (context.user?.role !== 'ADMIN') {
      whereClause.machine = { userId: context.user?.id }
    }

    const result = await context.prisma.vMRecommendation.updateMany({
      where: whereClause,
      data: { snoozedUntil }
    })

    return { success: true, snoozedCount: result.count, snoozedUntil }
  }

  /**
   * Parse ISO 8601 duration string to Date
   * Supports: PT1H (1 hour), PT4H (4 hours), P1D (1 day), P7D (7 days)
   */
  private parseDuration(duration: string): Date {
    const now = new Date()
    const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/)

    if (!match) {
      // Default to 1 hour if invalid
      now.setHours(now.getHours() + 1)
      return now
    }

    const days = parseInt(match[1] || '0', 10)
    const hours = parseInt(match[2] || '0', 10)
    const minutes = parseInt(match[3] || '0', 10)

    now.setDate(now.getDate() + days)
    now.setHours(now.getHours() + hours)
    now.setMinutes(now.getMinutes() + minutes)

    return now
  }
}
