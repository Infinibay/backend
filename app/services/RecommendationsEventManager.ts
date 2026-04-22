import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload } from './EventManager'
import { SocketService } from './SocketService'

/**
 * RecommendationsEventManager - real-time events for VM recommendation
 * generation lifecycle.
 *
 * HealthSnapshotManager emits:
 *   - 'started'   (recommendation generation started for a machine/snapshot)
 *   - 'completed' (generation finished with counts/types)
 *   - 'failed'    (generation errored)
 *
 * Target users: the VM owner + admins. The frontend VMRecommendationsTab
 * uses these to refetch the recommendation list as soon as the backend
 * finishes a snapshot instead of waiting for the 60s poll interval.
 */
export class RecommendationsEventManager extends BaseEventManager {
  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  protected getResourceName (): string {
    return 'recommendations'
  }

  protected async fetchResourceData (resourceData: EventData): Promise<any | null> {
    return resourceData ?? null
  }

  protected async getTargetUsers (payload: any): Promise<string[]> {
    const targets = new Set<string>()

    const adminIds = await this.getAdminUsers()
    adminIds.forEach(id => targets.add(id))

    const machineId = payload?.machineId
    if (machineId) {
      try {
        const vm = await this.prisma.machine.findUnique({
          where: { id: machineId },
          select: { userId: true }
        })
        if (vm?.userId) targets.add(vm.userId)
      } catch (err) {
        logger.warn(`RecommendationsEventManager: failed to resolve VM owner for ${machineId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return Array.from(targets)
  }

  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      const payload = await this.fetchResourceData(resourceData)
      if (!payload) {
        logger.warn(`⚠️ recommendations event ${action} had no payload`)
        return
      }

      const targetUsers = await this.getTargetUsers(payload)
      const eventPayload: EventPayload = { status: 'success', data: payload }

      this.sendToTargetUsers(targetUsers, 'recommendations', action, eventPayload)
      logger.info(`✅ recommendations event '${action}' sent to ${targetUsers.length} user(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling recommendations event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
