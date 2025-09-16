import { Resolver } from 'type-graphql'
// import { Subscription, Root, PubSub } from 'type-graphql' // TODO: Enable when PubSub is configured
import { SystemMetrics } from './type'


@Resolver()
export class MetricsResolver {









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
