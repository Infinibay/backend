import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { LocalNodeRegistrationService } from './LocalNodeRegistrationService'
import { emitNodesChanged } from '../NodesEventManager'

let heartbeatTimer: NodeJS.Timeout | null = null

/**
 * Multi-node Phase 1: on a MASTER backend, ensure the local node is registered
 * and keep its `lastHeartbeat` fresh on an interval. This closes the Phase-0
 * follow-up where nothing refreshed the master's heartbeat (so it read 'stale'
 * after the threshold). Compute nodes do NOT run this — they heartbeat via the
 * standalone agent (agent/heartbeat-agent.ts) to POST /cluster/heartbeat.
 *
 * Idempotent and best-effort: a failure here must never block server startup.
 */
export async function startClusterHeartbeat (prisma: PrismaClient): Promise<void> {
  const role = (process.env.INFINIBAY_NODE_ROLE || 'master').toLowerCase()
  if (role !== 'master') {
    logger.info(`Cluster heartbeat: role=${role}; the standalone agent owns heartbeats on non-master nodes`)
    return
  }

  const registration = new LocalNodeRegistrationService(prisma)
  const node = await registration.registerLocalNode()

  // Guard against a non-numeric / zero / negative NODE_HEARTBEAT_INTERVAL_MS:
  // setInterval coerces NaN or <=0 to ~1ms, which would turn this best-effort
  // heartbeat into a busy loop hammering Postgres. Floor to a sane minimum.
  const rawInterval = process.env.NODE_HEARTBEAT_INTERVAL_MS
  const parsedInterval = Number(rawInterval)
  const intervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 1000 ? parsedInterval : 30000
  if (rawInterval !== undefined && intervalMs !== parsedInterval) {
    logger.warn(`Ignoring invalid NODE_HEARTBEAT_INTERVAL_MS='${rawInterval}'; falling back to ${intervalMs}ms (must be a number >= 1000)`)
  }
  const refresh = async (): Promise<void> => {
    try {
      await prisma.node.update({
        where: { id: node.id },
        data: { lastHeartbeat: new Date(), status: 'online' }
      })
      // This master tick is also the cluster liveness heartbeat: pushing it lets
      // the admin inventory recompute every node's online/stale state on an
      // interval (websocket-driven) rather than each client polling — and it is
      // the only signal that flips the LAST compute node to stale once it dies.
      emitNodesChanged('update', { id: node.id })
    } catch (error) {
      logger.warn(`Local node heartbeat refresh failed: ${String(error)}`)
    }
  }

  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = setInterval(() => { void refresh() }, intervalMs)
  // Don't keep the process alive solely for the heartbeat.
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()

  logger.info(`🫀 Local master node heartbeat started (every ${intervalMs}ms, node ${node.id})`)
}

/** Stops the local heartbeat timer (used in shutdown / tests). */
export function stopClusterHeartbeat (): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}
