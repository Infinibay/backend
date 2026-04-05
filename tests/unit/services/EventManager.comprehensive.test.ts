import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { PrismaClient } from '@prisma/client'

// Unmock EventManager so we test the real implementation
jest.unmock('@services/events/EventManager')

import { EventManager, ResourceEventManager, EventAction, EventData } from '../../../app/services/events/EventManager'
import { SocketService } from '../../../app/services/events/SocketService'

// Mock SocketService
class MockSocketService {
  public sendToUser = jest.fn<() => void>()
}

describe('EventManager', () => {
  let eventManager: EventManager
  let mockSocketService: MockSocketService
  let mockPrisma: PrismaClient

  beforeEach(() => {
    jest.clearAllMocks()
    mockSocketService = new MockSocketService() as unknown as MockSocketService
    mockPrisma = {} as unknown as PrismaClient
    eventManager = new EventManager(mockSocketService as unknown as SocketService, mockPrisma)
  })

  describe('constructor', () => {
    it('should initialize with socket service and prisma', () => {
      expect(eventManager).toBeDefined()
      expect((eventManager as any).socketService).toBe(mockSocketService)
      expect((eventManager as any).prisma).toBe(mockPrisma)
    })
  })

  describe('registerResourceManager', () => {
    it('should register a new resource manager', () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>()
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })

    it('should overwrite existing manager for same resource', () => {
      const manager1 = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>() } as ResourceEventManager
      const manager2 = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>() } as ResourceEventManager

      eventManager.registerResourceManager('vms', manager1)
      eventManager.registerResourceManager('vms', manager2)

      const registeredManager = (eventManager as any).resourceManagers.get('vms')
      expect(registeredManager).toBe(manager2)
    })
  })

  describe('dispatchEvent', () => {
    const mockData: EventData = {
      id: 'vm-123',
      name: 'test-vm',
      status: 'running'
    }

    it('should dispatch event to registered manager', async () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined)
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      await eventManager.dispatchEvent('vms', 'create', mockData, 'user-123')

      expect(mockManager.handleEvent).toHaveBeenCalledWith(
        'create',
        mockData,
        'user-123'
      )
    })

    it('should log warning when no manager registered', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await eventManager.dispatchEvent('vms', 'create', mockData, 'user-123')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No event manager found for resource: vms')
      )
      consoleSpy.mockRestore()
    })

    it('should send error event when dispatch fails', async () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockRejectedValue(
          new Error('Dispatch failed')
        )
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      await eventManager.dispatchEvent('vms', 'create', mockData, 'user-123')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'user-123',
        'vms',
        'create',
        expect.objectContaining({
          status: 'error',
          error: 'Dispatch failed'
        })
      )
    })

    it('should handle missing triggeredBy parameter', async () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined)
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      await eventManager.dispatchEvent('vms', 'create', mockData, undefined)

      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })
  })

  describe('VM Event Helpers', () => {
    beforeEach(() => {
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
      eventManager.registerResourceManager('vms', mockManager as any)
    })

    describe('vmCreated', () => {
      it('should dispatch create event for VM', async () => {
        const mockManager = (eventManager as any).resourceManagers.get('vms') as ResourceEventManager
        const vmData: EventData = { id: 'vm-123', name: 'test-vm' }

        await eventManager.vmCreated(vmData)

        expect(mockManager.handleEvent).toHaveBeenCalledWith('create', vmData, undefined)
      })
    })

    describe('vmUpdated', () => {
      it('should dispatch update event for VM', async () => {
        const mockManager = (eventManager as any).resourceManagers.get('vms') as ResourceEventManager
        const vmData: EventData = { id: 'vm-123', name: 'updated-vm' }

        await eventManager.vmUpdated(vmData)

        expect(mockManager.handleEvent).toHaveBeenCalledWith('update', vmData, undefined)
      })
    })

    describe('vmDeleted', () => {
      it('should dispatch delete event for VM', async () => {
        const mockManager = (eventManager as any).resourceManagers.get('vms') as ResourceEventManager
        const vmData: EventData = { id: 'vm-123', name: 'deleted-vm' }

        await eventManager.vmDeleted(vmData)

        expect(mockManager.handleEvent).toHaveBeenCalledWith('delete', vmData, undefined)
      })
    })

    describe('vmPowerOn', () => {
      it('should dispatch power_on event for VM', async () => {
        const mockManager = (eventManager as any).resourceManagers.get('vms') as ResourceEventManager
        const vmData: EventData = { id: 'vm-123', status: 'running' }

        await eventManager.vmPowerOn(vmData)

        expect(mockManager.handleEvent).toHaveBeenCalledWith('power_on', vmData, undefined)
      })
    })

    describe('vmPowerOff', () => {
      it('should dispatch power_off event for VM', async () => {
        const mockManager = (eventManager as any).resourceManagers.get('vms') as ResourceEventManager
        const vmData: EventData = { id: 'vm-123', status: 'stopped' }

        await eventManager.vmPowerOff(vmData)

        expect(mockManager.handleEvent).toHaveBeenCalledWith('power_off', vmData, undefined)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle empty event data', async () => {
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
      eventManager.registerResourceManager('vms', mockManager as any)

      await expect(eventManager.dispatchEvent('vms', 'create', {}, 'user-123')).resolves.toBeUndefined()
    })

    it('should handle null event data', async () => {
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
      eventManager.registerResourceManager('vms', mockManager as any)

      await expect(eventManager.dispatchEvent('vms', 'create', null as any, 'user-123')).resolves.toBeUndefined()
    })

    it('should handle exception in manager handleEvent', async () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockRejectedValue(new Error('Test error'))
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'user-123',
        'vms',
        'create',
        expect.objectContaining({
          status: 'error',
          error: 'Test error'
        })
      )
    })

    it('should handle non-Error exceptions', async () => {
      const mockManager = {
        handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockRejectedValue('String error')
      } as ResourceEventManager

      eventManager.registerResourceManager('vms', mockManager)

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      // Non-Error exceptions result in 'Unknown error occurred' message
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'user-123',
        'vms',
        'create',
        expect.objectContaining({
          status: 'error',
          error: 'Unknown error occurred'
        })
      )
    })
  })

  describe('console logging', () => {
    it('should log event dispatching', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
      eventManager.registerResourceManager('vms', mockManager as any)

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dispatching event'),
        expect.objectContaining({
          dataId: 'vm-123',
          triggeredBy: 'user-123'
        })
      )

      consoleSpy.mockRestore()
    })

    it('should log successful dispatch', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
      eventManager.registerResourceManager('vms', mockManager as any)

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Event dispatched successfully')
      )

      consoleSpy.mockRestore()
    })

    it('should log dispatch errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockRejectedValue(new Error('Test error')) }
      eventManager.registerResourceManager('vms', mockManager as any)

      await eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error dispatching event'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('event actions', () => {
    it('should support all defined event actions', async () => {
      const actions: EventAction[] = [
        'create', 'update', 'delete', 'power_on', 'power_off',
        'suspend', 'resume', 'crash', 'registered', 'removed',
        'validated', 'progress', 'status_changed', 'health_check',
        'health_status_change', 'remediation', 'autocheck_issue_detected',
        'autocheck_remediation_available', 'autocheck_remediation_completed',
        'round_started', 'round_completed', 'round_failed',
        'task_started', 'task_completed', 'task_failed',
        'maintenance_completed', 'maintenance_failed',
        'started', 'completed', 'failed'
      ]

      actions.forEach(action => {
        const mockManager = { handleEvent: jest.fn<ResourceEventManager['handleEvent']>().mockResolvedValue(undefined) }
        eventManager.registerResourceManager('vms', mockManager as any)
        eventManager.dispatchEvent('vms', action, { id: 'vm-123' }, 'user-123')
        
        // Reset for next iteration
        const resourceManagers = (eventManager as any).resourceManagers
        resourceManagers.clear()
      })
    })
  })
})
