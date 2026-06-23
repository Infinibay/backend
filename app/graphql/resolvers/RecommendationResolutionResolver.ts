import { Arg, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'
import { GraphQLError } from 'graphql'
import { Can } from '@main/permissions'
import { InfinibayContext } from '../../utils/context'
import { RecommendationResolutionType, ResolveRecommendationParamsInput } from '../types/RecommendationResolutionTypes'
import { RecommendationResolverService } from '../../services/recommendations/RecommendationResolverService'

function toGql (r: any): RecommendationResolutionType {
  return {
    id: r.id,
    recommendationId: r.recommendationId,
    machineId: r.machineId,
    actionKey: r.actionKey,
    status: r.status,
    progress: r.progress,
    progressMessage: r.progressMessage ?? null,
    params: r.params ? JSON.parse(JSON.stringify(r.params)) : null,
    result: r.result ? JSON.parse(JSON.stringify(r.result)) : null,
    error: r.error ?? null,
    triggeredByUserId: r.triggeredByUserId,
    startedAt: r.startedAt ?? null,
    completedAt: r.completedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

@Resolver()
export class RecommendationResolutionResolver {
  @Mutation(() => RecommendationResolutionType, {
    description: 'Trigger auto-resolution for a recommendation. Idempotent: returns the in-flight resolution if one is already running.'
  })
  @Can('recommendation:resolve')
  async resolveRecommendation (
    @Arg('id', () => ID) id: string,
    @Arg('actionKey', () => String) actionKey: string,
    @Ctx() context: InfinibayContext,
    @Arg('params', () => ResolveRecommendationParamsInput, { nullable: true }) params?: ResolveRecommendationParamsInput
  ): Promise<RecommendationResolutionType> {
    if (!context.user) {
      throw new GraphQLError('Not authorized', { extensions: { code: 'UNAUTHORIZED' } })
    }
    const service = new RecommendationResolverService(context.prisma)
    try {
      const resolution = await service.resolve({
        recommendationId: id,
        actionKey,
        userId: context.user.id,
        userRole: context.user.role,
        params: params as Record<string, unknown> | undefined
      })
      return toGql(resolution)
    } catch (err: any) {
      const msg = err?.message || 'Failed to resolve recommendation'
      if (msg === 'Recommendation not found') {
        throw new GraphQLError(msg, { extensions: { code: 'NOT_FOUND' } })
      }
      if (msg === 'Access denied') {
        throw new GraphQLError(msg, { extensions: { code: 'FORBIDDEN' } })
      }
      throw new GraphQLError(msg, { extensions: { code: 'BAD_USER_INPUT' } })
    }
  }

  @Mutation(() => RecommendationResolutionType, {
    description: 'Cancel a pending or running resolution. No-op on terminal resolutions.'
  })
  @Can('recommendation:cancel')
  async cancelResolution (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<RecommendationResolutionType> {
    if (!context.user) {
      throw new GraphQLError('Not authorized', { extensions: { code: 'UNAUTHORIZED' } })
    }
    const service = new RecommendationResolverService(context.prisma)
    const resolution = await service.cancel(id, context.user.id, context.user.role)
    return toGql(resolution)
  }

  @Query(() => RecommendationResolutionType, {
    nullable: true,
    description: 'Fetch a single resolution. Poll this query to track progress.'
  })
  @Can('recommendation:view')
  async recommendationResolution (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<RecommendationResolutionType | null> {
    const resolution = await context.prisma.recommendationResolution.findUnique({
      where: { id },
      include: { recommendation: { include: { machine: { select: { userId: true, departmentId: true } } } } }
    })
    if (!resolution) return null
    await context.assertCan!('recommendation:view', {
      userId: resolution.recommendation.machine.userId,
      departmentId: resolution.recommendation.machine.departmentId
    })
    return toGql(resolution)
  }

  @Query(() => [RecommendationResolutionType], {
    description: 'Return active (non-terminal) resolutions for a machine'
  })
  @Can('recommendation:view', { id: (a) => a.machineId, scopeVia: 'vm' })
  async activeResolutionsForMachine (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() context: InfinibayContext
  ): Promise<RecommendationResolutionType[]> {
    const machine = await context.prisma.machine.findUnique({
      where: { id: machineId },
      select: { userId: true }
    })
    if (!machine) {
      throw new GraphQLError('Machine not found', { extensions: { code: 'NOT_FOUND' } })
    }
    const rows = await context.prisma.recommendationResolution.findMany({
      where: {
        machineId,
        status: { in: ['PENDING', 'RUNNING'] }
      },
      orderBy: { createdAt: 'desc' }
    })
    return rows.map(toGql)
  }
}
