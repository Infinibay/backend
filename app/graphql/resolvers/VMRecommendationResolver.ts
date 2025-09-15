import { Arg, Authorized, Ctx, Query, Resolver, ID } from 'type-graphql'
import { InfinibayContext } from '../../utils/context'
import { VMRecommendationType, RecommendationFilterInput } from '../types/RecommendationTypes'
import { VMRecommendationService } from '../../services/VMRecommendationService'

@Resolver()
export class VMRecommendationResolver {
  @Query(() => [VMRecommendationType])
  @Authorized(['USER'])
  async getVMRecommendations (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() context: InfinibayContext,
    @Arg('refresh', { nullable: true, defaultValue: false }) refresh?: boolean,
    @Arg('filter', () => RecommendationFilterInput, { nullable: true }) filter?: RecommendationFilterInput
  ): Promise<VMRecommendationType[]> {
    // Check if user has access to this machine
    const machine = await context.prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true, userId: true }
    })

    if (!machine) {
      throw new Error('Machine not found')
    }

    // Regular users can only see their own machines
    if (context.user?.role !== 'ADMIN' && machine.userId !== context.user?.id) {
      throw new Error('Access denied')
    }

    try {
      // Create service instance per request
      const recommendationService = new VMRecommendationService(context.prisma)

      // Get recommendations from service with filters applied at DB level
      const recommendations = await recommendationService.getRecommendations(vmId, refresh ?? false, filter || undefined)

      return recommendations as VMRecommendationType[]
    } catch (error) {
      console.error('Error fetching VM recommendations:', error)
      throw new Error('Failed to fetch recommendations')
    }
  }
}
