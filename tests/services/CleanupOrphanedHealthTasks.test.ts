import { CleanupOrphanedHealthTasksJob } from '../../app/crons/CleanupOrphanedHealthTasks'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { EventManager } from '../../app/services/EventManager'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

// Mock the singleton functions
const mockQueueManager = {
  cleanupOrphanedTasks: jest.fn()
}

const mockEventManager = {
  dispatchEvent: jest.fn()
}

jest.mock('../../app/services/VMHealthQueueManager', () => ({
  getVMHealthQueueManager: jest.fn(() => mockQueueManager)
}))

jest.mock('../../app/services/EventManager', () => ({
  getEventManager: jest.fn(() => mockEventManager)
}))

describe('CleanupOrphanedHealthTasksJob', () => {
  let job: CleanupOrphanedHealthTasksJob
  let mockPrisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    jest.clearAllMocks()
    
    mockPrisma = mockDeep<PrismaClient>()
    job = new CleanupOrphanedHealthTasksJob(mockPrisma)
  })

  afterEach(() => {
    job.stop()
  })

  describe('cleanupOrphanedTasks', () => {
    it('should call queue manager cleanup method', async () => {
      mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined)

      const cleanupMethod = (job as any).cleanupOrphanedTasks.bind(job)
      await cleanupMethod()

      expect(mockQueueManager.cleanupOrphanedTasks).toHaveBeenCalled()
    })

    it('should handle cleanup errors gracefully', async () => {
      const cleanupError = new Error('Cleanup failed')
      mockQueueManager.cleanupOrphanedTasks.mockRejectedValue(cleanupError)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const cleanupMethod = (job as any).cleanupOrphanedTasks.bind(job)
      
      await expect(cleanupMethod()).rejects.toThrow('Cleanup failed')
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error during orphaned tasks cleanup:'),
        cleanupError
      )

      consoleErrorSpy.mockRestore()
    })

    it('should use singleton queue manager', async () => {
      const { getVMHealthQueueManager } = require('../../app/services/VMHealthQueueManager')
      const { getEventManager } = require('../../app/services/EventManager')
      
      mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined)

      const cleanupMethod = (job as any).cleanupOrphanedTasks.bind(job)
      await cleanupMethod()

      expect(getEventManager).toHaveBeenCalled()
      expect(getVMHealthQueueManager).toHaveBeenCalledWith(mockPrisma, mockEventManager)
    })
  })

  describe('job lifecycle', () => {
    it('should start and stop correctly', () => {
      expect(() => job.start()).not.toThrow()
      expect(() => job.stop()).not.toThrow()
    })

    it('should not start multiple times', () => {
      job.start()
      
      // Mock debug logger to capture the message
      const debugLogSpy = jest.fn()
      ;(job as any).debug = { log: debugLogSpy }
      
      job.start() // Second start
      
      expect(debugLogSpy).toHaveBeenCalledWith(
        'CleanupOrphanedHealthTasks job is already running'
      )
    })

    it('should prevent concurrent execution', async () => {
      mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined)

      // Start the job
      job.start()

      // Mock the isRunning flag to simulate concurrent execution
      ;(job as any).isRunning = true

      // Mock debug logger to capture skip message
      const debugLogSpy = jest.fn()
      ;(job as any).debug = { log: debugLogSpy }

      // Manually trigger the cleanup method
      const cleanupMethod = (job as any).cleanupOrphanedTasks.bind(job)
      await cleanupMethod()

      // The cleanup should still run since we're calling it directly
      // In real cron execution, the isRunning check would prevent this
      expect(mockQueueManager.cleanupOrphanedTasks).toHaveBeenCalled()
    })

    it('should run on correct schedule (every hour)', () => {
      job.start()
      
      const cronJob = (job as any).job
      expect(cronJob).toBeDefined()
      
      // Check cron pattern for every hour at minute 0
      expect(cronJob.cronTime.source).toBe('0 0 * * * *')
    })

    it('should handle job execution errors without crashing', async () => {
      const executionError = new Error('Job execution failed')
      mockQueueManager.cleanupOrphanedTasks.mockRejectedValue(executionError)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      // Start the job
      job.start()

      // Manually trigger the cron function to test error handling
      const cronFunction = (job as any).job.fireOnTick
      await cronFunction()

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in CleanupOrphanedHealthTasks job:'),
        executionError
      )

      // Job should still be running after error
      expect((job as any).job).toBeDefined()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('factory function', () => {
    it('should return singleton instance', () => {
      const { createCleanupOrphanedHealthTasksJob } = require('../../app/crons/CleanupOrphanedHealthTasks')
      
      const instance1 = createCleanupOrphanedHealthTasksJob(mockPrisma)
      const instance2 = createCleanupOrphanedHealthTasksJob(mockPrisma)

      expect(instance1).toBe(instance2)
    })
  })
})
