import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'

// Event action types
export type EventAction = 'create' | 'update' | 'delete' | 'power_on' | 'power_off' | 'suspend' | 'resume'

// Event payload interface
export interface EventPayload {
  status: 'success' | 'error'
  error?: string
  data?: any
}

// Base interface for resource event managers
export interface ResourceEventManager {
  handleEvent(action: EventAction, data: any, triggeredBy?: string): Promise<void>
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
    data: any,
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
  async vmCreated (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'create', vmData, triggeredBy)
  }

  async vmUpdated (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'update', vmData, triggeredBy)
  }

  async vmDeleted (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'delete', vmData, triggeredBy)
  }

  async vmPowerOn (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_on', vmData, triggeredBy)
  }

  async vmPowerOff (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_off', vmData, triggeredBy)
  }

  async vmSuspend (vmData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'suspend', vmData, triggeredBy)
  }

  // User Events
  async userCreated (userData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'create', userData, triggeredBy)
  }

  async userUpdated (userData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'update', userData, triggeredBy)
  }

  async userDeleted (userData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'delete', userData, triggeredBy)
  }

  // Department Events
  async departmentCreated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'create', deptData, triggeredBy)
  }

  async departmentUpdated (deptData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'update', deptData, triggeredBy)
  }

  async departmentDeleted (deptData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'delete', deptData, triggeredBy)
  }

  // Application Events
  async applicationCreated (appData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'create', appData, triggeredBy)
  }

  async applicationUpdated (appData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'update', appData, triggeredBy)
  }

  async applicationDeleted (appData: any, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'delete', appData, triggeredBy)
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
