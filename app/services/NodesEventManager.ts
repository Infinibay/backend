import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload, getEventManager } from './EventManager'
import { SocketService } from './SocketService'

/**
 * NodesEventManager - real-time events for the compute-node inventory.
 *
 * Emits `nodes:<action>` whenever a node's lifecycle changes: a heartbeat
 * refresh (status / capacity / liveness), a pending join request, approval /
 * rejection, maintenance toggle, or removal. The frontend Infrastructure page
 * and PendingNodesSection subscribe to these to refetch `nodeInventorySummary`
 * / `nodes` / `pendingNodes` instead of polling on an interval.
 *
 * Node inventory is admin-only data (`node:view`), so events target admins.
 * The payload is intentionally minimal (`{ id }`): consumers refetch the
 * authoritative query rather than patch a cache from the wire.
 */
export class NodesEventManager extends BaseEventManager {
  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  protected getResourceName (): string {
    return 'nodes'
  }

  protected async fetchResourceData (resourceData: EventData): Promise<any | null> {
    return resourceData ?? {}
  }

  protected async getTargetUsers (): Promise<string[]> {
    return this.getAdminUsers()
  }

  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      const targetUsers = await this.getAdminUsers()
      const eventPayload: EventPayload = { status: 'success', data: resourceData ?? {} }
      this.sendToTargetUsers(targetUsers, 'nodes', action, eventPayload)
      logger.info(`✅ nodes event '${action}' sent to ${targetUsers.length} admin(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling nodes event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Fire-and-forget 'nodes' realtime event. Safe to call from anywhere (services,
 * resolvers, routes): if the EventManager singleton is not initialized yet — e.g.
 * a unit/integration test that constructs a node service directly, or very early
 * boot — this silently no-ops instead of throwing. Realtime is best-effort and
 * must never break the node lifecycle path that triggered it.
 */
export function emitNodesChanged (action: EventAction = 'update', data: EventData = {}): void {
  try {
    getEventManager().dispatchEvent('nodes', action, data).catch(err => {
      logger.warn(`nodes realtime emit failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  } catch {
    // EventManager not initialized (tests / early boot) — skip realtime silently.
  }
}
