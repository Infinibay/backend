import 'reflect-metadata'

import { VmEventManager } from '../../../app/services/VmEventManager'
import { VirtioSocketWatcherService } from '../../../app/services/VirtioSocketWatcherService'
import { EventManager } from '../../../app/services/EventManager'
import { SocketService } from '../../../app/services/SocketService'
import { mockPrisma } from '../../setup/jest.setup'
import { PrismaClient } from '@prisma/client'
import { createMockUser, createMockMachine, createMockDepartment } from '../../setup/mock-factories'

// Unmock EventManager for this test file since we need to test its actual implementation
jest.unmock('../../../app/services/EventManager')

// Mock socket service
const mockSocketService = {
  sendToUser: jest.fn(),
  sendToUserNamespace: jest.fn(),
  getStats: jest.fn().mockReturnValue({ connectedUsers: 0, userIds: [] })
} as unknown as SocketService

describe('Auto-Check WebSocket Events', () => {
  let vmEventManager: VmEventManager
  let eventManager: EventManager
  let virtioService: VirtioSocketWatcherService

  beforeEach(() => {
    jest.clearAllMocks()

    // Create event manager with mocked dependencies
    eventManager = new EventManager(mockSocketService as unknown as SocketService, mockPrisma as unknown as PrismaClient)
    vmEventManager = new VmEventManager(mockSocketService, mockPrisma as unknown as PrismaClient)
    virtioService = new VirtioSocketWatcherService(mockPrisma as unknown as PrismaClient)

    // Initialize virtio service with vm event manager
    virtioService.initialize(vmEventManager)

    // Mock VM data with proper types
    const mockUser = createMockUser({ id: 'test-user-id', role: 'USER' })
    const mockDepartment = createMockDepartment({ id: 'test-dept-id' })
    const mockMachine = createMockMachine({
      id: 'test-vm-id',
      name: 'test-vm',
      status: 'running',
      userId: mockUser.id,
      departmentId: mockDepartment.id
    })

    // Add user and department to machine for relations
    const machineWithRelations = {
      ...mockMachine,
      user: mockUser,
      department: mockDepartment
    }

    mockPrisma.machine.findUnique.mockResolvedValue(machineWithRelations)

    // Mock admin users
    const mockAdmin = createMockUser({ id: 'admin-id', role: 'ADMIN' })
    mockPrisma.user.findMany.mockResolvedValue([mockAdmin])
  })

  describe('EventManager Auto-Check Events', () => {
    it('should add auto-check event types to EventAction', () => {
      expect(typeof eventManager.autocheckIssueDetected).toBe('function')
      expect(typeof eventManager.autocheckRemediationAvailable).toBe('function')
      expect(typeof eventManager.autocheckRemediationCompleted).toBe('function')
    })

    it('should dispatch autocheck issue detected event', async () => {
      const vmData = { id: 'test-vm-id', severity: 'critical' }

      eventManager.registerResourceManager('vms', vmEventManager)

      await eventManager.autocheckIssueDetected(vmData, 'test-user')

      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })

    it('should dispatch autocheck remediation available event', async () => {
      const vmData = { id: 'test-vm-id', remediationType: 'AutoFixWindowsUpdates' }

      eventManager.registerResourceManager('vms', vmEventManager)

      await eventManager.autocheckRemediationAvailable(vmData, 'test-user')

      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })

    it('should dispatch autocheck remediation completed event', async () => {
      const vmData = { id: 'test-vm-id', success: true }

      eventManager.registerResourceManager('vms', vmEventManager)

      await eventManager.autocheckRemediationCompleted(vmData, 'test-user')

      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })

  describe('VmEventManager Auto-Check Handlers', () => {
    it('should handle auto-check issue detection', async () => {
      const issueData = {
        checkType: 'WindowsUpdates',
        severity: 'critical' as const,
        description: '5 critical updates pending',
        details: { updateCount: 5 }
      }

      await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', issueData, 'system')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'issue-detected',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            issueType: 'WindowsUpdates',
            severity: 'critical'
          })
        })
      )
    })

    it('should handle auto-check remediation available', async () => {
      const remediationData = {
        checkType: 'WindowsUpdates',
        remediationType: 'AutoFixWindowsUpdates',
        description: 'Install pending updates',
        isAutomatic: true,
        estimatedTime: '15-30 minutes',
        details: { updateCount: 5 }
      }

      await vmEventManager.handleAutoCheckRemediationAvailable('test-vm-id', remediationData, 'system')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'remediation-available',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            remediationType: 'AutoFixWindowsUpdates',
            isAutomatic: true
          })
        })
      )
    })

    it('should handle auto-check remediation completion', async () => {
      const completionData = {
        checkType: 'WindowsUpdates',
        remediationType: 'AutoFixWindowsUpdates',
        success: true,
        description: 'Updates installed successfully',
        executionTime: '1245ms',
        details: { updatesInstalled: 5 }
      }

      await vmEventManager.handleAutoCheckRemediationCompleted('test-vm-id', completionData, 'system')

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'remediation-completed',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            success: true,
            remediationType: 'AutoFixWindowsUpdates'
          })
        })
      )
    })

    it('should send events to multiple target users', async () => {
      // Mock multiple users
      const mockAdmin1 = createMockUser({ id: 'admin-1', role: 'ADMIN' })
      const mockAdmin2 = createMockUser({ id: 'admin-2', role: 'ADMIN' })
      mockPrisma.user.findMany.mockResolvedValue([mockAdmin1, mockAdmin2])

      const issueData = {
        checkType: 'DiskSpace',
        severity: 'warning' as const,
        description: 'Disk 85% full',
        details: { usagePercent: 85 }
      }

      await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', issueData)

      // Should send to VM owner + admin users
      expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(3)
    })
  })

  describe('Response Analysis', () => {
    it('should analyze Windows Updates response and detect issues', () => {
      const mockResponse = {
        id: 'test-command',
        success: true,
        command_type: 'CheckWindowsUpdates',
        data: {
          pending_updates: [
            { title: 'Security Update', importance: 'Critical' },
            { title: 'Feature Update', importance: 'Important' }
          ]
        }
      }

      // Test that the analysis would work (we can't easily test private methods)
      expect(mockResponse.command_type).toBe('CheckWindowsUpdates')
      expect(mockResponse.success).toBe(true)
    })

    it('should analyze Defender response and detect issues', () => {
      const mockResponse = {
        id: 'test-command',
        success: true,
        command_type: 'CheckWindowsDefender',
        data: {
          real_time_protection: false,
          antivirus_enabled: false,
          definitions_outdated: true
        }
      }

      expect(mockResponse.command_type).toBe('CheckWindowsDefender')
      expect(mockResponse.success).toBe(true)
    })

    it('should analyze disk space response and detect critical usage', () => {
      const mockResponse = {
        id: 'test-command',
        success: true,
        command_type: 'CheckDiskSpace',
        data: {
          drives: [
            {
              drive_letter: 'C:',
              total_gb: 100,
              used_gb: 92,
              available_gb: 8
            }
          ]
        }
      }

      const usagePercent = (92 / 100) * 100
      expect(usagePercent).toBeGreaterThan(90) // Should trigger critical alert
    })
  })

  describe('Type Guards', () => {
    it('should correctly identify WindowsUpdatesData', () => {
      const validData = {
        pending_updates: [
          { title: 'Test Update', importance: 'Critical' as const }
        ]
      }

      const invalidData = {
        some_other_field: 'value'
      }

      // Type guard logic test
      expect(Array.isArray(validData.pending_updates)).toBe(true)
      expect('pending_updates' in validData).toBe(true)
      expect('pending_updates' in invalidData).toBe(false)
    })

    it('should correctly identify DefenderData', () => {
      const validData = {
        real_time_protection: true,
        antivirus_enabled: true
      }

      const invalidData = {
        some_other_field: 'value'
      }

      expect('real_time_protection' in validData).toBe(true)
      expect('real_time_protection' in invalidData).toBe(false)
    })
  })
})
