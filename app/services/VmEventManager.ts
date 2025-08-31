import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload, EventData } from './EventManager'

// VM interface for type safety - flexible to handle different Prisma query results
interface VMData {
  id: string
  name: string
  status: string
  userId: string | null
  departmentId: string | null
  user?: {
    id: string
    firstName?: string
    lastName?: string
    email?: string
    role?: string
  } | null
  template?: {
    id: string
    name: string
    description?: string | null
  } | null
  department?: {
    id: string
    name?: string
  } | null
}

// VM Event Manager - handles VM-specific real-time events with permission checking
export class VmEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for VM events
  async handleEvent (action: EventAction, vmData: EventData, triggeredBy?: string): Promise<void> {
    try {
      console.log(`🖥️ Handling VM event: ${action}`, { vmId: vmData?.id, triggeredBy })

      // Handle auto-check specific events through general event flow
      if (action === 'autocheck_issue_detected' || action === 'autocheck_remediation_available' || action === 'autocheck_remediation_completed') {
        // Get fresh VM data from database if we only have an ID
        const vm = await this.getVmData(vmData)
        if (!vm) {
          console.warn(`⚠️ VM not found for auto-check event: ${vmData?.id}`)
          return
        }

        // Determine which users should receive this event
        const targetUsers = await this.getTargetUsers(vm, action)

        // Create event payload with auto-check specific data
        const payload: EventPayload = {
          status: 'success',
          data: {
            ...vm,
            ...vmData // Include any additional auto-check specific data
          }
        }

        // Send event to each target user
        for (const userId of targetUsers) {
          this.socketService.sendToUser(userId, 'autocheck', action.replace('autocheck_', '').replace(/_/g, '-'), payload)
        }

        console.log(`✅ Auto-check event sent to ${targetUsers.length} users: ${action}`)
        return
      }

      // Special handling for delete events
      if (action === 'delete') {
        await this.handleVmDeleted(vmData, triggeredBy)
        return
      }

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
  private async getVmData (vmData: EventData): Promise<VMData | null> {
    try {
      // If we already have complete data, use it
      if (vmData && typeof vmData === 'object' && vmData.name && vmData.status && vmData.userId !== undefined && vmData.departmentId !== undefined) {
        return vmData as unknown as VMData
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
  private async getTargetUsers (vm: VMData, action: EventAction): Promise<string[]> {
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

  async handleVmCreated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', vmData, triggeredBy)
  }

  async handleVmUpdated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', vmData, triggeredBy)
  }

  async handleVmDeleted (vmData: EventData, triggeredBy?: string): Promise<void> {
    // For delete events, we might not have full VM data anymore
    // So we'll send the basic info we have
    const targetUsers = await this.getTargetUsersForDeletedVm(vmData)
    console.log(`🗑️ Sending VM delete event to ${targetUsers.length} users`)

    const payload: EventPayload = {
      status: 'success',
      data: {
        id: vmData.id || vmData,
        action: 'deleted',
        deletedAt: new Date().toISOString()
      }
    }

    for (const userId of targetUsers) {
      console.log(`📤 Sending delete event to user: ${userId}`)
      this.socketService.sendToUser(userId, 'vms', 'delete', payload)
    }

    console.log(`✅ VM delete event sent to ${targetUsers.length} users`)
  }

  async handleVmPowerStateChange (vmData: EventData, action: 'power_on' | 'power_off' | 'suspend', triggeredBy?: string): Promise<void> {
    await this.handleEvent(action, vmData, triggeredBy)
  }

  // Special handling for deleted VMs (limited data available)
  private async getTargetUsersForDeletedVm (vmData: EventData): Promise<string[]> {
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
      if (vmData.userId && typeof vmData.userId === 'string') {
        targetUsers.add(vmData.userId as string)
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

  // Health check specific event handlers
  async handleHealthCheckEvent(
    vmId: string, 
    checkType: string, 
    result: unknown, 
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🏥 Handling health check event: ${checkType} for VM ${vmId}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for health check event: ${vmId}`)
        return
      }

      // Determine target users (owner and department members)
      const targetUsers = await this.getTargetUsers(vm, 'health_check')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          checkType,
          result,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send health check event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'health_checks', checkType, payload)
      }

      console.log(`✅ Health check event sent to ${targetUsers.length} users: ${checkType}`)
    } catch (error) {
      console.error(`❌ Error handling health check event ${checkType}:`, error)
      throw error
    }
  }

  // Handle health status changes (Critical/Warning/Healthy)
  async handleHealthStatusChange(
    vmId: string,
    newStatus: 'healthy' | 'warning' | 'critical',
    checkResults: unknown[],
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🚨 Health status change for VM ${vmId}: ${newStatus}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for health status change: ${vmId}`)
        return
      }

      // Determine target users
      const targetUsers = await this.getTargetUsers(vm, 'health_status_change')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          vmName: vm.name,
          healthStatus: newStatus,
          checkResults,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send status change event
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'health_status', 'change', payload)
      }

      console.log(`✅ Health status change event sent to ${targetUsers.length} users`)
    } catch (error) {
      console.error(`❌ Error handling health status change:`, error)
      throw error
    }
  }

  // Handle remediation events
  async handleRemediationEvent(
    vmId: string,
    actionType: string,
    result: unknown,
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🔧 Handling remediation event: ${actionType} for VM ${vmId}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for remediation event: ${vmId}`)
        return
      }

      // Determine target users
      const targetUsers = await this.getTargetUsers(vm, 'remediation')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          vmName: vm.name,
          actionType,
          result,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send remediation event
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'remediation', actionType, payload)
      }

      console.log(`✅ Remediation event sent to ${targetUsers.length} users: ${actionType}`)
    } catch (error) {
      console.error(`❌ Error handling remediation event ${actionType}:`, error)
      throw error
    }
  }

  // Handle auto-check events
  async handleAutoCheckIssueDetected(
    vmId: string,
    issueData: {
      checkType: string
      severity: 'warning' | 'critical'
      description: string
      details: unknown
    },
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🚨 Auto-check issue detected for VM ${vmId}: ${issueData.checkType}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for auto-check issue event: ${vmId}`)
        return
      }

      // Determine target users
      const targetUsers = await this.getTargetUsers(vm, 'autocheck_issue_detected')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          vmName: vm.name,
          issueType: issueData.checkType,
          severity: issueData.severity,
          description: issueData.description,
          details: issueData.details,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send auto-check issue event
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'autocheck', 'issue-detected', payload)
      }

      console.log(`✅ Auto-check issue event sent to ${targetUsers.length} users`)
    } catch (error) {
      console.error(`❌ Error handling auto-check issue event:`, error)
      throw error
    }
  }

  async handleAutoCheckRemediationAvailable(
    vmId: string,
    remediationData: {
      checkType: string
      remediationType: string
      description: string
      isAutomatic: boolean
      estimatedTime?: string
      details: unknown
    },
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🔧 Auto-check remediation available for VM ${vmId}: ${remediationData.remediationType}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for auto-check remediation event: ${vmId}`)
        return
      }

      // Determine target users
      const targetUsers = await this.getTargetUsers(vm, 'autocheck_remediation_available')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          vmName: vm.name,
          checkType: remediationData.checkType,
          remediationType: remediationData.remediationType,
          description: remediationData.description,
          isAutomatic: remediationData.isAutomatic,
          estimatedTime: remediationData.estimatedTime,
          details: remediationData.details,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send remediation available event
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'autocheck', 'remediation-available', payload)
      }

      console.log(`✅ Auto-check remediation available event sent to ${targetUsers.length} users`)
    } catch (error) {
      console.error(`❌ Error handling auto-check remediation available event:`, error)
      throw error
    }
  }

  async handleAutoCheckRemediationCompleted(
    vmId: string,
    completionData: {
      checkType: string
      remediationType: string
      success: boolean
      description: string
      executionTime?: string
      details: unknown
      error?: string
    },
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`✅ Auto-check remediation completed for VM ${vmId}: ${completionData.remediationType}`, { triggeredBy })

      // Get VM data
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        console.warn(`⚠️ VM not found for auto-check remediation completion event: ${vmId}`)
        return
      }

      // Determine target users
      const targetUsers = await this.getTargetUsers(vm, 'autocheck_remediation_completed')

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          vmId,
          vmName: vm.name,
          checkType: completionData.checkType,
          remediationType: completionData.remediationType,
          success: completionData.success,
          description: completionData.description,
          executionTime: completionData.executionTime,
          details: completionData.details,
          error: completionData.error,
          timestamp: new Date().toISOString(),
          triggeredBy
        }
      }

      // Send remediation completed event
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'autocheck', 'remediation-completed', payload)
      }

      console.log(`✅ Auto-check remediation completed event sent to ${targetUsers.length} users`)
    } catch (error) {
      console.error(`❌ Error handling auto-check remediation completed event:`, error)
      throw error
    }
  }
}
