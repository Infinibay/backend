import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction } from './EventManager'

// Application Event Manager - handles application-specific real-time events
export class ApplicationEventManager extends BaseEventManager {

  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  // ============================================
  // Abstract method implementations
  // ============================================

  protected getResourceName (): string {
    return 'applications'
  }

  protected async fetchResourceData (appData: any): Promise<any | null> {
    try {
      // If we already have complete data, use it
      if (appData && typeof appData === 'object' && appData.name) {
        return appData
      }

      // If we only have an ID, fetch from database
      const appId = typeof appData === 'string' ? appData : appData?.id
      if (!appId) {
        return null
      }

      const application = await this.prisma.application.findUnique({
        where: { id: appId },
        include: {
          machines: {
            include: {
              machine: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  userId: true,
                  departmentId: true
                }
              }
            }
          }
        }
      })

      return application
    } catch (error) {
      logger.error('Error fetching application data:', error)
      return null
    }
  }

  protected async getTargetUsers (application: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users (they can see all applications)
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // 2. Include users who have VMs with this application
      if (application.machines && application.machines.length > 0) {
        const vmUserIds = application.machines
          .map((machineApp: any) => machineApp.machine.userId)
          .filter(Boolean)

        vmUserIds.forEach((userId: string) => targetUsers.add(userId))

        // Also include users in the same departments as these VMs
        const departmentIds = application.machines
          .map((machineApp: any) => machineApp.machine.departmentId)
          .filter(Boolean)

        if (departmentIds.length > 0) {
          const deptUserIds = await this.getUsersByDepartmentIds(departmentIds)
          deptUserIds.forEach(id => targetUsers.add(id))
        }
      }

      // 3. For create action, include all active users
      if (action === 'create') {
        const activeIds = await this.getAllActiveUsers()
        activeIds.forEach(id => targetUsers.add(id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      logger.error('Error determining target users for application event:', error)
      return []
    }
  }

  // ============================================
  // Public convenience handlers
  // ============================================

  async handleApplicationCreated (appData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', appData, triggeredBy)
  }

  async handleApplicationUpdated (appData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', appData, triggeredBy)
  }

  async handleApplicationDeleted (appData: any, triggeredBy?: string): Promise<void> {
    // Delegate to inherited handleEvent which handles delete events
    await this.handleEvent('delete', appData, triggeredBy)
  }
}
