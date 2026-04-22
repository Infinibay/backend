import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventData, EventPayload } from './EventManager'
import { SocketService } from './SocketService'

/**
 * BackupEventManager - real-time events for backups and backup_schedules.
 *
 * Payloads are already built by BackupService/BackupScheduleService (they pass
 * the full object to dispatchEvent). This manager's job is to fan out the
 * payload to the right users: VM owner + admins.
 *
 * Registered against two resource namespaces:
 *   - 'backups'          (created / progress / completed / failed / delete)
 *   - 'backup_schedules' (create / update / delete)
 */
export class BackupEventManager extends BaseEventManager {
  private readonly resource: 'backups' | 'backup_schedules'

  constructor (
    socketService: SocketService,
    prisma: PrismaClient,
    resource: 'backups' | 'backup_schedules'
  ) {
    super(socketService, prisma)
    this.resource = resource
  }

  protected getResourceName (): string {
    return this.resource
  }

  /**
   * Payloads dispatched by Backup services are already complete objects. We
   * don't re-fetch from DB — we just forward what the caller sent.
   */
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
        logger.warn(`BackupEventManager: failed to resolve VM owner for ${vmId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return Array.from(targets)
  }

  /**
   * Override: the base class handles 'delete' separately (broadcasts to all
   * users) which is wrong for per-VM backups. Route every action through the
   * same owner+admins path.
   */
  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      const payload = await this.fetchResourceData(resourceData)
      if (!payload) {
        logger.warn(`⚠️ ${this.resource} event ${action} had no payload`)
        return
      }

      const targetUsers = await this.getTargetUsers(payload)
      const eventPayload: EventPayload = { status: 'success', data: payload }

      this.sendToTargetUsers(targetUsers, this.resource, action, eventPayload)
      logger.info(`✅ ${this.resource} event '${action}' sent to ${targetUsers.length} user(s) ${triggeredBy ? `(trigger=${triggeredBy})` : ''}`)
    } catch (err) {
      logger.error(`❌ Error handling ${this.resource} event ${action}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
