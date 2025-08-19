import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload } from './EventManager'

// Application Event Manager - handles application-specific real-time events
export class ApplicationEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for application events
  async handleEvent (action: EventAction, appData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`📱 Handling application event: ${action}`, { appId: appData?.id, triggeredBy })

      // Get fresh application data from database if we only have an ID
      const application = await this.getApplicationData(appData)
      if (!application) {
        console.warn(`⚠️ Application not found for event: ${appData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(application, action)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: application
      }

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'applications', action, payload)
      }

      console.log(`✅ Application event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      console.error(`❌ Error handling application event ${action}:`, error)
      throw error
    }
  }

  // Get complete application data from database
  private async getApplicationData (appData: any): Promise<any> {
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
      console.error('Error fetching application data:', error)
      return null
    }
  }

  // Determine which users should receive this application event
  private async getTargetUsers (application: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users (they can see all applications)
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          deleted: false
        },
        select: { id: true }
      })
      adminUsers.forEach(admin => targetUsers.add(admin.id))

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
          const departmentUsers = await this.prisma.user.findMany({
            where: {
              deleted: false,
              VM: {
                some: {
                  departmentId: {
                    in: departmentIds
                  }
                }
              }
            },
            select: { id: true }
          })
          departmentUsers.forEach(user => targetUsers.add(user.id))
        }
      }

      // 3. For certain actions, include additional users
      if (action === 'create') {
        // New applications might be visible to all users for installation
        const allActiveUsers = await this.prisma.user.findMany({
          where: { deleted: false },
          select: { id: true }
        })
        allActiveUsers.forEach(user => targetUsers.add(user.id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for application event:', error)
      return []
    }
  }

  // Specific application event handlers

  async handleApplicationCreated (appData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', appData, triggeredBy)
  }

  async handleApplicationUpdated (appData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', appData, triggeredBy)
  }

  async handleApplicationDeleted (appData: any, triggeredBy?: string): Promise<void> {
    // For delete events, we might not have full application data anymore
    const targetUsers = await this.getTargetUsersForDeletedApplication(appData)

    const payload: EventPayload = {
      status: 'success',
      data: {
        id: appData.id || appData,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }

    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'applications', 'delete', payload)
    }
  }

  // Special handling for deleted applications (limited data available)
  private async getTargetUsersForDeletedApplication (appData: any): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // Include all admin users
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          deleted: false
        },
        select: { id: true }
      })
      adminUsers.forEach(admin => targetUsers.add(admin.id))

      // For safety, include all active users for delete events
      // This ensures everyone sees the application disappear from their lists
      const allActiveUsers = await this.prisma.user.findMany({
        where: { deleted: false },
        select: { id: true }
      })
      allActiveUsers.forEach(user => targetUsers.add(user.id))

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for deleted application:', error)
      return []
    }
  }
}
