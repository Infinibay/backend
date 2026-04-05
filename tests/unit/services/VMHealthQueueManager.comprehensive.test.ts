import 'reflect-metadata'
import { VMHealthQueueManager, QueuedHealthCheck } from '../../../app/services/health/VMHealthQueueManager'
import { PrismaClient, TaskPriority } from '@prisma/client'
import { EventManager } from '../../../app/services/events/EventManager'

// Mock VMRecommendationService
jest.mock('../../../app/services/health/VMRecommendationService', () => ({
  VMRecommendationService: jest.fn().mockImplementation(() => ({}))
}))

// Mock VirtioSocketWatcherService
jest.mock('../../../app/services/vm/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn()
}))

// Mock Prisma
const mockPrisma = {
  machine: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  },
  vMHealthCheckQueue: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn()
  },
  vMHealthSnapshot: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn()
  },
  vMHealthConfig: {
    findUnique: jest.fn()
  },
  $transaction: jest.fn((fn: Function) => fn(mockPrisma))
} as unknown as PrismaClient

// Mock EventManager
const mockEventManager = {
  dispatchEvent: jest.fn()
} as unknown as EventManager

describe('VMHealthQueueManager Comprehensive Tests', () => {
  let queueManager: VMHealthQueueManager

  beforeEach(() => {
    jest.clearAllMocks()
    // Suppress constructor console logs
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})

    queueManager = new VMHealthQueueManager(mockPrisma, mockEventManager)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with prisma and event manager', () => {
      expect(queueManager).toBeDefined()
      expect((queueManager as any).prisma).toBe(mockPrisma)
      expect((queueManager as any).eventManager).toBe(mockEventManager)
    })
  })

  describe('getQueueSize', () => {
    it('should return 0 for unknown machine', () => {
      const size = queueManager.getQueueSize('unknown-vm')
      expect(size).toBe(0)
    })
  })

  describe('getQueueStatistics', () => {
    it('should return statistics', () => {
      const stats = queueManager.getQueueStatistics()

      expect(stats).toBeDefined()
      expect(stats.totalQueued).toBeDefined()
      expect(stats.activeChecks).toBeDefined()
      expect(stats.vmQueues).toBeDefined()
    })

    it('should return zero counts when no tasks queued', () => {
      const stats = queueManager.getQueueStatistics()

      expect(stats.totalQueued).toBe(0)
      expect(stats.activeChecks).toBe(0)
    })
  })

  describe('clearQueue', () => {
    it('should clear queue for a VM', async () => {
      await queueManager.clearQueue('vm-123')

      expect((mockPrisma.vMHealthCheckQueue as any).deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            machineId: 'vm-123'
          })
        })
      )
    })
  })

  describe('queueHealthCheck', () => {
    it('should throw error when VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(
        queueManager.queueHealthCheck('non-existent', 'OVERALL_STATUS')
      ).rejects.toThrow('VM with ID non-existent not found')
    })

    it('should throw error when VM is not running', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: 'vm-123',
        name: 'test-vm',
        status: 'stopped'
      })
      ;(mockPrisma.vMHealthCheckQueue as any).findFirst.mockResolvedValue(null)

      await expect(
        queueManager.queueHealthCheck('vm-123', 'OVERALL_STATUS')
      ).rejects.toThrow()
    })

    it('should skip duplicate health checks', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: 'vm-123',
        name: 'test-vm',
        status: 'running'
      })
      ;(mockPrisma.vMHealthCheckQueue as any).findFirst.mockResolvedValue({
        id: 'existing-task-id',
        machineId: 'vm-123',
        checkType: 'OVERALL_STATUS',
        status: 'PENDING'
      })

      const result = await queueManager.queueHealthCheck('vm-123', 'OVERALL_STATUS')

      expect(result).toBe('existing-task-id')
    })
  })

  describe('queueHealthChecks', () => {
    it('should throw error when VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(
        queueManager.queueHealthChecks('non-existent')
      ).rejects.toThrow('VM with ID non-existent not found')
    })

    it('should skip when VM is not running', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: 'vm-123',
        name: 'test-vm',
        status: 'stopped',
        os: 'ubuntu-22.04'
      })

      await queueManager.queueHealthChecks('vm-123')

      // Should not create any tasks
      expect((mockPrisma.vMHealthCheckQueue as any).create).not.toHaveBeenCalled()
    })
  })

  describe('processQueue', () => {
    it('should process queue for a machine', async () => {
      await expect(
        queueManager.processQueue('vm-123')
      ).resolves.not.toThrow()
    })
  })

  describe('cleanupOrphanedTasks', () => {
    it('should clean up tasks for deleted VMs', async () => {
      ;(mockPrisma.machine.findMany as jest.Mock).mockResolvedValue([
        { id: 'deleted-vm-1' },
        { id: 'deleted-vm-2' }
      ])

      await queueManager.cleanupOrphanedTasks()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'DELETED' }
        })
      )
    })

    it('should handle no deleted VMs gracefully', async () => {
      ;(mockPrisma.machine.findMany as jest.Mock).mockResolvedValue([])

      await expect(
        queueManager.cleanupOrphanedTasks()
      ).resolves.not.toThrow()
    })
  })

  describe('getOverallScanIntervalMinutes', () => {
    it('should return default interval when no config exists', async () => {
      ;(mockPrisma.vMHealthConfig as any).findUnique.mockResolvedValue(null)

      const interval = await queueManager.getOverallScanIntervalMinutes('vm-123')

      expect(interval).toBe(60) // OVERALL_SCAN_INTERVAL_MINUTES default
    })

    it('should return per-VM config when available', async () => {
      ;(mockPrisma.vMHealthConfig as any).findUnique.mockResolvedValue({
        checkIntervalMinutes: 30
      })

      const interval = await queueManager.getOverallScanIntervalMinutes('vm-123')

      expect(interval).toBe(30)
    })

    it('should handle database errors gracefully', async () => {
      ;(mockPrisma.vMHealthConfig as any).findUnique.mockRejectedValue(
        new Error('Database connection failed')
      )

      const interval = await queueManager.getOverallScanIntervalMinutes('vm-123')

      // Should return default on error
      expect(interval).toBe(60)
    })
  })
})
