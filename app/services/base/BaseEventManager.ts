import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { SocketService } from '../SocketService'
import { EventAction, EventPayload, EventData } from '../EventManager'

/**
 * Base class for Resource Event Managers.
 * Provides common utilities for fetching data, determining target users, and sending events.
 * Each subclass must implement resource-specific behavior.
 */
export abstract class BaseEventManager {
  protected prisma: PrismaClient
  protected socketService: SocketService

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // ============================================
  // Abstract methods - must be implemented by subclasses
  // ============================================

  /**
   * Return the resource name for logging purposes
   * e.g., 'vm', 'application', 'department', 'user'
   */
  protected abstract getResourceName (): string

  /**
   * Fetch complete resource data from database.
   * If data is already complete, return it as-is.
   * If only an ID is provided, fetch from database.
   * @returns The resource data or null if not found
   */
  protected abstract fetchResourceData (resourceData: EventData): Promise<any | null>

  /**
   * Determine which users should receive events for this resource.
   * Each manager has specific permission logic based on resource type.
   * @param resource - The resource data
   * @param action - The event action
   * @returns Array of user IDs to notify
   */
  protected abstract getTargetUsers (resource: any, action: EventAction): Promise<string[]>

  // ============================================
  // Concrete implementations - reusable across all managers
  // ============================================

  /**
   * Get all admin users
   * @returns Array of admin user IDs
   */
  protected async getAdminUsers (): Promise<string[]> {
    try {
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          deleted: false
        },
        select: { id: true }
      })
      return adminUsers.map(admin => admin.id)
    } catch (error) {
      logger.error(`Error fetching admin users:`, error)
      return []
    }
  }

  /**
   * Get all active (non-deleted) users
   * @returns Array of active user IDs
   */
  protected async getAllActiveUsers (): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: { deleted: false },
        select: { id: true }
      })
      return users.map(user => user.id)
    } catch (error) {
      logger.error(`Error fetching active users:`, error)
      return []
    }
  }

  /**
   * Get users in the same department as a resource
   * @param departmentId - The department ID
   * @returns Array of user IDs in the department
   */
  protected async getDepartmentUsers (departmentId: string): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          deleted: false,
          VM: {
            some: {
              departmentId
            }
          }
        },
        select: { id: true }
      })
      return users.map(user => user.id)
    } catch (error) {
      logger.error(`Error fetching department users:`, error)
      return []
    }
  }

  /**
   * Get users who have VMs in any of the given departments.
   * Used by ApplicationEventManager and DepartmentEventManager for department-based targeting.
   * @param departmentIds - Array of department IDs
   * @returns Array of user IDs in those departments
   */
  protected async getUsersByDepartmentIds (departmentIds: string[]): Promise<string[]> {
    if (!departmentIds || departmentIds.length === 0) {
      return []
    }
    try {
      const users = await this.prisma.user.findMany({
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
      return users.map(user => user.id)
    } catch (error) {
      logger.error(`Error fetching users by department IDs:`, error)
      return []
    }
  }

  /**
   * Send an event to multiple users
   * @param userIds - Array of user IDs to notify
   * @param namespace - Socket namespace (e.g., 'vms', 'applications')
   * @param action - Event action (e.g., 'create', 'update', 'delete')
   * @param payload - Event payload to send
   */
  protected sendToTargetUsers (
    userIds: string[],
    namespace: string,
    action: string,
    payload: EventPayload
  ): void {
    for (const userId of userIds) {
      this.socketService.sendToUser(userId, namespace, action, payload)
    }
  }

  /**
   * Build a standard delete event payload
   * @param id - The resource ID
   * @returns Standard delete payload
   */
  protected buildDeletePayload (id: string): EventPayload {
    return {
      status: 'success',
      data: {
        id,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }
  }

  /**
   * Get users to notify for a deleted resource.
   * Default implementation: admins + all active users (ensures everyone sees the deletion).
   * Subclasses can override for specific permission logic.
   * @param resourceData - The resource data or ID
   * @returns Array of user IDs to notify
   */
  protected async getTargetUsersForDeleted (resourceData: EventData): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // Include all admin users
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // Include all active users (ensures everyone sees the deletion)
      const activeIds = await this.getAllActiveUsers()
      activeIds.forEach(id => targetUsers.add(id))

      return Array.from(targetUsers)
    } catch (error) {
      logger.error(`Error determining target users for deleted ${this.getResourceName()}:`, error)
      return []
    }
  }

  // ============================================
  // Base event handler - provides common flow
  // Subclasses can override handleEvent for custom behavior
  // ============================================

  /**
   * Base event handler - handles the common flow of:
   * 1. Log the event
   * 2. Fetch resource data
   * 3. Determine target users
   * 4. Create payload and send to users
   *
   * Override this method in subclasses for custom handling (e.g., VmEventManager's auto-check handling).
   */
  async handleEvent (action: EventAction, resourceData: EventData, triggeredBy?: string): Promise<void> {
    try {
      logger.info(`📋 Handling ${this.getResourceName()} event: ${action}`, {
        resourceId: resourceData?.id,
        triggeredBy
      })

      // Special handling for delete events
      if (action === 'delete') {
        const targetUsers = await this.getTargetUsersForDeleted(resourceData)
        const id = typeof resourceData === 'string' ? resourceData : resourceData?.id
        const payload = this.buildDeletePayload(id as string)

        logger.info(`🗑️ Sending ${this.getResourceName()} delete event to ${targetUsers.length} users`)
        this.sendToTargetUsers(targetUsers, this.getResourceName(), 'delete', payload)
        logger.info(`✅ ${this.getResourceName()} delete event sent to ${targetUsers.length} users`)
        return
      }

      // Get fresh resource data from database
      const resource = await this.fetchResourceData(resourceData)
      if (!resource) {
        logger.warn(`⚠️ ${this.getResourceName()} not found for event: ${resourceData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(resource, action)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: resource
      }

      // Send event to each target user
      this.sendToTargetUsers(targetUsers, this.getResourceName(), action, payload)

      logger.info(`✅ ${this.getResourceName()} event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      logger.error(`❌ Error handling ${this.getResourceName()} event ${action}:`, error)
      throw error
    }
  }
}
