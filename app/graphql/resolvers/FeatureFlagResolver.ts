import { Resolver, Query, Mutation, Arg, Ctx } from 'type-graphql'
import { FeatureFlagService } from '@services/FeatureFlagService'
import { FeatureFlagType } from '@graphql/types/FeatureFlagType'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { Can } from '@main/permissions'

@Resolver()
export class FeatureFlagResolver {
  /**
   * List all known feature flags with their effective on/off state. Readable by
   * any authenticated user — the frontend needs flags to render its nav. Reuses
   * `appSettings:view` (instance-config read), which every role holds, so no
   * preset/re-seed is required.
   */
  @Query(() => [FeatureFlagType])
  @Can('appSettings:view')
  async featureFlags (@Ctx() { prisma }: InfinibayContext): Promise<FeatureFlagType[]> {
    return new FeatureFlagService(prisma).getAll()
  }

  /**
   * Toggle a feature flag instance-wide. Gated by `featureFlag:set`, which only
   * SUPER_ADMIN holds (via `*`) — feature flags are an instance-config concern.
   */
  @Mutation(() => FeatureFlagType)
  @Can('featureFlag:set')
  async setFeatureFlag (
    @Arg('key') key: string,
    @Arg('enabled') enabled: boolean,
    @Ctx() context: InfinibayContext
  ): Promise<FeatureFlagType> {
    try {
      return await new FeatureFlagService(context.prisma).set(key, enabled, context.user?.id ?? null)
    } catch (error) {
      throw new UserInputError((error as Error).message)
    }
  }
}
