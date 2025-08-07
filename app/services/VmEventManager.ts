import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload } from './EventManager'

// VM Event Manager - handles VM-specific real-time events with permission checking
export class VmEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor(socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for VM events
  async handleEvent(action: EventAction, vmData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`🖥️ Handling VM event: ${action}`, { vmId: vmData?.id, triggeredBy })

      // Get fresh VM data from database if we only have an ID
      const vm = await this.getVmData(vmData)
      if (!vm) {
        console.warn(`⚠️ VM not found for event: ${vmData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(vm, action)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: vm
      }

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'vms', action, payload)
      }

      console.log(`✅ VM event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      console.error(`❌ Error handling VM event ${action}:`, error)
      throw error
    }
  }

  // Get complete VM data from database
  private async getVmData(vmData: any): Promise<any> {
    try {
      // If we already have complete data, use it
      if (vmData && typeof vmData === 'object' && vmData.name && vmData.status) {
        return vmData
      }

      // If we only have an ID, fetch from database
      const vmId = typeof vmData === 'string' ? vmData : vmData?.id
      if (!vmId) {
        return null
      }

      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true
            }
          },
          template: {
            select: {
              id: true,
              name: true,
              description: true
            }
          },
          department: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })

      return vm
    } catch (error) {
      console.error('Error fetching VM data:', error)
      return null
    }
  }

  // Determine which users should receive this VM event based on permissions
  private async getTargetUsers(vm: any, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include the VM owner (if exists)
      if (vm.userId) {
        targetUsers.add(vm.userId)
      }

      // 2. Include all admin users (they can see everything)
      const adminUsers = await this.prisma.user.findMany({
        where: { 
          role: 'ADMIN',
          deleted: false 
        },
        select: { id: true }
      })
      adminUsers.forEach(admin => targetUsers.add(admin.id))

      // 3. Include users in the same department (if VM has department)
      if (vm.departmentId) {
        const departmentUsers = await this.prisma.user.findMany({
          where: {
            deleted: false,
            VM: {
              some: {
                departmentId: vm.departmentId
              }
            }
          },
          select: { id: true }
        })
        departmentUsers.forEach(user => targetUsers.add(user.id))
      }

      // 4. For certain actions, include all users who can see VMs
      if (action === 'create') {
        // New VMs might be visible to users looking for available machines
        const allActiveUsers = await this.prisma.user.findMany({
          where: { deleted: false },
          select: { id: true }
        })
        allActiveUsers.forEach(user => targetUsers.add(user.id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users:', error)
      return []
    }
  }

  // Specific VM event handlers with additional logic

  async handleVmCreated(vmData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', vmData, triggeredBy)
  }

  async handleVmUpdated(vmData: any, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', vmData, triggeredBy)
  }

  async handleVmDeleted(vmData: any, triggeredBy?: string): Promise<void> {
    // For delete events, we might not have full VM data anymore
    // So we'll send the basic info we have
    const targetUsers = await this.getTargetUsersForDeletedVm(vmData)
    
    const payload: EventPayload = {
      status: 'success',
      data: {
        id: vmData.id || vmData,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }

    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'vms', 'delete', payload)
    }
  }

  async handleVmPowerStateChange(vmData: any, action: 'power_on' | 'power_off' | 'suspend', triggeredBy?: string): Promise<void> {
    await this.handleEvent(action, vmData, triggeredBy)
  }

  // Special handling for deleted VMs (limited data available)
  private async getTargetUsersForDeletedVm(vmData: any): Promise<string[]> {
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

      // If we have the VM owner ID, include them
      if (vmData.userId) {
        targetUsers.add(vmData.userId)
      }

      // For safety, include all active users for delete events
      // This ensures everyone sees the VM disappear from their lists
      const allActiveUsers = await this.prisma.user.findMany({
        where: { deleted: false },
        select: { id: true }
      })
      allActiveUsers.forEach(user => targetUsers.add(user.id))

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for deleted VM:', error)
      return []
    }
  }
}
