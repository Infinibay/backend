import { Arg, Ctx, Query, Mutation, Resolver, ID, Int } from 'type-graphql'
import { GraphQLError } from 'graphql'
import { InfinibayContext } from '../../utils/context'
import { Can } from '@main/permissions'
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
  @Can('recommendation:view', { id: (a) => a.vmId, scopeVia: 'vm' })
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
  @Can('recommendation:view')
  async pendingRecommendationCount(
    @Ctx() context: InfinibayContext
  ): Promise<number> {
    const now = new Date()

    // Build where clause; narrow rows to the recommendations the caller may view
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Restrict to machines the caller can access (own/department/any)
    whereClause.machine = await context.scopedWhere!('recommendation:view', {})

    return context.prisma.vMRecommendation.count({
      where: whereClause
    })
  }

  @Query(() => [GlobalRecommendationType], {
    description: 'Get all pending recommendations across all VMs the user has access to'
  })
  @Can('recommendation:view')
  async globalPendingRecommendations(
    @Ctx() context: InfinibayContext,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 50 }) limit?: number
  ): Promise<GlobalRecommendationType[]> {
    const now = new Date()

    // Build where clause; narrow rows to the recommendations the caller may view
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Restrict to machines the caller can access (own/department/any)
    whereClause.machine = await context.scopedWhere!('recommendation:view', {})

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
  @Can('recommendation:dismiss')
  async dismissRecommendation(
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<DismissRecommendationResult> {
    // Load the recommendation to scope-check the owning machine
    const rec = await context.prisma.vMRecommendation.findUnique({
      where: { id },
      include: { machine: { select: { userId: true, departmentId: true } } }
    })

    if (!rec) {
      return { success: false, error: 'Recommendation not found' }
    }

    // Enforce scope against the owning machine (own/department/any)
    await context.assertCan!('recommendation:dismiss', rec.machine)

    await context.prisma.vMRecommendation.update({
      where: { id },
      data: { dismissedAt: new Date() }
    })

    return { success: true, dismissedCount: 1 }
  }

  @Mutation(() => DismissRecommendationResult, {
    description: 'Dismiss all pending recommendations the user has access to'
  })
  @Can('recommendation:dismiss')
  async dismissAllRecommendations(
    @Ctx() context: InfinibayContext
  ): Promise<DismissRecommendationResult> {
    const now = new Date()

    // Build where clause; narrow rows to the recommendations the caller may dismiss
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Restrict to machines the caller can access (own/department/any)
    whereClause.machine = await context.scopedWhere!('recommendation:dismiss', {})

    const result = await context.prisma.vMRecommendation.updateMany({
      where: whereClause,
      data: { dismissedAt: now }
    })

    return { success: true, dismissedCount: result.count }
  }

  @Mutation(() => SnoozeRecommendationResult, {
    description: 'Snooze a single recommendation for a duration (ISO 8601 duration format: PT1H, P1D, etc.)'
  })
  @Can('recommendation:dismiss')
  async snoozeRecommendation(
    @Arg('id', () => ID) id: string,
    @Arg('duration', () => String) duration: string,
    @Ctx() context: InfinibayContext
  ): Promise<SnoozeRecommendationResult> {
    // Load the recommendation to scope-check the owning machine
    const rec = await context.prisma.vMRecommendation.findUnique({
      where: { id },
      include: { machine: { select: { userId: true, departmentId: true } } }
    })

    if (!rec) {
      return { success: false, error: 'Recommendation not found' }
    }

    // Enforce scope against the owning machine (own/department/any)
    await context.assertCan!('recommendation:dismiss', rec.machine)

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
  @Can('recommendation:dismiss')
  async snoozeAllRecommendations(
    @Arg('duration', () => String) duration: string,
    @Ctx() context: InfinibayContext
  ): Promise<SnoozeRecommendationResult> {
    const now = new Date()
    const snoozedUntil = this.parseDuration(duration)

    // Build where clause; narrow rows to the recommendations the caller may snooze
    const whereClause: any = {
      dismissedAt: null,
      OR: [
        { snoozedUntil: null },
        { snoozedUntil: { lt: now } }
      ]
    }

    // Restrict to machines the caller can access (own/department/any)
    whereClause.machine = await context.scopedWhere!('recommendation:dismiss', {})

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
