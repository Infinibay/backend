import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction } from './EventManager'

// Department Event Manager - handles department-specific real-time events
export class DepartmentEventManager extends BaseEventManager {

  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  // ============================================
  // Abstract method implementations
  // ============================================

  protected getResourceName (): string {
    return 'departments'
  }

  protected async fetchResourceData (deptData: any): Promise<any | null> {
    try {
      // If we already have complete data with GraphQL format, use it
      if (deptData && typeof deptData === 'object' && deptData.name && 'totalMachines' in deptData) {
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
          _count: {
            select: { machines: true }
          }
        }
      })

      if (!department) {
        return null
      }

      // Format the data to match GraphQL API structure
      return {
        id: department.id,
        name: department.name,
        createdAt: department.createdAt,
        internetSpeed: department.internetSpeed || undefined,
        ipSubnet: department.ipSubnet || undefined,
        totalMachines: department._count.machines,
        firewallPolicy: department.firewallPolicy,
        firewallDefaultConfig: department.firewallDefaultConfig || undefined,
        firewallCustomRules: department.firewallCustomRules || undefined
      }
    } catch (error) {
      logger.error('Error fetching department data:', error)
      return null
    }
  }

  protected async getTargetUsers (department: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users (they can see all departments)
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // 2. Include users who have VMs in this department
      if (department.id) {
        const deptUserIds = await this.getDepartmentUsers(department.id)
        deptUserIds.forEach(id => targetUsers.add(id))
      }

      // 3. For create action, include all active users
      if (action === 'create') {
        const activeIds = await this.getAllActiveUsers()
        activeIds.forEach(id => targetUsers.add(id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      logger.error('Error determining target users for department event:', error)
      return []
    }
  }

  // ============================================
  // Public convenience handlers
  // ============================================

  async handleDepartmentCreated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', deptData, triggeredBy)
  }

  async handleDepartmentUpdated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', deptData, triggeredBy)
  }

  async handleDepartmentDeleted (deptData: any, triggeredBy?: string): Promise<void> {
    // Delegate to inherited handleEvent which handles delete events
    await this.handleEvent('delete', deptData, triggeredBy)
  }
}
