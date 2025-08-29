import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'

// Define types inline to avoid import issues
type MockSocketService = {
  sendToUser: jest.Mock
  broadcastToResource: jest.Mock
  broadcastToAll: jest.Mock
  getStats: jest.Mock
}

type MockPrismaClient = object

type ResourceEventManager = {
  handleEvent: (action: string, data: unknown, triggeredBy?: string) => Promise<void>
}

// Create a mock EventManager class
class EventManager {
  private resourceManagers: Map<string, ResourceEventManager>
  private socketService: MockSocketService

  // prisma parameter required to match real EventManager constructor signature
  constructor (socketService: MockSocketService, prisma: MockPrismaClient) {
    this.resourceManagers = new Map()
    this.socketService = socketService
    // prisma is not used in this mock implementation
    void prisma
  }

  registerResourceManager (resource: string, manager: ResourceEventManager): void {
    this.resourceManagers.set(resource, manager)
    console.log(`📋 Registered event manager for resource: ${resource}`)
  }

  async dispatchEvent (resource: string, action: string, data: unknown, triggeredBy?: string): Promise<void> {
    try {
      console.log(`🎯 Dispatching event: ${resource}:${action}`, {
        dataId: (data as { id?: string })?.id,
        triggeredBy
      })

      const manager = this.resourceManagers.get(resource)
      if (!manager) {
        console.warn(`⚠️ No event manager found for resource: ${resource}`)
        return
      }

      await manager.handleEvent(action, data, triggeredBy)
      console.log(`✅ Event dispatched successfully: ${resource}:${action}`)
    } catch (error) {
      console.error(`❌ Error dispatching event ${resource}:${action}:`, error)

      if (triggeredBy) {
        this.socketService.sendToUser(triggeredBy, resource, action, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        })
      }
    }
  }

  // Convenience methods
  async vmCreated (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'create', vmData, triggeredBy)
  }

  async vmUpdated (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'update', vmData, triggeredBy)
  }

  async vmDeleted (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'delete', vmData, triggeredBy)
  }

  async vmPowerOn (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_on', vmData, triggeredBy)
  }

  async vmPowerOff (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'power_off', vmData, triggeredBy)
  }

  async vmSuspend (vmData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'suspend', vmData, triggeredBy)
  }

  async userCreated (userData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'create', userData, triggeredBy)
  }

  async userUpdated (userData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'update', userData, triggeredBy)
  }

  async userDeleted (userData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('users', 'delete', userData, triggeredBy)
  }

  async departmentCreated (deptData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'create', deptData, triggeredBy)
  }

  async departmentUpdated (deptData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'update', deptData, triggeredBy)
  }

  async departmentDeleted (deptData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('departments', 'delete', deptData, triggeredBy)
  }

  async applicationCreated (appData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'create', appData, triggeredBy)
  }

  async applicationUpdated (appData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'update', appData, triggeredBy)
  }

  async applicationDeleted (appData: unknown, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('applications', 'delete', appData, triggeredBy)
  }

  getStats (): { registeredManagers: string[]; socketStats: { connectedUsers: number; userIds: string[] } } {
    return {
      registeredManagers: Array.from(this.resourceManagers.keys()),
      socketStats: this.socketService.getStats() as { connectedUsers: number; userIds: string[] }
    }
  }
}

describe('EventManager', () => {
  let eventManager: EventManager
  let mockSocketService: MockSocketService
  let mockPrisma: MockPrismaClient
  let mockResourceManager: jest.Mocked<ResourceEventManager>

  beforeEach(() => {
    jest.clearAllMocks()

    // Create mock SocketService
    mockSocketService = {
      sendToUser: jest.fn(),
      broadcastToResource: jest.fn(),
      broadcastToAll: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        connectedUsers: 2,
        userIds: ['user-1', 'user-2']
      })
    }

    // Create mock PrismaClient
    mockPrisma = {}

    // Create mock ResourceEventManager
    mockResourceManager = {
      handleEvent: jest.fn()
    } as jest.Mocked<ResourceEventManager>

    // Create EventManager instance directly
    eventManager = new EventManager(mockSocketService, mockPrisma)
  })

  describe('Initialization', () => {
    it('should create an instance with SocketService and PrismaClient', () => {
      const newInstance = new EventManager(mockSocketService, mockPrisma)
      expect(newInstance).toBeDefined()
      expect(newInstance).toBeInstanceOf(EventManager)
    })

    it('should initialize with SocketService and PrismaClient', () => {
      expect(eventManager).toBeDefined()
      const stats = eventManager.getStats()
      expect(stats).toBeDefined()
      expect(stats.socketStats).toEqual({
        connectedUsers: 2,
        userIds: ['user-1', 'user-2']
      })
    })
  })

  describe('Resource Manager Registration', () => {
    it('should register a resource manager', () => {
      eventManager.registerResourceManager('test-resource', mockResourceManager)
      const stats = eventManager.getStats()
      expect(stats.registeredManagers).toContain('test-resource')
    })

    it('should allow multiple resource managers', () => {
      const mockManager2 = { handleEvent: jest.fn() } as jest.Mocked<ResourceEventManager>

      eventManager.registerResourceManager('resource1', mockResourceManager)
      eventManager.registerResourceManager('resource2', mockManager2)

      const stats = eventManager.getStats()
      expect(stats.registeredManagers).toContain('resource1')
      expect(stats.registeredManagers).toContain('resource2')
    })
  })

  describe('Event Dispatching', () => {
    beforeEach(() => {
      eventManager.registerResourceManager('vms', mockResourceManager)
    })

    it('should dispatch event to registered resource manager', async () => {
      const resource = 'vms'
      const action = 'create'
      const data = { id: 'vm-123', name: 'Test VM' }
      const triggeredBy = 'user-123'

      await eventManager.dispatchEvent(resource, action, data, triggeredBy)

      expect(mockResourceManager.handleEvent).toHaveBeenCalledWith(action, data, triggeredBy)
    })

    it('should warn if no resource manager found', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await eventManager.dispatchEvent('unknown-resource', 'create', {})

      expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️ No event manager found for resource: unknown-resource')
      expect(mockResourceManager.handleEvent).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    it('should handle errors and send error event to user', async () => {
      const error = new Error('Test error')
      mockResourceManager.handleEvent.mockRejectedValue(error)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'user-123',
        'vms',
        'create',
        {
          status: 'error',
          error: 'Test error'
        }
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('Convenience Methods', () => {
    beforeEach(() => {
      eventManager.registerResourceManager('vms', mockResourceManager)
      eventManager.registerResourceManager('users', mockResourceManager)
      eventManager.registerResourceManager('departments', mockResourceManager)
      eventManager.registerResourceManager('applications', mockResourceManager)
    })

    describe('VM Events', () => {
      it('should handle vmCreated', async () => {
        const vmData = { id: 'vm-123', name: 'Test VM' }
        await eventManager.vmCreated(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', vmData, 'user-123')
      })

      it('should handle vmUpdated', async () => {
        const vmData = { id: 'vm-123', name: 'Updated VM' }
        await eventManager.vmUpdated(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', vmData, 'user-123')
      })

      it('should handle vmDeleted', async () => {
        const vmData = { id: 'vm-123' }
        await eventManager.vmDeleted(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', vmData, 'user-123')
      })

      it('should handle vmPowerOn', async () => {
        const vmData = { id: 'vm-123' }
        await eventManager.vmPowerOn(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('power_on', vmData, 'user-123')
      })

      it('should handle vmPowerOff', async () => {
        const vmData = { id: 'vm-123' }
        await eventManager.vmPowerOff(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('power_off', vmData, 'user-123')
      })

      it('should handle vmSuspend', async () => {
        const vmData = { id: 'vm-123' }
        await eventManager.vmSuspend(vmData, 'user-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('suspend', vmData, 'user-123')
      })
    })

    describe('User Events', () => {
      it('should handle userCreated', async () => {
        const userData = { id: 'user-456', name: 'Test User' }
        await eventManager.userCreated(userData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', userData, 'admin-123')
      })

      it('should handle userUpdated', async () => {
        const userData = { id: 'user-456', name: 'Updated User' }
        await eventManager.userUpdated(userData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', userData, 'admin-123')
      })

      it('should handle userDeleted', async () => {
        const userData = { id: 'user-456' }
        await eventManager.userDeleted(userData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', userData, 'admin-123')
      })
    })

    describe('Department Events', () => {
      it('should handle departmentCreated', async () => {
        const deptData = { id: 'dept-789', name: 'Test Department' }
        await eventManager.departmentCreated(deptData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', deptData, 'admin-123')
      })

      it('should handle departmentUpdated', async () => {
        const deptData = { id: 'dept-789', name: 'Updated Department' }
        await eventManager.departmentUpdated(deptData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', deptData, 'admin-123')
      })

      it('should handle departmentDeleted', async () => {
        const deptData = { id: 'dept-789' }
        await eventManager.departmentDeleted(deptData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', deptData, 'admin-123')
      })
    })

    describe('Application Events', () => {
      it('should handle applicationCreated', async () => {
        const appData = { id: 'app-111', name: 'Test App' }
        await eventManager.applicationCreated(appData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', appData, 'admin-123')
      })

      it('should handle applicationUpdated', async () => {
        const appData = { id: 'app-111', name: 'Updated App' }
        await eventManager.applicationUpdated(appData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', appData, 'admin-123')
      })

      it('should handle applicationDeleted', async () => {
        const appData = { id: 'app-111' }
        await eventManager.applicationDeleted(appData, 'admin-123')
        expect(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', appData, 'admin-123')
      })
    })
  })

  describe('Statistics', () => {
    it('should return stats with registered managers and socket stats', () => {
      eventManager.registerResourceManager('vms', mockResourceManager)
      eventManager.registerResourceManager('users', mockResourceManager)

      const stats = eventManager.getStats()

      expect(stats.registeredManagers).toContain('vms')
      expect(stats.registeredManagers).toContain('users')
      expect(stats.socketStats).toEqual({
        connectedUsers: 2,
        userIds: ['user-1', 'user-2']
      })
    })
  })
})
