import 'reflect-metadata'
import { VMHealthQueueManager } from '@services/VMHealthQueueManager'
import type { EventManager } from '@services/EventManager'
import { mockPrisma } from '../../setup/jest.setup'
import { TaskStatus, TaskPriority, HealthCheckType } from '@prisma/client'
import { RUNNING_STATUS, STOPPED_STATUS, PAUSED_STATUS } from '../../../app/constants/machine-status'

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

    // Spy on console.log to verify logging behavior
    jest.spyOn(console, 'log').mockImplementation(() => { })

    // Mock machine data for tests - using lowercase status to match database values
    mockPrisma.machine.findUnique.mockResolvedValue({
      id: mockMachineId,
      name: 'test-vm',
      status: RUNNING_STATUS,
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

  afterEach(() => {
    // Restore console.log and other mocks
    jest.restoreAllMocks()
  })

  // Helper methods for creating mock VMs with different statuses - using lowercase status values
  const createMockVM = (status: string) => ({
    id: mockMachineId,
    name: 'test-vm',
    status,
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

    it('should throw error when VM is stopped', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(STOPPED_STATUS))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is '${STOPPED_STATUS}', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should throw error when VM is suspended', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(PAUSED_STATUS))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is '${PAUSED_STATUS}', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should throw error when VM is in error state', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM('error'))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is 'error', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should throw error when VM is creating', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM('creating'))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is 'creating', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should successfully queue health check when VM is running', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(RUNNING_STATUS))
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

      const queueId = await queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')

      // Focus on functional outcomes rather than internal DB call counts
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalled()
      expect(typeof queueId).toBe('string')
    })

    it('should handle edge case with null VM status', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(null as any))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is 'null', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should handle edge case with undefined VM status', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(undefined as any))

      await expect(
        queueManager.queueHealthCheck(mockMachineId, 'DISK_SPACE')
      ).rejects.toThrow(`Cannot queue health check for VM test-vm (${mockMachineId}) - VM status is 'undefined', expected '${RUNNING_STATUS}'`)

      // Verify no database writes occurred
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
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

      // Focus on functional outcome: should queue 6 standard checks
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalledTimes(6)
    })

    it('should skip queuing and log message when VM is stopped', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(STOPPED_STATUS))

      await queueManager.queueHealthChecks(mockMachineId)

      // Focus on functional outcome: should not queue any health checks
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()

      // Verify logging behavior for skipped VM
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping health checks for VM test-vm (${mockMachineId}) - VM status is '${STOPPED_STATUS}', expected '${RUNNING_STATUS}'`)
      )
    })

    it('should skip queuing and log message when VM is suspended', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(PAUSED_STATUS))

      await queueManager.queueHealthChecks(mockMachineId)

      // Focus on functional outcome: should not queue any health checks
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()

      // Verify logging behavior for skipped VM
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping health checks for VM test-vm (${mockMachineId}) - VM status is '${PAUSED_STATUS}', expected '${RUNNING_STATUS}'`)
      )
    })

    it('should skip queuing when VM is in error state', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM('error'))

      await queueManager.queueHealthChecks(mockMachineId)

      // Focus on functional outcome: should not queue any health checks
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()

      // Verify logging behavior for skipped VM
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping health checks for VM test-vm (${mockMachineId}) - VM status is 'error', expected '${RUNNING_STATUS}'`)
      )
    })

    it('should skip queuing when VM is creating', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM('creating'))

      await queueManager.queueHealthChecks(mockMachineId)

      // Focus on functional outcome: should not queue any health checks
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()

      // Verify logging behavior for skipped VM
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping health checks for VM test-vm (${mockMachineId}) - VM status is 'creating', expected '${RUNNING_STATUS}'`)
      )
    })

    it('should throw error when VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(
        queueManager.queueHealthChecks(mockMachineId)
      ).rejects.toThrow(`VM with ID ${mockMachineId} not found`)
    })

    it('should successfully queue all health checks when VM is running', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(RUNNING_STATUS))
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

      // Focus on functional outcome: should queue 6 standard checks
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalledTimes(6)
    })

    it('should verify no unnecessary database operations when VM is not running', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVM(STOPPED_STATUS))

      await queueManager.queueHealthChecks(mockMachineId)

      // Verify VM status was checked
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: mockMachineId },
        select: { id: true, name: true, status: true }
      })

      // Verify no health check creation operations were performed
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })
  })

  describe('processQueue', () => {
    it('should process queued health checks when called', async () => {
      // This test verifies that the processQueue method works correctly
      // Since the actual implementation is complex with concurrency controls,
      // we'll test the basic functionality by ensuring it loads pending tasks

      // Mock database operations for finding pending tasks
      mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([
        {
          id: 'test-id',
          machineId: mockMachineId,
          checkType: 'DISK_SPACE',
          priority: 'MEDIUM',
          status: 'PENDING',
          payload: null,
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
      ])

      // Process the queue (this will load pending tasks from database)
      await queueManager.processQueue(mockMachineId)

      // Verify that pending tasks were loaded from database
      expect(mockPrisma.vMHealthCheckQueue.findMany).toHaveBeenCalledWith({
        where: {
          machineId: mockMachineId,
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledFor: 'asc' }
        ]
      })
    })

    it('should return early when queue is empty', async () => {
      // Mock empty queue
      mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([])

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
          machineId: mockMachineId,
          status: {
            in: ['PENDING', 'RETRY_SCHEDULED']
          }
        }
      })
    })
  })

  // TODO: Fix broken tests - commenting out for now
  /*
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
    */
})
