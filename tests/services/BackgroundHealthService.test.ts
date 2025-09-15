import { BackgroundHealthService } from '../../app/services/BackgroundHealthService'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { BackgroundTaskService } from '../../app/services/BackgroundTaskService'
import { EventManager } from '../../app/services/EventManager'
import { PrismaClient } from '@prisma/client'
import { RUNNING_STATUS, STOPPED_STATUS } from '../../app/constants/machine-status'

// Mock dependencies
jest.mock('../../app/services/VMHealthQueueManager')
jest.mock('../../app/services/BackgroundTaskService')
jest.mock('../../app/services/EventManager')

/**
 * BackgroundHealthService Tests
 *
 * These tests verify the basic functionality of the BackgroundHealthService.
 * The service now filters for only running VMs when processing health checks,
 * and integrates with the updated VMHealthQueueManager that validates VM status.
 */
describe('BackgroundHealthService', () => {
  let service: BackgroundHealthService
  let mockPrisma: jest.Mocked<PrismaClient>
  let mockBackgroundTaskService: jest.Mocked<BackgroundTaskService>
  let mockEventManager: jest.Mocked<EventManager>
  let mockQueueManager: jest.Mocked<VMHealthQueueManager>

  beforeEach(() => {
    // Create mock instances
    mockPrisma = {
      machine: {
        findMany: jest.fn()
      }
    } as any

    mockBackgroundTaskService = {
      queueTask: jest.fn()
    } as any

    mockEventManager = {
      dispatchEvent: jest.fn()
    } as any

    mockQueueManager = {
      queueHealthChecks: jest.fn()
    } as any

    // Mock BackgroundTaskService.queueTask to execute the task function immediately
    mockBackgroundTaskService.queueTask.mockImplementation(async (_name, taskFn) => {
      await taskFn()
      return 'task-123'
    })

    // Create service instance
    service = new BackgroundHealthService(
      mockPrisma,
      mockBackgroundTaskService,
      mockEventManager,
      mockQueueManager
    )

    // Setup default mock for machine.findMany
    ; (mockPrisma.machine.findMany as jest.Mock).mockResolvedValue([])
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('getStatus', () => {
    it('should return correct status when service is not running', () => {
      const status = service.getStatus()

      expect(status).toEqual({
        isRunning: false,
        cronActive: false,
        nextRun: null
      })
    })

    it('should return correct status when service is started', () => {
      service.start()
      const status = service.getStatus()

      expect(status.cronActive).toBe(true)
      expect(status.nextRun).toBeInstanceOf(Date)
    })
  })

  describe('triggerHealthCheckRound', () => {
    it('should return a task ID when triggered manually', async () => {
      const taskId = await service.triggerHealthCheckRound()

      expect(typeof taskId).toBe('string')
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
    })
  })

  describe('start', () => {
    it('should start the cron job', () => {
      service.start()
      const status = service.getStatus()

      expect(status.cronActive).toBe(true)
    })

    it('should not start multiple cron jobs', () => {
      service.start()
      service.start() // Second call should be ignored

      const status = service.getStatus()
      expect(status.cronActive).toBe(true)
    })
  })

  describe('VM status filtering integration', () => {
    it('should work with updated VMHealthQueueManager that validates VM status', async () => {
      // Mock running VMs data
      (mockPrisma.machine.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'vm-running-1',
          name: 'running-vm-1',
          status: RUNNING_STATUS,
          os: 'windows',
          internalName: 'running-vm-1'
        }
      ])

      // Mock the queue manager to simulate the new behavior where it validates VM status
      mockQueueManager.queueHealthChecks.mockImplementation(async (vmId: string) => {
        // Simulate the VMHealthQueueManager checking VM status and only proceeding for running VMs
        return Promise.resolve()
      })

      const taskId = await service.triggerHealthCheckRound()

      expect(typeof taskId).toBe('string')
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/) // UUID format

      // Wait a bit for the task to complete since it's executed asynchronously
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify the task was executed and proper database query was made
      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: RUNNING_STATUS },
        select: {
          id: true,
          name: true,
          status: true,
          os: true,
          internalName: true
        }
      })

      // Verify queueHealthChecks was called only for running VMs
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(1)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-1')
    })

    it('should handle VMHealthQueueManager rejections for non-running VMs', async () => {
      // Mock mixed VM data (running and stopped)
      (mockPrisma.machine.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'vm-running-1',
          name: 'running-vm-1',
          status: RUNNING_STATUS,
          os: 'windows',
          internalName: 'running-vm-1'
        },
        {
          id: 'vm-running-2',
          name: 'running-vm-2',
          status: RUNNING_STATUS,
          os: 'linux',
          internalName: 'running-vm-2'
        }
      ])

      // Mock the queue manager to reject health check queuing for one VM (simulating failure)
      mockQueueManager.queueHealthChecks
        .mockResolvedValueOnce(undefined) // First VM succeeds
        .mockRejectedValueOnce(
          new Error(`Cannot queue health check for VM running-vm-2 (vm-running-2) - VM status is '${STOPPED_STATUS}', expected '${RUNNING_STATUS}'`)
        ) // Second VM fails

      // The service should handle this gracefully and continue processing
      const taskId = await service.triggerHealthCheckRound()

      expect(typeof taskId).toBe('string')
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/) // UUID format

      // Wait a bit for the task to complete since it's executed asynchronously
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify both VMs were attempted
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2)
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-1')
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-2')

      // Verify events were dispatched with correct success/failure counts
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
  })
})
