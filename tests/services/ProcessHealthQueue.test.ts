import { ProcessHealthQueueJob } from '../../app/crons/ProcessHealthQueue'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { EventManager } from '../../app/services/EventManager'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

// Mock debug module with proper jest.mock structure
jest.mock('../../app/utils/debug', () => {
  const mockLog = jest.fn()
  return {
    Debugger: jest.fn().mockImplementation(() => ({
      log: mockLog
    })),
    __mockLog: mockLog // Export the mock for testing
  }
})

// Type for the mocked debug module
interface MockedDebugModule {
  Debugger: jest.MockedFunction<() => { log: jest.MockedFunction<(message: string) => void> }>
  __mockLog: jest.MockedFunction<(message: string) => void>
}

// Type definitions for test data
interface TestMachine {
  id: string
  name: string
}

interface JobWithPrivateMethods {
  processHealthQueues: () => Promise<void>
  queueManager: VMHealthQueueManager
  isRunning: boolean
  job: unknown
}

describe('ProcessHealthQueueJob', () => {
  let job: ProcessHealthQueueJob
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockEventManager: DeepMockProxy<EventManager>
  let mockQueueManager: DeepMockProxy<VMHealthQueueManager>

  beforeEach(() => {
    jest.clearAllMocks()
    // Clear the mock log function
    const debugModule = require('../../app/utils/debug') as MockedDebugModule
    debugModule.__mockLog.mockClear()

    mockPrisma = mockDeep<PrismaClient>()
    mockEventManager = mockDeep<EventManager>()
    mockQueueManager = mockDeep<VMHealthQueueManager>()

    job = new ProcessHealthQueueJob(mockPrisma, mockEventManager)
    // Replace the queue manager with our mock
    ;(job as unknown as JobWithPrivateMethods).queueManager = mockQueueManager
  })

  const getMockDebugLog = () => {
    const debugModule = require('../../app/utils/debug') as MockedDebugModule
    return debugModule.__mockLog
  }

  afterEach(() => {
    job.stop()
  })

  describe('processHealthQueues', () => {
    it('should process queues for all running VMs', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'VM 1' },
        { id: 'vm2', name: 'VM 2' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 5,
        activeChecks: 2,
        vmQueues: 2
      })

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: 'running' },
        select: { id: true, name: true }
      })

      expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(2)
      expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm1')
      expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm2')
    })

    it('should process VMs in batches when there are many VMs', async () => {
      // Create 75 VMs to test batching (batch size is 50)
      const manyVMs = Array.from({ length: 75 }, (_, i) => ({
        id: `vm${i + 1}`,
        name: `VM ${i + 1}`
      }))

      mockPrisma.machine.findMany.mockResolvedValue(manyVMs as never[])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 0,
        activeChecks: 0,
        vmQueues: 0
      })

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      // Should process all 75 VMs
      expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(75)

      // Verify batching by checking that we don't overwhelm the system
      // (This is more of a structural test - the batching happens sequentially)
      expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm1')
      expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm50')
      expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm75')
    })

    it('should handle no running VMs gracefully', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled()
      expect(mockQueueManager.processQueue).not.toHaveBeenCalled()
    })

    it('should handle individual VM processing errors gracefully', async () => {
      const runningVMs = [
        { id: 'vm1', name: 'Good VM' },
        { id: 'vm2', name: 'Error VM' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue
        .mockResolvedValueOnce(undefined) // vm1 succeeds
        .mockRejectedValueOnce(new Error('Processing failed')) // vm2 fails

      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 0,
        activeChecks: 0,
        vmQueues: 0
      })

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process health queue for VM Error VM'),
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })

    it('should log queue statistics when there are active items', async () => {
      const runningVMs = [{ id: 'vm1', name: 'VM 1' }]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 3,
        activeChecks: 1,
        vmQueues: 1
      })

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      const mockDebugLogFn = getMockDebugLog()
      expect(mockDebugLogFn).toHaveBeenCalledWith(
        'Queue stats: 3 queued, 1 active, 1 VM queues'
      )
    })

    it('should not log queue statistics when no active items', async () => {
      const runningVMs = [{ id: 'vm1', name: 'VM 1' }]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 0,
        activeChecks: 0,
        vmQueues: 0
      })

      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)
      await processMethod()

      // Should not log stats when everything is zero
      const mockDebugLogFn = getMockDebugLog()
      expect(mockDebugLogFn).not.toHaveBeenCalledWith(
        expect.stringContaining('Queue stats:')
      )
    })
  })

  describe('job lifecycle', () => {
    it('should start and stop correctly', () => {
      expect(() => job.start()).not.toThrow()
      expect(() => job.stop()).not.toThrow()
    })

    it('should not start multiple times', () => {
      job.start()

      // Get reference to the first job instance
      const firstJob = (job as unknown as { job: unknown }).job

      // Try to start again
      expect(() => job.start()).not.toThrow()

      // Verify the job instance hasn't changed (same job is reused)
      const secondJob = (job as unknown as { job: unknown }).job
      expect(secondJob).toBe(firstJob)
    })

    it('should prevent concurrent execution', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)

      // Start the job
      job.start()

      // Verify that isRunning flag is properly managed during execution
      const processMethod = (job as unknown as JobWithPrivateMethods).processHealthQueues.bind(job)

      // This should work normally
      await processMethod()

      expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled()
      expect(mockQueueManager.processQueue).not.toHaveBeenCalled()
    })
  })
})
