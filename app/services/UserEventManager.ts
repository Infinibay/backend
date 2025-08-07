import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload } from './EventManager'

// User Event Manager - handles user-specific real-time events with permission checking
export class UserEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor(socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for user events
  async handleEvent(action: EventAction, userData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`👤 Handling user event: ${action}`, { userId: userData?.id, triggeredBy })

      // Get fresh user data from database if we only have an ID
      const user = await this.getUserData(userData)
      if (!user) {
        console.warn(`⚠️ User not found for event: ${userData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(user, action)

      // Create event payload (exclude sensitive data)
      const payload: EventPayload = {
        status: 'success',
        data: this.sanitizeUserData(user)
      }

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'users', action, payload)
      }

      console.log(`✅ User event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      console.error(`❌ Error handling user event ${action}:`, error)
      throw error
    }
  }

  // Get complete user data from database
  private async getUserData(userData: any): Promise<any> {
    try {
      // If we already have complete data, use it
      if (userData && typeof userData === 'object' && userData.email && userData.firstName) {
        return userData
      }

      // If we only have an ID, fetch from database
      const userId = typeof userData === 'string' ? userData : userData?.id
      if (!userId) {
        return null
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
          deleted: true,
          // Don't include password or token for security
          VM: {
            select: {
              id: true,
              name: true,
              status: true
            }
          }
        }
      })

      return user
    } catch (error) {
      console.error('Error fetching user data:', error)
      return null
    }
  }

  // Remove sensitive data from user object before sending
  private sanitizeUserData(user: any): any {
    const { password, token, ...sanitizedUser } = user
    return sanitizedUser
  }

  // Determine which users should receive this user event based on permissions
  private async getTargetUsers(user: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include the user themselves (for their own updates)
      if (user.id) {
        targetUsers.add(user.id)
      }

      // 2. Always include all admin users (they can see all user events)
      const adminUsers = await this.prisma.user.findMany({
        where: { 
          role: 'ADMIN',
          deleted: false 
        },
        select: { id: true }
      })
      adminUsers.forEach(admin => targetUsers.add(admin.id))

      // 3. For certain actions, include users who might need to see this
      if (action === 'create') {
        // New users might be visible to other users in user management
        // For now, only admins see new user creation
      } else if (action === 'update') {
        // User updates might affect shared resources
        // Include users who share VMs or departments with this user
        const relatedUsers = await this.getRelatedUsers(user.id)
        relatedUsers.forEach(userId => targetUsers.add(userId))
      } else if (action === 'delete') {
        // User deletion should be visible to users who had shared resources
        const relatedUsers = await this.getRelatedUsers(user.id)
        relatedUsers.forEach(userId => targetUsers.add(userId))
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for user event:', error)
      return []
    }
  }

  // Get users who are related to this user (shared departments, VMs, etc.)
  private async getRelatedUsers(userId: string): Promise<string[]> {
    try {
      const relatedUsers: Set<string> = new Set()

      // Find users who share departments (through VMs)
      const userVMs = await this.prisma.machine.findMany({
        where: { userId },
        select: { departmentId: true }
      })

      const departmentIds = userVMs
        .map(vm => vm.departmentId)
        .filter(Boolean) as string[]

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
        departmentUsers.forEach(user => relatedUsers.add(user.id))
      }

      return Array.from(relatedUsers)
    } catch (error) {
      console.error('Error finding related users:', error)
      return []
    }
  }

  // Specific user event handlers

  async handleUserCreated(userData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', userData, triggeredBy)
  }

  async handleUserUpdated(userData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', userData, triggeredBy)
  }

  async handleUserDeleted(userData: any, triggeredBy?: string): Promise<void> {
    // For delete events, we might not have full user data anymore
    const targetUsers = await this.getTargetUsersForDeletedUser(userData)
    
    const payload: EventPayload = {
      status: 'success',
      data: {
        id: userData.id || userData,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }

    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'users', 'delete', payload)
    }
  }

  // Special handling for deleted users (limited data available)
  private async getTargetUsersForDeletedUser(userData: any): Promise<string[]> {
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

      // Include related users if we can determine them
      if (userData.id) {
        const relatedUsers = await this.getRelatedUsers(userData.id)
        relatedUsers.forEach(userId => targetUsers.add(userId))
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for deleted user:', error)
      return []
    }
  }
}
