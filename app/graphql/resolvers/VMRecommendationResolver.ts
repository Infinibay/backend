import { Arg, Authorized, Ctx, Query, Resolver, ID } from 'type-graphql'
import { GraphQLError } from 'graphql'
import { InfinibayContext } from '../../utils/context'
import { VMRecommendationType, RecommendationFilterInput } from '../types/RecommendationTypes'
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
}
