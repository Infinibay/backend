import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { EventAction, EventData, ResourceEventManager } from './EventManager'

/**
 * Real-time fan-out for governance/policy changes (roles, grants, user-role
 * assignments, per-user overrides, department membership). These are admin-only
 * concerns, so every change is pushed to all connected ADMIN/SUPER_ADMIN users —
 * their open "Roles & Permissions" view then refetches just the affected slice.
 *
 * Routed via `sendToUsers` (per-user namespace) rather than `sendToAdmins`
 * (the `admin` room) so the event name matches the namespaced pattern the
 * frontend `socketService.subscribeToResource` listens on.
 */
export class PolicyEventManager implements ResourceEventManager {
  constructor (
    private readonly socketService: SocketService,
    private readonly prisma: PrismaClient
  ) {}

  async handleEvent (action: EventAction, data: EventData): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { deleted: false, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true }
    })
    if (!admins.length) return
    this.socketService.sendToUsers(admins.map((a) => a.id), 'policy', action, { data })
  }
}
