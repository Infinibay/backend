import logger from '@main/logger'
import { Resolver, Query, Arg, Ctx } from 'type-graphql'
import { InfinibayContext } from '@main/utils/context'
import { Can } from '@main/permissions'
import { getQemuGuestAgentService } from '@services/QemuGuestAgentService'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { ApolloError, isDomainError } from '@utils/errors'
import { sanitizeErrorForUser } from '@utils/sanitizeError'
import { VmDiagnostics, SocketConnectionStats, VmConnectionInfo } from './type'

@Resolver()
export class VmDiagnosticsResolver {
  private debug = logger.child({ module: 'vm-diagnostics' })

  /**
   * Maps a service connection object to VmConnectionInfo GraphQL type
   * Handles Date to ISO string conversions and keepAlive metrics mapping
   */
  private mapToVmConnectionInfo (conn: any): VmConnectionInfo {
    return {
      vmId: conn.vmId,
      isConnected: conn.isConnected,
      reconnectAttempts: conn.reconnectAttempts,
      lastMessageTime: conn.lastMessageTime.toISOString(),
      keepAlive: conn.keepAlive
        ? {
            sentCount: conn.keepAlive.sentCount,
            receivedCount: conn.keepAlive.receivedCount,
            failureCount: conn.keepAlive.failureCount,
            consecutiveFailures: conn.keepAlive.consecutiveFailures,
            averageRtt: conn.keepAlive.averageRtt,
            lastSent: conn.keepAlive.lastSent?.toISOString(),
            lastReceived: conn.keepAlive.lastReceived?.toISOString(),
            lastFailure: conn.keepAlive.lastFailure?.toISOString(),
            successRate: conn.keepAlive.successRate
          }
        : undefined
    }
  }

  @Query(() => VmDiagnostics, {
    description: 'Get comprehensive diagnostics for VM socket connection issues'
  })
  @Can('vmHealth:view', { id: (a) => a.vmId, scopeVia: 'vm' })
  async vmSocketDiagnostics (
    @Arg('vmId') vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<VmDiagnostics> {
    this.debug.info(`Running diagnostics for VM ${vmId}`)

    try {
      // Get VM information
      const vm = await prisma.machine.findUnique({
        where: { id: vmId },
        select: {
          id: true,
          name: true,
          status: true,
          os: true
        }
      })

      if (!vm) {
        throw new Error(`VM ${vmId} not found`)
      }

      // Get QEMU Guest Agent service
      const qemuService = await getQemuGuestAgentService()

      // Run diagnostics
      const diagnosticsResult = await qemuService.diagnoseSocketIssues(vmId)
      const infiniServiceCheck = await qemuService.checkInfiniService(vmId)

      // Get socket watcher stats
      let connectionStats: VmConnectionInfo | undefined
      try {
        const socketWatcher = getVirtioSocketWatcherService()
        const stats = socketWatcher.getConnectionStats()
        const vmConnection = stats.connections.find(c => c.vmId === vmId)

        if (vmConnection) {
          connectionStats = this.mapToVmConnectionInfo(vmConnection)
        }
      } catch (error) {
        this.debug.warn(`Could not get socket watcher stats: ${error}`)
      }

      return {
        vmId: vm.id,
        vmName: vm.name,
        vmStatus: vm.status,
        timestamp: new Date().toISOString(),
        diagnostics: diagnosticsResult.diagnostics,
        recommendations: diagnosticsResult.recommendations,
        infiniService: {
          installed: infiniServiceCheck.installed,
          running: infiniServiceCheck.running,
          error: infiniServiceCheck.error
        },
        connectionStats,
        manualCommands: [
          '# Check InfiniService status',
          `virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'`,
          '',
          '# Check socket file in VM',
          `virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"ls","arg":["-la","/opt/infinibay/sockets/"]}}'`,
          '',
          '# View InfiniService logs',
          `virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"journalctl","arg":["-u","infiniservice","-n","50"]}}'`,
          '',
          '# Check virtio-serial devices',
          `virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"ls","arg":["-la","/dev/virtio-ports/"]}}'`
        ]
      }
    } catch (error) {
      this.debug.error(`Diagnostics failed for VM ${vmId}: ${error}`)
      // Preserve domain-error semantics, but never rethrow the raw error to the
      // tenant: libvirt/prisma/socket-watcher messages can embed host paths and
      // internal stack detail, so surface a sanitized message instead.
      if (isDomainError(error)) throw error
      throw new ApolloError(sanitizeErrorForUser((error as Error).message) ?? 'Failed to run VM diagnostics')
    }
  }

  @Query(() => SocketConnectionStats, {
    description: 'Get current socket connection statistics for all VMs',
    nullable: true
  })
  // Fleet-wide diagnostic: getConnectionStats() enumerates every VM on the host
  // regardless of owner/department, so require an ANY-scope grant — an OWN/
  // DEPARTMENT-scoped vmHealth:view must not enumerate other tenants' VMs.
  @Can('vmHealth:view', { minScope: 'ANY' })
  async socketConnectionStats (): Promise<SocketConnectionStats | null> {
    try {
      const socketWatcher = getVirtioSocketWatcherService()
      const stats = socketWatcher.getConnectionStats()

      return {
        totalConnections: stats.totalConnections,
        activeConnections: stats.activeConnections,
        connections: stats.connections.map(conn => this.mapToVmConnectionInfo(conn))
      }
    } catch (error) {
      this.debug.error(`Failed to get connection stats: ${error}`)
      return null
    }
  }
}
