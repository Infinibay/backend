import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { BackgroundHealthService } from '@services/BackgroundHealthService'
import { EventManager } from '@services/EventManager'
import { VMHealthQueueManager } from '@services/VMHealthQueueManager'
import { BackgroundTaskService } from '@services/BackgroundTaskService'
import { mockPrisma } from '../../setup/jest.setup'

// Mock cron module
interface MockedCronJob {
  start: jest.Mock
  stop: jest.Mock
  running: boolean
  nextDate: jest.Mock
}

jest.mock('cron', () => ({
  CronJob: jest.fn().mockImplementation((schedule, callback, complete, start, timezone) => {
    const instance = {
      start: jest.fn(),
      stop: jest.fn(),
      running: true,
      nextDate: jest.fn().mockReturnValue({
        toJSDate: () => new Date('2025-01-01T02:00:00Z')
      })
    }
    return instance
  })
}))

describe('BackgroundHealthService', () => {
  let service: BackgroundHealthService
  let mockEventManager: jest.Mocked<EventManager>
  let mockQueueManager: jest.Mocked<VMHealthQueueManager>
  let mockBackgroundTaskService: jest.Mocked<BackgroundTaskService>
  let mockCronJob: MockedCronJob

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock EventManager
    mockEventManager = {
      dispatchEvent: jest.fn(),
      registerResourceManager: jest.fn(),
      vmCreated: jest.fn(),
      vmUpdated: jest.fn(),
      vmDeleted: jest.fn(),
      getStats: jest.fn()
    } as unknown as jest.Mocked<EventManager>

    // Mock VMHealthQueueManager
    mockQueueManager = {
      queueHealthChecks: jest.fn(),
      queueHealthCheck: jest.fn(),
      processQueue: jest.fn(),
      getQueueSize: jest.fn(),
      getQueueStatistics: jest.fn(),
      clearQueue: jest.fn()
    } as unknown as jest.Mocked<VMHealthQueueManager>

    // Mock BackgroundTaskService
    mockBackgroundTaskService = {
      queueTask: jest.fn(),
      executeTask: jest.fn(),
      getTaskStats: jest.fn(),
      clearCompletedTasks: jest.fn()
    } as unknown as jest.Mocked<BackgroundTaskService>

    // Mock database responses
    mockPrisma.machine.findMany.mockResolvedValue([
      {
        id: 'vm-1',
        name: 'test-vm-1',
        status: 'RUNNING',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        internalName: 'test-vm-1',
        os: 'windows',
        cpuCores: 2,
        ramGB: 4,
        diskSizeGB: 50,
        departmentId: null,
        templateId: null,
        gpuPciAddress: null,
        firewallTemplates: {}
      },
      {
        id: 'vm-2',
        name: 'test-vm-2',
        status: 'STOPPED',
        userId: 'user-2',
        createdAt: new Date(),
        updatedAt: new Date(),
        internalName: 'test-vm-2',
        os: 'linux',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100,
        departmentId: null,
        templateId: null,
        gpuPciAddress: null,
        firewallTemplates: {}
      }
    ])

    // Create a shared mock CronJob instance
    mockCronJob = {
      start: jest.fn(),
      stop: jest.fn(),
      running: true,
      nextDate: jest.fn().mockReturnValue({
        toJSDate: () => new Date('2025-01-01T02:00:00Z')
      })
    }

    // Reset the CronJob mock to return our shared instance
    const { CronJob } = require('cron')
    CronJob.mockReturnValue(mockCronJob)

    service = new BackgroundHealthService(
      mockPrisma,
      mockBackgroundTaskService,
      mockEventManager,
      mockQueueManager
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('start', () => {
    it('should start the cron job with correct schedule', () => {
      service.start()

      const { CronJob } = require('cron')
      expect(CronJob).toHaveBeenCalledWith(
        '0 2 * * *',
        expect.any(Function)
      )
    })

    it('should not start multiple cron jobs if already started', () => {
      service.start()
      service.start()

      const { CronJob } = require('cron')
      expect(CronJob).toHaveBeenCalledTimes(1)
    })
  })

  describe('stop', () => {
    it('should stop the cron job', () => {
      service.start()
      service.stop()

      expect(mockCronJob.stop).toHaveBeenCalled()
    })

    it('should handle stopping when not started', () => {
      expect(() => service.stop()).not.toThrow()
    })
  })

  describe('updateSchedule', () => {
    it('should update the cron schedule', () => {
      service.start()
      service.updateSchedule('0 3 * * *')

      const { CronJob } = require('cron')
      expect(CronJob).toHaveBeenCalledTimes(2)
      expect(CronJob).toHaveBeenLastCalledWith(
        '0 3 * * *',
        expect.any(Function)
      )
    })
  })

  describe('executeHealthCheckRound', () => {
    beforeEach(() => {
      mockBackgroundTaskService.queueTask.mockResolvedValue('task-123')
    })

    it('should not execute if already running', async () => {
      // Mock isRunning state by calling executeHealthCheckRound twice concurrently
      const promise1 = service.executeHealthCheckRound()
      const promise2 = service.executeHealthCheckRound()

      await Promise.all([promise1, promise2])

      // Only one should actually execute
      expect(mockBackgroundTaskService.queueTask).toHaveBeenCalledTimes(1)
    })

    it('should queue a background task for health check execution', async () => {
      await service.executeHealthCheckRound()

      expect(mockBackgroundTaskService.queueTask).toHaveBeenCalledWith(
        'daily-health-check-round',
        expect.any(Function),
        expect.objectContaining({
          retryPolicy: expect.objectContaining({
            maxRetries: 2,
            backoffMs: 5000,
            backoffMultiplier: 2,
            maxBackoffMs: 30000
          }),
          onError: expect.any(Function)
        })
      )
    })

    it('should handle task queuing failure', async () => {
      const error = new Error('Task queue full')
      mockBackgroundTaskService.queueTask.mockRejectedValue(error)

      await expect(service.executeHealthCheckRound()).resolves.not.toThrow()
    })
  })

  describe('performHealthCheckRound (via task execution)', () => {
    it('should get all active VMs and queue health checks', async () => {
      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        // Execute the task function to test the actual implementation
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: { not: 'DELETED' } },
        select: {
          id: true,
          name: true,
          status: true,
          os: true,
          internalName: true
        }
      })

      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-1')
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-2')
    })

    it('should emit round_started event', async () => {
      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health',
        'round_started',
        expect.objectContaining({
          vmCount: 2,
          timestamp: expect.any(String)
        })
      )
    })

    it('should emit round_completed event with success statistics', async () => {
      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health',
        'round_completed',
        expect.objectContaining({
          totalVMs: 2,
          successCount: 2,
          failureCount: 0,
          executionTimeMs: expect.any(Number),
          timestamp: expect.any(String)
        })
      )
    })

    it('should handle VM health check queuing failures', async () => {
      const error = new Error('Queue full')
      mockQueueManager.queueHealthChecks.mockRejectedValueOnce(error)
      mockQueueManager.queueHealthChecks.mockResolvedValueOnce(undefined)

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health',
        'round_completed',
        expect.objectContaining({
          totalVMs: 2,
          successCount: 1,
          failureCount: 1
        })
      )
    })

    it('should emit round_failed event when task execution fails', async () => {
      const taskError = new Error('Database connection failed')
      mockPrisma.machine.findMany.mockRejectedValue(taskError)

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health',
        'round_failed',
        expect.objectContaining({
          error: 'Database connection failed',
          executionTimeMs: expect.any(Number),
          timestamp: expect.any(String)
        })
      )
    })

    it('should handle empty VM list', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockQueueManager.queueHealthChecks).not.toHaveBeenCalled()
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health',
        'round_completed',
        expect.objectContaining({
          totalVMs: 0,
          successCount: 0,
          failureCount: 0
        })
      )
    })
  })

  describe('triggerHealthCheckRound', () => {
    it('should manually trigger a health check round', async () => {
      mockBackgroundTaskService.queueTask.mockResolvedValue('manual-task-456')

      const taskId = await service.triggerHealthCheckRound()

      expect(typeof taskId).toBe('string')
      expect(taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })
  })

  describe('getStatus', () => {
    it('should return service status when not started', () => {
      const status = service.getStatus()

      expect(status).toEqual({
        isRunning: false,
        cronActive: false,
        nextRun: null
      })
    })

    it('should return service status when started', () => {
      service.start()
      const status = service.getStatus()

      expect(status).toEqual({
        isRunning: false, // Not running a health check round currently
        cronActive: true,
        nextRun: expect.any(Date)
      })
    })
  })

  describe('error handling in background task', () => {
    it('should call onError callback when task fails', async () => {
      let errorCallback: ((error: Error) => Promise<void>) | undefined

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn, options) => {
        errorCallback = options?.onError
        throw new Error('Task execution failed')
      })

      await service.executeHealthCheckRound()

      expect(errorCallback).toBeDefined()

      if (errorCallback) {
        const testError = new Error('Test error')
        await errorCallback(testError)

        expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
          'health',
          'round_failed',
          expect.objectContaining({
            error: 'Test error',
            timestamp: expect.any(String)
          })
        )
      }
    })
  })

  describe('integration scenarios', () => {
    it('should handle mixed VM statuses correctly', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([
        {
          id: 'vm-running',
          name: 'running-vm',
          status: 'RUNNING',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          internalName: 'running-vm',
          os: 'windows',
          cpuCores: 2,
          ramGB: 4,
          diskSizeGB: 50,
          departmentId: null,
          templateId: null,
          gpuPciAddress: null,
          firewallTemplates: {}
        },
        {
          id: 'vm-stopped',
          name: 'stopped-vm',
          status: 'STOPPED',
          userId: 'user-2',
          createdAt: new Date(),
          updatedAt: new Date(),
          internalName: 'stopped-vm',
          os: 'linux',
          cpuCores: 4,
          ramGB: 8,
          diskSizeGB: 100,
          departmentId: null,
          templateId: null,
          gpuPciAddress: null,
          firewallTemplates: {}
        }
      ])

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      // Should queue health checks for both VMs regardless of status (as long as not DELETED)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running')
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-stopped')
    })

    it('should exclude DELETED VMs from health checks', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([
        {
          id: 'vm-active',
          name: 'active-vm',
          status: 'RUNNING',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          internalName: 'active-vm',
          os: 'windows',
          cpuCores: 2,
          ramGB: 4,
          diskSizeGB: 50,
          departmentId: null,
          templateId: null,
          gpuPciAddress: null,
          firewallTemplates: {}
        }
      ])

      mockBackgroundTaskService.queueTask.mockImplementation(async (name, taskFn) => {
        await taskFn()
        return 'task-123'
      })

      await service.executeHealthCheckRound()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: { not: 'DELETED' } },
        select: {
          id: true,
          name: true,
          status: true,
          os: true,
          internalName: true
        }
      })

      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(1)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-active')
    })
  })
})
