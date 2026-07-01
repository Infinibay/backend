import { Resolver, Subscription, Root, Arg, Authorized } from 'type-graphql'
import { pubsub, TOPICS } from '@main/utils/pubsub'
import { getUserAccessibleDepartments } from '@main/utils/authChecker'
import { SystemMetrics } from './type'

@Resolver()
export class MetricsResolver {

  // Subscription for real-time metrics updates
  @Subscription(() => SystemMetrics, {
    topics: TOPICS.SYSTEM_METRICS_UPDATED,
    // Security: this stream carries sensitive per-machine/host telemetry
    // (CPU/memory/disk/network/uptime). Fail closed and scope every payload to
    // the subscribing user. `@Authorized(['ADMIN','USER'])` only proves the
    // caller is authenticated, so an unscoped filter would let any user read
    // every tenant's metrics — and an omitted machineId must NOT act as a
    // match-all wildcard for non-admins (cross-tenant leak / IDOR).
    filter: async ({ payload, args, context }: { payload: { machineId: string, metrics: SystemMetrics }, args: { machineId?: string }, context: any }) => {
      const user = context?.user
      if (!user) return false
      const matchesArg = !args.machineId || payload.machineId === args.machineId
      // Admins/super-admins see the whole fleet.
      if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
        return matchesArg
      }
      // Non-admins: drop any payload whose machine scope can't be established.
      if (!payload.machineId) return false
      const machine = await context.prisma.machine.findUnique({
        where: { id: payload.machineId },
        select: { userId: true, departmentId: true }
      })
      if (!machine) return false
      // Owner of the VM, or a manager of the VM's department.
      if (machine.userId === user.id) return matchesArg
      const depts = await getUserAccessibleDepartments(context.prisma, user.id)
      return depts.includes(machine.departmentId) && matchesArg
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
