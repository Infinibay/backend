import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload } from './EventManager'
import { SocketService } from './SocketService'

/**
 * MigrationEventManager - real-time events for cold VM migration between nodes.
 *
 * The interactive `migrateMachineToNode` mutation returns as soon as the VM is
 * claimed; the long disk copy runs on a background worker that emits lifecycle
 * events on the 'migrations' resource:
 *   started → progress (coarse phase: copying/committing/reclaiming) → completed | failed
 *
 * Payloads are built by the resolver's worker (full objects passed to dispatchEvent);
 * this manager only fans them out to the right users: the VM owner + admins. Every
 * payload carries `vmId` so the owner can be resolved (mirrors BackupEventManager).
 */
export class MigrationEventManager extends BaseEventManager {
  constructor (
    socketService: SocketService,
    prisma: PrismaClient
  ) {
    super(socketService, prisma)
  }

  protected getResourceName (): string {
    return 'migrations'
  }

  /** Payloads are already complete objects — forward what the caller sent. */
  protected async fetchResourceData (resourceData: EventData): Promise<any | null> {
    if (!resourceData) return null
    return resourceData
  }

  protected async getTargetUsers (payload: any): Promise<string[]> {
    const targets = new Set<string>()

    const adminIds = await this.getAdminUsers()
    adminIds.forEach(id => targets.add(id))

    const vmId = payload?.vmId
    if (vmId) {
      try {
        const vm = await this.prisma.machine.findUnique({
          where: { id: vmId },
          select: { userId: true }
        })
        if (vm?.userId) targets.add(vm.userId)
      } catch (err) {
        logger.warn(`MigrationEventManager: failed to resolve VM owner for ${vmId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return Array.from(targets)
  }

  /**
   * Route every action (including 'failed') through the same owner+admins path;
   * the base class's default 'delete' broadcast is wrong for a per-VM operation.
   */
  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      const payload = await this.fetchResourceData(resourceData)
      if (!payload) {
        logger.warn(`⚠️ migrations event ${action} had no payload`)
        return
      }

      const targetUsers = await this.getTargetUsers(payload)
      const eventPayload: EventPayload = { status: 'success', data: payload }

      this.sendToTargetUsers(targetUsers, 'migrations', action, eventPayload)
      logger.info(`✅ migrations event '${action}' sent to ${targetUsers.length} user(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling migrations event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
