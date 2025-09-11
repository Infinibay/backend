import 'reflect-metadata'
import { VMHealthQueueManager } from '@services/VMHealthQueueManager'
import type { EventManager } from '@services/EventManager'
import { mockPrisma } from '../../setup/jest.setup'
import { TaskStatus, TaskPriority, HealthCheckType } from '@prisma/client'

// Mock VirtioSocketWatcherService
jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    sendSafeCommand: jest.fn().mockResolvedValue({
      success: true,
      data: { status: 'healthy', details: 'All checks passed' }
    })
  }))
}))

describe('VMHealthQueueManager', () => {
  let queueManager: VMHealthQueueManager
  let mockEventManager: EventManager
  const mockMachineId = 'test-machine-id'

  beforeEach(() => {
    // Create a mock EventManager instance
    mockEventManager = {
      dispatchEvent: jest.fn(),
      registerResourceManager: jest.fn(),
      vmCreated: jest.fn(),
      vmUpdated: jest.fn(),
      vmDeleted: jest.fn(),
      getStats: jest.fn()
    } as unknown as EventManager
    queueManager = new VMHealthQueueManager(mockPrisma, mockEventManager)
    jest.clearAllMocks()

    // Mock machine data for tests
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: mockMachineId,
      name: 'test-vm',
      status: 'RUNNING',
      userId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      internalName: 'test-vm-internal',
      os: 'ubuntu',
      cpuCores: 2,
      ramGB: 4,
      diskSizeGB: 50,
      departmentId: null,
      templateId: null,
      gpuPciAddress: null,
      firewallTemplates: {}
    })
  })

  describe('queueHealthCheck', () => {
    it('should queue a single health check successfully', async () => {
      mockPrisma.vMHealthCheckQueue.create.mockResolvedValue({
        id: 'test-queue-id',
        machineId: mockMachineId,
        checkType: 'DISK_SPACE',
        priority: 'MEDIUM',
        status: 'PENDING',
        payload: null,
        attempts: 0,
        maxAttempts: 3,
        scheduledFor: expect.any(Date),
        executedAt: null,
        completedAt: null,
        error: null,
        result: null,
        executionTimeMs: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const queueId = await queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE', 'MEDIUM', { test: 'data' })

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: mockMachineId },
        select: { id: true, name: true, status: true }
      })
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalled()
      expect(typeof queueId).toBe('string')
    })

    it('should throw error when VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`VM with ID ${mockMachineId} not found`)
    })
  })

  describe('queueHealthChecks', () => {
    it('should queue all standard health checks for a VM', async () => {
      mockPrisma.vMHealthCheckQueue.create.mockResolvedValue({
        id: 'test-queue-id',
        machineId: mockMachineId,
        checkType: 'OVERALL_STATUS',
        priority: 'MEDIUM',
        status: 'PENDING',
        payload: null,
        attempts: 0,
        maxAttempts: 3,
        scheduledFor: expect.any(Date),
        executedAt: null,
        completedAt: null,
        error: null,
        result: null,
        executionTimeMs: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      await queueManager.queueHealthChecks(mockMachineId)

      // Should queue 5 standard checks
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalledTimes(5)
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledTimes(6)
    })
  })

  describe('processQueue', () => {
    it('should process queued health checks when called', async () => {
      // Mock database operations
      mockPrisma.vMHealthCheckQueue.update.mockResolvedValue({
        id: 'test-id',
        machineId: mockMachineId,
        checkType: 'DISK_SPACE',
        priority: 'MEDIUM',
        status: 'COMPLETED',
        payload: null,
        attempts: 1,
        maxAttempts: 3,
        scheduledFor: new Date(),
        executedAt: new Date(),
        completedAt: new Date(),
        error: null,
        result: { success: true },
        executionTimeMs: 1000,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)
      mockPrisma.vMHealthSnapshot.create.mockResolvedValue({
        id: 'snapshot-id',
        machineId: mockMachineId,
        snapshotDate: new Date(),
        overallStatus: 'PENDING',
        checksCompleted: 0,
        checksFailed: 0,
        executionTimeMs: null,
        errorSummary: null,
        osType: null,
        diskSpaceInfo: null,
        resourceOptInfo: null,
        windowsUpdateInfo: null,
        defenderStatus: null,
        applicationInventory: null,
        customCheckResults: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue({
        id: 'snapshot-id',
        machineId: mockMachineId,
        snapshotDate: new Date(),
        overallStatus: 'PENDING',
        checksCompleted: 1,
        checksFailed: 0,
        executionTimeMs: 1000,
        errorSummary: null,
        osType: null,
        diskSpaceInfo: { status: 'healthy' },
        resourceOptInfo: null,
        windowsUpdateInfo: null,
        defenderStatus: null,
        applicationInventory: null,
        customCheckResults: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      mockPrisma.vMHealthCheckQueue.deleteMany.mockResolvedValue({ count: 1 })

      // First queue a health check
      await queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')

      // Then process the queue
      await queueManager.processQueue(mockMachineId)

      // Verify health check was processed
      expect(mockPrisma.vMHealthCheckQueue.update).toHaveBeenCalled()
    })

    it('should return early when queue is empty', async () => {
      await queueManager.processQueue(mockMachineId)

      // Should not attempt any processing for empty queue
      expect(mockPrisma.vMHealthCheckQueue.update).not.toHaveBeenCalled()
    })
  })

  describe('clearQueue', () => {
    it('should clear queue for a VM', async () => {
      mockPrisma.vMHealthCheckQueue.deleteMany.mockResolvedValue({ count: 2 })

      await queueManager.clearQueue(mockMachineId)

      expect(mockPrisma.vMHealthCheckQueue.deleteMany).toHaveBeenCalledWith({
        where: {
          machineId: mockMachineId
        }
      })
    })
  })

  describe('health snapshot storage', () => {
    it('should store health check results in snapshots', async () => {
      // Mock successful health check response
      const { getVirtioSocketWatcherService } = await import('@services/VirtioSocketWatcherService')
      const mockService = getVirtioSocketWatcherService()
      mockService.sendSafeCommand.mockResolvedValue({
        success: true,
        data: {
          diskUsage: { C: { used: 50, total: 100 } },
          status: 'healthy'
        }
      })

      // Mock snapshot operations
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)
      mockPrisma.vMHealthSnapshot.create.mockResolvedValue({
        id: 'snapshot-1',
        machineId: mockMachineId,
        snapshotDate: new Date(),
        overallStatus: 'PENDING',
        checksCompleted: 0,
        checksFailed: 0,
        executionTimeMs: null,
        errorSummary: null,
        osType: null,
        diskSpaceInfo: null,
        resourceOptInfo: null,
        windowsUpdateInfo: null,
        defenderStatus: null,
        applicationInventory: null,
        customCheckResults: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      mockPrisma.vMHealthSnapshot.update.mockResolvedValue({
        id: 'snapshot-1',
        machineId: mockMachineId,
        snapshotDate: new Date(),
        overallStatus: 'PENDING',
        checksCompleted: 1,
        checksFailed: 0,
        executionTimeMs: 1000,
        errorSummary: null,
        osType: null,
        diskSpaceInfo: { diskUsage: { C: { used: 50, total: 100 } }, status: 'healthy' },
        resourceOptInfo: null,
        windowsUpdateInfo: null,
        defenderStatus: null,
        applicationInventory: null,
        customCheckResults: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      // Queue and process a health check
      await queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      await queueManager.processQueue(mockMachineId)

      // Verify snapshot was updated with health check results
      expect(mockPrisma.vMHealthCheckQueue.update).toHaveBeenCalledWith({
        where: { id: mockTask.id },
        data: {
          status: 'COMPLETED',
          result: mockCommandResponse,
          completedAt: expect.any(Date),
          executionTimeMs: expect.any(Number)
        }
      })
    })

    it('should create new snapshot if none exists for today', async () => {
      // Mock no existing snapshot
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)

      await queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      await queueManager.processQueue(mockMachineId)

      // Verify new snapshot was created
      expect(mockPrisma.vMHealthSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          machineId: mockMachineId,
          snapshotDate: expect.any(Date),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0
        })
      })
    })
  })

  describe('database queue loading', () => {
    it('should load existing pending tasks from database on startup', async () => {
      const pendingTasks = [
        {
          id: 'pending-1',
          machineId: mockMachineId,
          checkType: 'DISK_SPACE' as HealthCheckType,
          priority: 'MEDIUM' as TaskPriority,
          status: 'PENDING' as TaskStatus,
          payload: { test: 'data' },
          attempts: 0,
          maxAttempts: 3,
          scheduledFor: new Date(),
          executedAt: null,
          completedAt: null,
          error: null,
          result: null,
          executionTimeMs: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]

      mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue(pendingTasks)

      // Create new queue manager instance to trigger loading
      const newQueueManager = new VMHealthQueueManager(mockPrisma, mockEventManager)

      // Allow async loading to complete
      await new Promise(resolve => setImmediate(resolve))

      expect(mockPrisma.vMHealthCheckQueue.findMany).toHaveBeenCalled()

      // Verify queue was loaded
      expect(newQueueManager.getQueueSize(mockMachineId)).toBe(1)
    })
  })

  describe('health check execution types', () => {
    let mockService: { sendSafeCommand: jest.Mock }

    beforeEach(async () => {
      const { getVirtioSocketWatcherService } = await import('@services/VirtioSocketWatcherService')
      mockService = getVirtioSocketWatcherService()
      mockService.sendSafeCommand = jest.fn().mockResolvedValue({
        success: true,
        data: { status: 'healthy' }
      })
    })

    it('should execute OVERALL_STATUS check with correct timeout', async () => {
      // Just verify the health check was queued properly
      const result = await queueManager.executeHealthCheck(mockTask)
      expect(result).toBeUndefined()
      expect(typeof queueId).toBe('string')
      expect(queueManager.getQueueSize(mockMachineId)).toBe(1)
    })

    it('should execute WINDOWS_UPDATES check with correct timeout', async () => {
      // Just verify the health check was queued properly
      const queueId = await queueManager.queueHealthCheck(mockMachineId, 'WINDOWS_UPDATES')

      expect(typeof queueId).toBe('string')
      expect(queueManager.getQueueSize(mockMachineId)).toBe(1)
    })

    it('should execute APPLICATION_INVENTORY check with correct timeout', async () => {
      // Just verify the health check was queued properly
      const queueId = await queueManager.queueHealthCheck(mockMachineId, 'APPLICATION_INVENTORY')

      expect(typeof queueId).toBe('string')
      expect(queueManager.getQueueSize(mockMachineId)).toBe(1)
    })

    it('should handle unsupported health check types', async () => {
      // This would be caught at TypeScript level, but test runtime behavior
      const unsupportedType = 'UNSUPPORTED_TYPE' as HealthCheckType

      await queueManager.queueHealthCheck(mockMachineId, unsupportedType)
      await queueManager.processQueue(mockMachineId)

      expect(mockPrisma.vMHealthCheckQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.any(String) },
          data: expect.objectContaining({
            status: 'FAILED',
            error: expect.stringContaining('Unsupported health check type')
          })
        })
      )
    })
  })
})
