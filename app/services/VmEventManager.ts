import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventPayload, EventData } from './EventManager'

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
export class VmEventManager extends BaseEventManager {

  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  // ============================================
  // Abstract method implementations
  // ============================================

  protected getResourceName (): string {
    return 'vms'
  }

  protected async fetchResourceData (vmData: EventData): Promise<VMData | null> {
    try {
      // If we already have complete data, use it. We require setupComplete to
      // be present on full payloads, otherwise the broadcast would carry a
      // stale value (or undefined) and Apollo would never flip the UI from
      // Installing → Running.
      if (
        vmData &&
        typeof vmData === 'object' &&
        vmData.name &&
        'status' in vmData &&
        'userId' in vmData &&
        'departmentId' in vmData &&
        'setupComplete' in vmData
      ) {
        return vmData as unknown as VMData
      }

      // If we only have an ID (or partial deltas like { id, setupComplete }),
      // fetch from database to build the full payload.
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
          },
          configuration: {
            select: { setupComplete: true }
          }
        }
      })

      if (!vm) return null

      // Project setupComplete from configuration to top-level so the GraphQL
      // payload matches the Machine type the frontend expects.
      return {
        ...vm,
        setupComplete: vm.configuration?.setupComplete ?? false
      } as unknown as VMData
    } catch (error) {
      logger.error('Error fetching VM data:', error)
      return null
    }
  }

  protected async getTargetUsers (vm: VMData, action: EventAction): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include the VM owner (if exists)
      if (vm.userId) {
        targetUsers.add(vm.userId)
      }

      // 2. Include all admin users (they can see everything)
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      // 3. Include users in the same department (if VM has department)
      if (vm.departmentId) {
        const deptUserIds = await this.getDepartmentUsers(vm.departmentId)
        deptUserIds.forEach(id => targetUsers.add(id))
      }

      // 4. For create action, include all active users
      if (action === 'create') {
        const activeIds = await this.getAllActiveUsers()
        activeIds.forEach(id => targetUsers.add(id))
      }

      return Array.from(targetUsers)
    } catch (error) {
      logger.error('Error determining target users:', error)
      return []
    }
  }

  // ============================================
  // Override handleEvent for VM-specific auto-check handling
  // ============================================

  async handleEvent (action: EventAction, vmData: EventData, triggeredBy?: string): Promise<void> {
    try {
      logger.info(`🖥️ Handling VM event: ${action}`, { vmId: vmData?.id, triggeredBy })

      // Handle auto-check specific events via consolidated handler
      if (action === 'autocheck_issue_detected' || action === 'autocheck_remediation_available' || action === 'autocheck_remediation_completed') {
        await this.handleAutoCheckEvent(action, vmData, triggeredBy)
        return
      }

      // Handle user-initiated remediation lifecycle events. Derive the wire
      // action (e.g. 'remediation_requires_reboot' → 'requires-reboot') and route
      // to handleRemediationEvent so the wire event is resource 'remediation'.
      // Must NOT fall through to super.handleEvent (that would emit resource 'vms').
      if (action.startsWith('remediation_')) {
        if (!vmData?.id) {
          logger.warn(`⚠️ VM id missing for remediation event: ${action}`)
          return
        }
        const wireAction = action.replace('remediation_', '').replace(/_/g, '-')
        await this.handleRemediationEvent(vmData.id, wireAction, (vmData as any).result ?? {}, triggeredBy)
        return
      }

      // Delegate all other events to base class (handles delete, create, update, etc.)
      await super.handleEvent(action, vmData, triggeredBy)
    } catch (error) {
      logger.error(`❌ Error handling VM event ${action}:`, error)
      throw error
    }
  }

  // ============================================
  // Consolidated auto-check event handler
  // Replaces 3 separate handlers: issue_detected, remediation_available, remediation_completed
  // ============================================

  private async handleAutoCheckEvent (action: EventAction, vmData: EventData, triggeredBy?: string): Promise<void> {
    const vm = await this.fetchResourceData(vmData)
    if (!vm) {
      logger.warn(`⚠️ VM not found for auto-check event: ${vmData?.id}`)
      return
    }

    const targetUsers = await this.getTargetUsers(vm, action)
    const eventName = action.replace('autocheck_', '').replace(/_/g, '-')
    const data = vmData as Record<string, unknown>

    // Build payload data - action-specific field mapping preserves original contract
    let payloadData: any = {
      vmId: vm.id,
      vmName: vm.name,
      timestamp: new Date().toISOString(),
      triggeredBy
    }

    if (action === 'autocheck_issue_detected') {
      // Original: issueType: issueData.checkType, severity, description, details
      payloadData = {
        ...payloadData,
        issueType: data.checkType,
        severity: data.severity,
        description: data.description,
        details: data.details
      }
    } else if (action === 'autocheck_remediation_available') {
      // Original: checkType, remediationType, description, isAutomatic, estimatedTime, details
      payloadData = {
        ...payloadData,
        checkType: data.checkType,
        remediationType: data.remediationType,
        description: data.description,
        isAutomatic: data.isAutomatic,
        estimatedTime: data.estimatedTime,
        details: data.details
      }
    } else if (action === 'autocheck_remediation_completed') {
      // Original: checkType, remediationType, success, description, executionTime, details, error
      payloadData = {
        ...payloadData,
        checkType: data.checkType,
        remediationType: data.remediationType,
        success: data.success,
        description: data.description,
        executionTime: data.executionTime,
        details: data.details,
        error: data.error
      }
    }

    const payload: EventPayload = { status: 'success', data: payloadData }

    this.sendToTargetUsers(targetUsers, 'autocheck', eventName, payload)
    logger.info(`✅ Auto-check event sent to ${targetUsers.length} users: ${action}`)
  }

  // ============================================
  // Public convenience handlers (backward compatible API)
  // Each delegates to handleEvent which routes appropriately
  // ============================================

  async handleVmCreated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.handleEvent('create', vmData, triggeredBy)
  }

  async handleVmUpdated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.handleEvent('update', vmData, triggeredBy)
  }

  async handleVmDeleted (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.handleEvent('delete', vmData, triggeredBy)
  }

  async handleVmPowerStateChange (vmData: EventData, action: 'power_on' | 'power_off' | 'suspend', triggeredBy?: string): Promise<void> {
    await this.handleEvent(action, vmData, triggeredBy)
  }

  // ============================================
  // Legacy auto-check handlers (backward compatible API)
  // Each builds specific data shape then delegates to handleAutoCheckEvent
  // ============================================

  async handleAutoCheckIssueDetected (
    vmId: string,
    issueData: {
      checkType: string
      severity: 'warning' | 'critical'
      description: string
      details: unknown
    },
    triggeredBy?: string
  ): Promise<void> {
    await this.handleAutoCheckEvent('autocheck_issue_detected', {
      id: vmId,
      ...issueData
    }, triggeredBy)
  }

  async handleAutoCheckRemediationAvailable (
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
    await this.handleAutoCheckEvent('autocheck_remediation_available', {
      id: vmId,
      ...remediationData
    }, triggeredBy)
  }

  async handleAutoCheckRemediationCompleted (
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
    await this.handleAutoCheckEvent('autocheck_remediation_completed', {
      id: vmId,
      ...completionData
    }, triggeredBy)
  }

  // ============================================
  // Health check specific event handlers
  // These use a different payload structure so kept separate
  // ============================================

  async handleHealthCheckEvent (
    vmId: string,
    checkType: string,
    result: unknown,
    triggeredBy?: string
  ): Promise<void> {
    try {
      logger.info(`🏥 Handling health check event: ${checkType} for VM ${vmId}`, { triggeredBy })

      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        logger.warn(`⚠️ VM not found for health check event: ${vmId}`)
        return
      }

      const targetUsers = await this.getTargetUsers(vm, 'health_check')

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

      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'health_checks', checkType, payload)
      }

      logger.info(`✅ Health check event sent to ${targetUsers.length} users: ${checkType}`)
    } catch (error) {
      logger.error(`❌ Error handling health check event ${checkType}:`, error)
      throw error
    }
  }

  async handleHealthStatusChange (
    vmId: string,
    newStatus: 'healthy' | 'warning' | 'critical',
    checkResults: unknown[],
    triggeredBy?: string
  ): Promise<void> {
    try {
      logger.info(`🚨 Health status change for VM ${vmId}: ${newStatus}`, { triggeredBy })

      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        logger.warn(`⚠️ VM not found for health status change: ${vmId}`)
        return
      }

      const targetUsers = await this.getTargetUsers(vm, 'health_status_change')

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

      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'health_status', 'change', payload)
      }

      logger.info(`✅ Health status change event sent to ${targetUsers.length} users`)
    } catch (error) {
      logger.error('❌ Error handling health status change:', error)
      throw error
    }
  }

  async handleRemediationEvent (
    vmId: string,
    actionType: string,
    result: unknown,
    triggeredBy?: string
  ): Promise<void> {
    try {
      logger.info(`🔧 Handling remediation event: ${actionType} for VM ${vmId}`, { triggeredBy })

      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          user: { select: { id: true } },
          department: { select: { id: true } }
        }
      })

      if (!vm) {
        logger.warn(`⚠️ VM not found for remediation event: ${vmId}`)
        return
      }

      const targetUsers = await this.getTargetUsers(vm, 'remediation')

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

      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'remediation', actionType, payload)
      }

      logger.info(`✅ Remediation event sent to ${targetUsers.length} users: ${actionType}`)
    } catch (error) {
      logger.error(`❌ Error handling remediation event ${actionType}:`, error)
      throw error
    }
  }
}
