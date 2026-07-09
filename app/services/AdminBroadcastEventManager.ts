import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload, getEventManager } from './EventManager'
import { SocketService } from './SocketService'

/**
 * AdminBroadcastEventManager - a generic resource manager for admin-only,
 * refetch-driven realtime resources.
 *
 * It broadcasts `${resource}:${action}` to every admin with a minimal payload;
 * the frontend refetches the authoritative query rather than patching a cache
 * from the wire. Use it for resources whose data is admin-scoped and cheap to
 * refetch — currently `identity` (LDAP/AD providers, sync runs, group→role
 * mappings) and `agent_connections` (per-VM InfiniService connectivity). This is
 * the same shape as NodesEventManager, parameterized by resource name so a new
 * admin-broadcast resource is one `registerResourceManager` line, not a new file.
 */
export class AdminBroadcastEventManager extends BaseEventManager {
  private readonly resource: string

  constructor (socketService: SocketService, prisma: PrismaClient, resource: string) {
    super(socketService, prisma)
    this.resource = resource
  }

  protected getResourceName (): string {
    return this.resource
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
      const payload: EventPayload = { status: 'success', data: resourceData ?? {} }
      this.sendToTargetUsers(targetUsers, this.resource, action, payload)
      logger.info(`✅ ${this.resource} event '${action}' sent to ${targetUsers.length} admin(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling ${this.resource} event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Fire-and-forget realtime event for an admin-broadcast resource. Safe to call
 * from anywhere (services, resolvers, deep watchers): if the EventManager
 * singleton is not initialized yet — e.g. a unit/integration test constructing a
 * service directly, or very early boot — this silently no-ops instead of
 * throwing. Realtime is best-effort and must never break the path that fired it.
 */
export function emitAdminResourceEvent (resource: string, action: EventAction = 'update', data: EventData = {}): void {
  try {
    getEventManager().dispatchEvent(resource, action, data).catch(err => {
      logger.warn(`${resource} realtime emit failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  } catch {
    // EventManager not initialized (tests / early boot) — skip realtime silently.
  }
}
