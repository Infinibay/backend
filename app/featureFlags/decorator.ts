import { UseMiddleware } from 'type-graphql'
import type { MiddlewareFn } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { ForbiddenError } from '@utils/errors'
import { FeatureFlagService } from '@services/FeatureFlagService'

/**
 * `@RequireFeatureFlag('key')` — gate a query/mutation behind a feature flag.
 * When the flag is OFF the operation is rejected (ForbiddenError) before the
 * resolver body runs. This is defense-in-depth alongside the frontend nav/route
 * gating: a flagged-off feature cannot be driven via the API either.
 *
 * Apply it ONLY to endpoints DEDICATED to a flagged feature — never to shared
 * endpoints (e.g. `getSystemResources` powers Overview as well as Storage, so it
 * must NOT be gated by the `storage` flag).
 *
 *   @Query(() => [StorageBucket])
 *   @RequireFeatureFlag('storage')
 *   @Can('storage:view')
 *   async storageBuckets () { ... }
 */
export function RequireFeatureFlag (key: string) {
  const middleware: MiddlewareFn<InfinibayContext> = async ({ context }, next) => {
    const enabled = await new FeatureFlagService(context.prisma).isEnabled(key)
    if (!enabled) {
      throw new ForbiddenError(`Feature "${key}" is not enabled`)
    }
    return next()
  }
  return UseMiddleware(middleware)
}
