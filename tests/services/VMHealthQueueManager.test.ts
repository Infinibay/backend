import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { EventManager } from '../../app/services/EventManager'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

// Mock VirtioSocketWatcherService
const mockVirtioService = {
  sendSafeCommand: jest.fn()
}

jest.mock('../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: () => mockVirtioService
}))

describe('VMHealthQueueManager', () => {
  let queueManager: VMHealthQueueManager
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockEventManager: DeepMockProxy<EventManager>

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()
    mockEventManager = mockDeep<EventManager>()

    queueManager = new VMHealthQueueManager(mockPrisma, mockEventManager)
  })

  describe('getOverallScanIntervalMinutes', () => {
    it('should return per-VM config when available', async () => {
      mockPrisma.vMHealthConfig.findUnique.mockResolvedValue({
        checkIntervalMinutes: 30
      } as any)

      const interval = await queueManager.getOverallScanIntervalMinutes('vm1')
      expect(interval).toBe(30)
    })

    it('should return environment variable when per-VM config not available', async () => {
      mockPrisma.vMHealthConfig.findUnique.mockResolvedValue(null)
      process.env.OVERALL_SCAN_INTERVAL_MINUTES = '45'

      const interval = await queueManager.getOverallScanIntervalMinutes('vm1')
      expect(interval).toBe(45)

      delete process.env.OVERALL_SCAN_INTERVAL_MINUTES
    })

    it('should return default when no config or env var', async () => {
      mockPrisma.vMHealthConfig.findUnique.mockResolvedValue(null)
      delete process.env.OVERALL_SCAN_INTERVAL_MINUTES

      const interval = await queueManager.getOverallScanIntervalMinutes('vm1')
      expect(interval).toBe(60) // Default value
    })
  })

  describe('queueHealthCheck - Idempotency', () => {
    it('should prevent duplicate OVERALL_STATUS checks within interval', async () => {
      const machineId = 'vm1'

      // Mock VM lookup
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: machineId,
        name: 'Test VM',
        status: 'running'
      } as any)

      // Mock existing pending task
      mockPrisma.vMHealthCheckQueue.findFirst
        .mockResolvedValueOnce({ id: 'existing-task' } as any) // Existing pending task
        .mockResolvedValueOnce({ id: 'recent-completed' } as any) // Recent completed task

      const taskId = await queueManager.queueHealthCheck(machineId, 'OVERALL_STATUS', 'MEDIUM')

      expect(taskId).toBe('existing-task')
      expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled()
    })

    it('should allow new OVERALL_STATUS check after interval expires', async () => {
      const machineId = 'vm1'

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: machineId,
        name: 'Test VM',
        status: 'running'
      } as any)

      // Mock per-VM config
      mockPrisma.vMHealthConfig.findUnique.mockResolvedValue({
        checkIntervalMinutes: 30
      } as any)

      // No existing tasks
      mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null)

      // Mock successful creation
      mockPrisma.vMHealthCheckQueue.create.mockResolvedValue({
        id: 'new-task-id'
      } as any)

      const taskId = await queueManager.queueHealthCheck(machineId, 'OVERALL_STATUS', 'MEDIUM')

      expect(taskId).toMatch(/^[0-9a-f-]{36}$/) // Should be a UUID
      expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalled()
    })
  })

  describe('processQueue - DB Sync', () => {
    it('should load pending tasks from database before processing', async () => {
      const machineId = 'vm1'

      // Mock database tasks
      mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([
        {
          id: 'task1',
          machineId,
          checkType: 'OVERALL_STATUS',
          priority: 'MEDIUM',
          attempts: 0,
          maxAttempts: 3,
          scheduledFor: new Date(),
          payload: null,
          createdAt: new Date()
        }
      ] as any)

      // Mock successful command execution
      mockVirtioService.sendSafeCommand.mockResolvedValue({ success: true })

      // Mock task completion
      mockPrisma.vMHealthCheckQueue.update.mockResolvedValue({} as any)

      await queueManager.processQueue(machineId)

      expect(mockPrisma.vMHealthCheckQueue.findMany).toHaveBeenCalledWith({
        where: {
          machineId,
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledFor: 'asc' }
        ]
      })
    })
  })

  describe('Retry and Backoff Logic', () => {
    it('should increment attempts and set FAILED status after max attempts', async () => {
      const machineId = 'vm1'
      const task = {
        id: 'task1',
        machineId,
        checkType: 'OVERALL_STATUS' as const,
        priority: 'MEDIUM' as const,
        attempts: 2, // Already at 2 attempts
        maxAttempts: 3,
        scheduledFor: new Date(),
        payload: null,
        createdAt: new Date()
      }

      // Mock VM lookup for executeHealthCheck
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: machineId,
        name: 'Test VM',
        status: 'running'
      } as any)

      // Mock command failure
      mockVirtioService.sendSafeCommand.mockRejectedValue(new Error('Command failed'))

      // Mock task update
      mockPrisma.vMHealthCheckQueue.update.mockResolvedValue({} as any)

      // Mock health snapshot creation/update
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)
      mockPrisma.vMHealthSnapshot.create.mockResolvedValue({ id: 'snapshot1' } as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue({} as any)

      // Access private method for testing
      const executeMethod = (queueManager as any).executeHealthCheck.bind(queueManager)
      await expect(executeMethod(task)).rejects.toThrow('Command failed')

      // Should update task with FAILED status after max attempts
      expect(mockPrisma.vMHealthCheckQueue.update).toHaveBeenCalledWith({
        where: { id: 'task1' },
        data: {
          status: 'FAILED',
          completedAt: expect.any(Date),
          error: 'Command failed',
          executionTimeMs: expect.any(Number)
        }
      })
    })
  })

  describe('Concurrency Control', () => {
    it('should use database transactions for task claiming', async () => {
      const machineId = 'vm1'

      // Mock transaction behavior
      const mockTransaction = jest.fn().mockResolvedValue([
        {
          id: 'task1',
          machineId,
          checkType: 'OVERALL_STATUS',
          priority: 'MEDIUM',
          attempts: 0,
          maxAttempts: 3,
          scheduledFor: new Date(),
          payload: null,
          createdAt: new Date()
        }
      ])

      mockPrisma.$transaction.mockImplementation(mockTransaction)

      // Access private method for testing
      const getReadyTasksMethod = (queueManager as any).getReadyTasksWithLocking.bind(queueManager)
      const tasks = await getReadyTasksMethod(machineId, 5)

      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].id).toBe('task1')
    })
  })

  describe('cleanupOrphanedTasks', () => {
    it('should remove tasks for deleted VMs', async () => {
      // Mock deleted VMs
      mockPrisma.machine.findMany.mockResolvedValue([
        { id: 'deleted-vm1' },
        { id: 'deleted-vm2' }
      ] as any)

      // Mock deletion count
      mockPrisma.vMHealthCheckQueue.deleteMany.mockResolvedValue({ count: 5 })

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      await queueManager.cleanupOrphanedTasks()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: 'DELETED' },
        select: { id: true }
      })

      expect(mockPrisma.vMHealthCheckQueue.deleteMany).toHaveBeenCalledWith({
        where: {
          machineId: { in: ['deleted-vm1', 'deleted-vm2'] },
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
        }
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 5 orphaned tasks for 2 deleted VMs')
      )

      consoleSpy.mockRestore()
    })
  })
})
