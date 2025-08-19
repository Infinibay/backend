import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload } from './EventManager'

// Department Event Manager - handles department-specific real-time events
export class DepartmentEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for department events
  async handleEvent (action: EventAction, deptData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`🏢 Handling department event: ${action}`, { deptId: deptData?.id, triggeredBy })

      // Get fresh department data from database if we only have an ID
      const department = await this.getDepartmentData(deptData)
      if (!department) {
        console.warn(`⚠️ Department not found for event: ${deptData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(department, action)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: department
      }

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'departments', action, payload)
      }

      console.log(`✅ Department event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      console.error(`❌ Error handling department event ${action}:`, error)
      throw error
    }
  }

  // Get complete department data from database
  private async getDepartmentData (deptData: any): Promise<any> {
    try {
      // If we already have complete data, use it
      if (deptData && typeof deptData === 'object' && deptData.name) {
        return deptData
      }

      // If we only have an ID, fetch from database
      const deptId = typeof deptData === 'string' ? deptData : deptData?.id
      if (!deptId) {
        return null
      }

      const department = await this.prisma.department.findUnique({
        where: { id: deptId },
        include: {
          machines: {
            select: {
              id: true,
              name: true,
              status: true,
              userId: true
            }
          }
        }
      })

      return department
    } catch (error) {
      console.error('Error fetching department data:', error)
      return null
    }
  }

  // Determine which users should receive this department event
  private async getTargetUsers (department: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users (they can see all departments)
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          deleted: false
        },
        select: { id: true }
      })
      adminUsers.forEach(admin => targetUsers.add(admin.id))

      // 2. Include users who have VMs in this department
      if (department.id) {
        const departmentUsers = await this.prisma.user.findMany({
          where: {
            deleted: false,
            VM: {
              some: {
                departmentId: department.id
              }
            }
          },
          select: { id: true }
        })
        departmentUsers.forEach(user => targetUsers.add(user.id))
      }

      // 3. For certain actions, include additional users
      if (action === 'create') {
        // New departments might be visible to all users for VM assignment
        const allActiveUsers = await this.prisma.user.findMany({
          where: { deleted: false },
          select: { id: true }
        })
        allActiveUsers.forEach(user => targetUsers.add(user.id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for department event:', error)
      return []
    }
  }

  // Specific department event handlers

  async handleDepartmentCreated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', deptData, triggeredBy)
  }

  async handleDepartmentUpdated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', deptData, triggeredBy)
  }

  async handleDepartmentDeleted (deptData: any, triggeredBy?: string): Promise<void> {
    // For delete events, we might not have full department data anymore
    const targetUsers = await this.getTargetUsersForDeletedDepartment(deptData)

    const payload: EventPayload = {
      status: 'success',
      data: {
        id: deptData.id || deptData,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }

    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'departments', 'delete', payload)
    }
  }

  // Special handling for deleted departments (limited data available)
  private async getTargetUsersForDeletedDepartment (deptData: any): Promise<string[]> {
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
      // This ensures everyone sees the department disappear from their lists
      const allActiveUsers = await this.prisma.user.findMany({
        where: { deleted: false },
        select: { id: true }
      })
      allActiveUsers.forEach(user => targetUsers.add(user.id))

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for deleted department:', error)
      return []
    }
  }
}
