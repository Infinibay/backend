import { Resolver, Subscription, Root, Arg, Authorized } from 'type-graphql'
import { pubsub, TOPICS } from '@main/utils/pubsub'
import { SystemMetrics } from './type'

@Resolver()
export class MetricsResolver {

  // Subscription for real-time metrics updates
  @Subscription(() => SystemMetrics, {
    topics: TOPICS.SYSTEM_METRICS_UPDATED,
    filter: ({ payload, args }) => {
      // Filter by machineId if specified
      return !args.machineId || payload.machineId === args.machineId
    }
  })
  @Authorized(['ADMIN', 'USER'])
  async systemMetricsUpdated (
    @Arg('machineId', { nullable: true }) machineId?: string,
    @Root() payload?: { machineId: string; metrics: SystemMetrics }
  ): Promise<SystemMetrics> {
    if (!payload) {
      throw new Error('Metrics payload not available')
    }
    return payload.metrics
  }
}

// Helper function to publish metrics updates (to be called from VirtioSocketService)
export const publishSystemMetricsUpdate = async (
  machineId: string,
  metrics: SystemMetrics
): Promise<void> => {
  await pubsub.publish(TOPICS.SYSTEM_METRICS_UPDATED, {
    machineId,
    metrics
  })
}
