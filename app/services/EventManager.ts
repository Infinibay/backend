import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'

// Event action types
export type EventAction = 'create' | 'update' | 'delete' | 'power_on' | 'power_off' | 'suspend' | 'resume' | 'crash' | 'registered' | 'removed' | 'validated' | 'progress' | 'status_changed' | 'health_check' | 'health_status_change' | 'remediation' | 'autocheck_issue_detected' | 'autocheck_remediation_available' | 'autocheck_remediation_completed' | 'round_started' | 'round_completed' | 'round_failed' | 'task_started' | 'task_completed' | 'task_failed' | 'maintenance_completed' | 'maintenance_failed' | 'started' | 'completed' | 'failed'

// Event data types
export interface EventData {
  id?: string
  [key: string]: unknown
}

// Event payload interface
export interface EventPayload {
  status: 'success' | 'error'
  error?: string
  data?: unknown
}

// Base interface for resource event managers
export interface ResourceEventManager {
  handleEvent(action: EventAction, data: EventData, triggeredBy?: string): Promise<void>
}

// Main EventManager class that coordinates all real-time events
export class EventManager {
  private resourceManagers: Map<string, ResourceEventManager> = new Map()
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Register a resource-specific event manager
  registerResourceManager (resource: string, manager: ResourceEventManager): void {
    this.resourceManagers.set(resource, manager)
    console.log(`📋 Registered event manager for resource: ${resource}`)
  }

  // Main event dispatch method
  async dispatchEvent (
    resource: string,
    action: EventAction,
    data: EventData,
    triggeredBy?: string
  ): Promise<void> {
    try {
      console.log(`🎯 Dispatching event: ${resource}:${action}`, {
        dataId: data?.id,
        triggeredBy
      })

      // Get the appropriate resource manager
      const manager = this.resourceManagers.get(resource)
      if (!manager) {
        console.warn(`⚠️ No event manager found for resource: ${resource}`)
        return
      }

      // Let the resource manager handle the event
      await manager.handleEvent(action, data, triggeredBy)

      console.log(`✅ Event dispatched successfully: ${resource}:${action}`)
    } catch (error) {
      console.error(`❌ Error dispatching event ${resource}:${action}:`, error)

      // Send error event to triggering user if available
      if (triggeredBy) {
        this.socketService.sendToUser(triggeredBy, resource, action, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        })
      }
    }
  }

  // Convenience methods for common events

  // VM Events
  async vmCreated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'create', vmData, triggeredBy)
  }

  async vmUpdated (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'update', vmData, triggeredBy)
  }

  async vmDeleted (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'delete', vmData, triggeredBy)
  }

  async vmPowerOn (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_on', vmData, triggeredBy)
  }

  async vmPowerOff (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_off', vmData, triggeredBy)
  }

  async vmSuspend (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'suspend', vmData, triggeredBy)
  }

  // User Events
  async userCreated (userData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'create', userData, triggeredBy)
  }

  async userUpdated (userData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'update', userData, triggeredBy)
  }

  async userDeleted (userData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'delete', userData, triggeredBy)
  }

  // Department Events
  async departmentCreated (deptData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'create', deptData, triggeredBy)
  }

  async departmentUpdated (deptData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'update', deptData, triggeredBy)
  }

  async departmentDeleted (deptData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'delete', deptData, triggeredBy)
  }

  // Application Events
  async applicationCreated (appData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'create', appData, triggeredBy)
  }

  async applicationUpdated (appData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'update', appData, triggeredBy)
  }

  async applicationDeleted (appData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'delete', appData, triggeredBy)
  }

  // Auto-check Events
  async autocheckIssueDetected (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'autocheck_issue_detected', vmData, triggeredBy)
  }

  async autocheckRemediationAvailable (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'autocheck_remediation_available', vmData, triggeredBy)
  }

  async autocheckRemediationCompleted (vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'autocheck_remediation_completed', vmData, triggeredBy)
  }

  /**
   * Emit CRUD event - compatibility method for infinization integration.
   * Maps to dispatchEvent with proper data structure.
   *
   * @param resource - Resource type (e.g., 'machines', 'vms')
   * @param action - Action type (e.g., 'create', 'power_on', 'crash')
   * @param id - Entity ID
   * @param data - Additional event data
   */
  emitCRUD (resource: string, action: string, id: string, data?: unknown): void {
    // Map 'machines' to 'vms' for consistency with existing event handlers
    const mappedResource = resource === 'machines' ? 'vms' : resource

    // Build event data with id and spread additional data
    const eventData: EventData = {
      id,
      ...(typeof data === 'object' && data !== null ? data as Record<string, unknown> : {})
    }

    // Fire and forget - infinization doesn't await this
    this.dispatchEvent(mappedResource, action as EventAction, eventData).catch(err => {
      console.error(`Error in emitCRUD(${resource}, ${action}, ${id}):`, err)
    })
  }

  // Get statistics
  getStats (): {
    registeredManagers: string[]
    socketStats: { connectedUsers: number; userIds: string[] }
    } {
    return {
      registeredManagers: Array.from(this.resourceManagers.keys()),
      socketStats: this.socketService.getStats()
    }
  }
}

// Singleton instance
let eventManager: EventManager | null = null

export const createEventManager = (socketService: SocketService, prisma: PrismaClient): EventManager => {
  if (!eventManager) {
    eventManager = new EventManager(socketService, prisma)
  }
  return eventManager
}

export const getEventManager = (): EventManager => {
  if (!eventManager) {
    throw new Error('EventManager not initialized. Call createEventManager first.')
  }
  return eventManager
}
