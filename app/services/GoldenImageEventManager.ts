import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload } from './EventManager'
import { SocketService } from './SocketService'

/**
 * GoldenImageEventManager — real-time events for golden-image lifecycle.
 *
 * GoldenImageService emits:
 *   - 'progress'  (build/capture progress: { id, progressPercent, step })
 *   - 'update'    (lifecycle change: publish / deprecate)
 *   - 'delete'    (image removed)
 *
 * Target users: admins only (golden images are an admin-level concern).
 * The frontend images page subscribes to 'progress' to show live
 * build percentage and step without manual polling.
 */
export class GoldenImageEventManager extends BaseEventManager {
  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  protected getResourceName (): string {
    return 'golden_images'
  }

  protected async fetchResourceData (resourceData: EventData): Promise<any | null> {
    return resourceData ?? null
  }

  protected async getTargetUsers (_payload: any): Promise<string[]> {
    return await this.getAdminUsers()
  }

  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      // Special handling for delete — use base class logic
      if (action === 'delete') {
        await super.handleEvent(action, resourceData, triggeredBy)
        return
      }

      // For progress / update events the payload is already complete
      const payload = resourceData
      if (!payload?.id) {
        logger.warn(`⚠️ golden_images event '${action}' had no payload or id`)
        return
      }

      const targetUsers = await this.getTargetUsers(payload)
      const eventPayload: EventPayload = { status: 'success', data: payload }

      this.sendToTargetUsers(targetUsers, 'golden_images', action, eventPayload)
      logger.info(`✅ golden_images event '${action}' sent to ${targetUsers.length} user(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling golden_images event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
