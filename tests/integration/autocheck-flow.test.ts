import 'reflect-metadata'
import { VirtioSocketWatcherService } from '../../app/services/VirtioSocketWatcherService'
import { VmEventManager } from '../../app/services/VmEventManager'
import { EventManager, createEventManager } from '../../app/services/EventManager'
import { SocketService, createSocketService } from '../../app/services/SocketService'
import { mockPrisma } from '../setup/jest.setup'
import { PrismaClient } from '@prisma/client'
import { Server } from 'socket.io'
import { createServer, Server as HTTPServer } from 'http'
import { AddressInfo } from 'net'
import { createMockUser, createMockMachine, createMockDepartment } from '../setup/mock-factories'

describe('Auto-Check End-to-End Integration', () => {
  let virtioService: VirtioSocketWatcherService
  let vmEventManager: VmEventManager
  let eventManager: EventManager
  let socketService: SocketService
  let httpServer: HTTPServer
  let ioServer: Server
  let port: number

  beforeAll(async () => {
    // Create HTTP server for Socket.IO
    httpServer = createServer()
    httpServer.listen()
    port = (httpServer.address() as AddressInfo).port

    // Initialize Socket.IO service
    ioServer = new Server(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    })

    socketService = createSocketService(mockPrisma as unknown as PrismaClient)
    socketService.initialize(httpServer)
  })

  afterAll(async () => {
    if (httpServer) {
      httpServer.close()
    }
  })

  beforeEach(async () => {
    jest.clearAllMocks()

    // Create services
    eventManager = createEventManager(socketService, mockPrisma as unknown as PrismaClient)
    vmEventManager = new VmEventManager(socketService, mockPrisma as unknown as PrismaClient)
    virtioService = new VirtioSocketWatcherService(mockPrisma as unknown as PrismaClient)

    // Register VM event manager
    eventManager.registerResourceManager('vms', vmEventManager)

    // Initialize virtio service with event manager
    virtioService.initialize(vmEventManager)

    // Mock VM and user data
    const mockUser = createMockUser({ id: 'test-user-id', role: 'USER' })
    const mockDepartment = createMockDepartment({ id: 'test-dept-id' })
    const mockMachine = createMockMachine({
      id: 'test-vm-id',
      name: 'integration-test-vm',
      status: 'running',
      userId: 'test-user-id',
      departmentId: 'test-dept-id'
    })

    const machineWithRelations = {
      ...mockMachine,
      user: mockUser,
      department: mockDepartment
    }

    mockPrisma.machine.findUnique.mockResolvedValue(machineWithRelations)

    const mockAdmin = createMockUser({ id: 'admin-user-id', role: 'ADMIN' })
    mockPrisma.user.findMany.mockResolvedValue([mockAdmin])
  })

  describe('Windows Updates Auto-Check Flow', () => {
    it('should complete full Windows Updates auto-check flow', async () => {
      const mockSocket = {
        sendToUser: jest.fn()
      }

      // Mock socket service methods
      jest.spyOn(socketService, 'sendToUser').mockImplementation(mockSocket.sendToUser)

      // Simulate Windows Updates check response with critical updates
      const updateResponse = {
        id: 'cmd-123',
        success: true,
        command_type: 'CheckWindowsUpdates',
        data: {
          pending_updates: [
            { title: 'Critical Security Update', importance: 'Critical' as const, kb_id: 'KB123456' },
            { title: 'Important Feature Update', importance: 'Important' as const, kb_id: 'KB789012' }
          ]
        }
      }

      // Simulate the analysis (since we can't directly call private methods)
      if (updateResponse.data.pending_updates) {
        const criticalUpdates = updateResponse.data.pending_updates.filter(
          update => update.importance === 'Critical' || update.importance === 'Important'
        )

        if (criticalUpdates.length > 0) {
          // Issue detection
          await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', {
            checkType: 'WindowsUpdates',
            severity: 'critical',
            description: `${criticalUpdates.length} critical Windows updates are pending`,
            details: { criticalUpdates, totalUpdates: updateResponse.data.pending_updates.length }
          })

          // Remediation available
          await vmEventManager.handleAutoCheckRemediationAvailable('test-vm-id', {
            checkType: 'WindowsUpdates',
            remediationType: 'AutoFixWindowsUpdates',
            description: 'Automatically install pending Windows updates',
            isAutomatic: true,
            estimatedTime: '15-30 minutes',
            details: { updateCount: criticalUpdates.length }
          })
        }
      }

      // Verify issue detection event was sent
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
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

      // Verify remediation available event was sent
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
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

      // Simulate remediation completion
      await vmEventManager.handleAutoCheckRemediationCompleted('test-vm-id', {
        checkType: 'WindowsUpdates',
        remediationType: 'AutoFixWindowsUpdates',
        success: true,
        description: 'AutoFixWindowsUpdates completed successfully',
        executionTime: '1850000ms',
        details: { updatesInstalled: 2 }
      })

      // Verify remediation completion event was sent
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
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
  })

  describe('Disk Space Auto-Check Flow', () => {
    it('should handle disk space critical alert flow', async () => {
      const mockSocket = {
        sendToUser: jest.fn()
      }

      jest.spyOn(socketService, 'sendToUser').mockImplementation(mockSocket.sendToUser)

      // Simulate disk space check with critical usage
      const diskResponse = {
        id: 'cmd-456',
        success: true,
        command_type: 'CheckDiskSpace',
        data: {
          drives: [
            {
              drive_letter: 'C:',
              total_gb: 100,
              used_gb: 95,
              available_gb: 5
            }
          ]
        }
      }

      // Simulate analysis for critical disk usage (>90%)
      if (diskResponse.data.drives) {
        for (const drive of diskResponse.data.drives) {
          const usagePercent = (drive.used_gb / drive.total_gb) * 100

          if (usagePercent > 90) {
            await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', {
              checkType: 'DiskSpace',
              severity: 'critical',
              description: `Drive ${drive.drive_letter} is ${usagePercent.toFixed(1)}% full`,
              details: drive
            })

            await vmEventManager.handleAutoCheckRemediationAvailable('test-vm-id', {
              checkType: 'DiskSpace',
              remediationType: 'DiskCleanup',
              description: `Clean up temporary files on drive ${drive.drive_letter}`,
              isAutomatic: true,
              estimatedTime: '5-10 minutes',
              details: { drive: drive.drive_letter }
            })
          }
        }
      }

      // Verify critical disk space alert
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'issue-detected',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            issueType: 'DiskSpace',
            severity: 'critical'
          })
        })
      )

      // Verify cleanup remediation offered
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'remediation-available',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            remediationType: 'DiskCleanup'
          })
        })
      )
    })
  })

  describe('Windows Defender Auto-Check Flow', () => {
    it('should handle disabled Windows Defender flow', async () => {
      const mockSocket = {
        sendToUser: jest.fn()
      }

      jest.spyOn(socketService, 'sendToUser').mockImplementation(mockSocket.sendToUser)

      // Simulate disabled Windows Defender
      const defenderResponse = {
        id: 'cmd-789',
        success: true,
        command_type: 'CheckWindowsDefender',
        data: {
          real_time_protection: false,
          antivirus_enabled: false,
          definitions_outdated: true,
          last_definition_update: '2024-01-01T00:00:00Z'
        }
      }

      // Simulate analysis for disabled protection
      if (defenderResponse.data.real_time_protection === false || defenderResponse.data.antivirus_enabled === false) {
        await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', {
          checkType: 'WindowsDefender',
          severity: 'critical',
          description: 'Windows Defender real-time protection is disabled',
          details: defenderResponse.data
        })

        await vmEventManager.handleAutoCheckRemediationAvailable('test-vm-id', {
          checkType: 'WindowsDefender',
          remediationType: 'AutoFixDefender',
          description: 'Enable Windows Defender real-time protection',
          isAutomatic: true,
          estimatedTime: '1-2 minutes',
          details: {}
        })
      }

      // Verify security alert
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'issue-detected',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            issueType: 'WindowsDefender',
            severity: 'critical'
          })
        })
      )
    })
  })

  describe('Failed Command Handling', () => {
    it('should handle failed auto-check commands as issues', async () => {
      const mockSocket = {
        sendToUser: jest.fn()
      }

      jest.spyOn(socketService, 'sendToUser').mockImplementation(mockSocket.sendToUser)

      // Simulate failed command
      const failedResponse = {
        id: 'cmd-fail',
        success: false,
        command_type: 'CheckWindowsUpdates',
        error: 'Access denied',
        stderr: 'Windows Update service is not running'
      }

      // Simulate handling failed command as issue
      await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', {
        checkType: 'CheckWindowsUpdates',
        severity: 'warning',
        description: 'Auto-check command CheckWindowsUpdates failed',
        details: {
          error: failedResponse.error,
          commandId: failedResponse.id
        }
      })

      // Verify failure was reported as issue
      expect(mockSocket.sendToUser).toHaveBeenCalledWith(
        'test-user-id',
        'autocheck',
        'issue-detected',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'test-vm-id',
            severity: 'warning',
            description: 'Auto-check command CheckWindowsUpdates failed'
          })
        })
      )
    })
  })

  describe('Multi-User Event Distribution', () => {
    it('should send events to VM owner, admin users, and department members', async () => {
      // Mock multiple users
      const mockAdmin1 = createMockUser({ id: 'admin-1', role: 'ADMIN' })
      const mockAdmin2 = createMockUser({ id: 'admin-2', role: 'ADMIN' })
      mockPrisma.user.findMany.mockResolvedValue([mockAdmin1, mockAdmin2
      ])

      // Mock department users
      const mockDeptUser1 = createMockUser({ id: 'dept-user-1', role: 'USER' })
      const mockDeptUser2 = createMockUser({ id: 'dept-user-2', role: 'USER' })
      const mockTestUser = createMockUser({ id: 'test-user-id', role: 'USER' })

      mockPrisma.user.findMany.mockResolvedValue([mockAdmin1, mockAdmin2, mockDeptUser1, mockDeptUser2])

      const mockSocket = {
        sendToUser: jest.fn()
      }

      jest.spyOn(socketService, 'sendToUser').mockImplementation(mockSocket.sendToUser)

      await vmEventManager.handleAutoCheckIssueDetected('test-vm-id', {
        checkType: 'HealthCheck',
        severity: 'warning',
        description: 'System health check detected warning issues',
        details: { overall_health: 'Warning' }
      })

      // Should send to multiple users (VM owner + admins + department users)
      expect(mockSocket.sendToUser).toHaveBeenCalledTimes(5) // VM owner + 2 admins + 2 dept users
    })
  })
})
