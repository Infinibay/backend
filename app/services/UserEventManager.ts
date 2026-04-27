import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventPayload } from './EventManager'

// User Event Manager - handles user-specific real-time events with permission checking
export class UserEventManager extends BaseEventManager {

  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  // ============================================
  // Abstract method implementations
  // ============================================

  protected getResourceName (): string {
    return 'users'
  }

  protected async fetchResourceData (userData: any): Promise<any | null> {
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
      logger.error('Error fetching user data:', error)
      return null
    }
  }

  protected async getTargetUsers (user: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include the user themselves (for their own updates)
      if (user.id) {
        targetUsers.add(user.id)
      }

      // 2. Include all admin users (they can see all user events)
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // 3. For update action, include related users
      if (action === 'update') {
        const relatedIds = await this.getRelatedUsers(user.id)
        relatedIds.forEach(id => targetUsers.add(id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      logger.error('Error determining target users for user event:', error)
      return []
    }
  }

  // ============================================
  // Override handleEvent to sanitize user data before sending
  // ============================================

  async handleEvent (action: EventAction, userData: any, triggeredBy?: string): Promise<void> {
    try {
      logger.info(`👤 Handling user event: ${action}`, { userId: userData?.id, triggeredBy })

      // Handle delete events with inherited logic
      if (action === 'delete') {
        const targetUsers = await this.getTargetUsersForDeleted(userData)
        const id = typeof userData === 'string' ? userData : userData?.id
        const payload = this.buildDeletePayload(id as string)

        logger.info(`🗑️ Sending user delete event to ${targetUsers.length} users`)
        this.sendToTargetUsers(targetUsers, this.getResourceName(), 'delete', payload)
        logger.info(`✅ User delete event sent to ${targetUsers.length} users`)
        return
      }

      // Get fresh user data from database
      const user = await this.fetchResourceData(userData)
      if (!user) {
        logger.warn(`⚠️ User not found for event: ${userData?.id}`)
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
      this.sendToTargetUsers(targetUsers, this.getResourceName(), action, payload)

      logger.info(`✅ User event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      logger.error(`❌ Error handling user event ${action}:`, error)
      throw error
    }
  }

  // ============================================
  // Override for user-specific delete handling
  // ============================================

  protected async getTargetUsersForDeleted (resourceData: any): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // Include all admin users
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // Include related users if we can determine them
      if (resourceData?.id) {
        const relatedIds = await this.getRelatedUsers(resourceData.id)
        relatedIds.forEach(id => targetUsers.add(id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      logger.error(`Error determining target users for deleted user:`, error)
      return []
    }
  }

  // ============================================
  // User-specific helpers
  // ============================================

  // Remove sensitive data from user object before sending
  private sanitizeUserData (user: any): any {
    const { password, token, ...sanitizedUser } = user
    return sanitizedUser
  }

  // Get users who are related to this user (shared departments, VMs, etc.)
  private async getRelatedUsers (userId: string): Promise<string[]> {
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
        const deptUserIds = await this.getUsersByDepartmentIds(departmentIds)
        deptUserIds.forEach(id => relatedUsers.add(id))
      }

      return Array.from(relatedUsers)
    } catch (error) {
      logger.error('Error finding related users:', error)
      return []
    }
  }

  // ============================================
  // Public convenience handlers
  // ============================================

  async handleUserCreated (userData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', userData, triggeredBy)
  }

  async handleUserUpdated (userData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', userData, triggeredBy)
  }

  async handleUserDeleted (userData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('delete', userData, triggeredBy)
  }
}
