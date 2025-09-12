import { ProcessHealthQueueJob } from '../../app/crons/ProcessHealthQueue'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { EventManager } from '../../app/services/EventManager'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

describe('ProcessHealthQueueJob', () => {
  let job: ProcessHealthQueueJob
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockEventManager: DeepMockProxy<EventManager>
  let mockQueueManager: DeepMockProxy<VMHealthQueueManager>

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()
    mockEventManager = mockDeep<EventManager>()
    mockQueueManager = mockDeep<VMHealthQueueManager>()

    job = new ProcessHealthQueueJob(mockPrisma, mockEventManager)
      // Replace the queue manager with our mock
      ; (job as any).queueManager = mockQueueManager
  })

  afterEach(() => {
    job.stop()
  })

  describe('processHealthQueues', () => {
    it('should process queues for all running VMs', async () => {
      const runningVMs = [
        { id: 'vm1', name: 'VM 1' },
        { id: 'vm2', name: 'VM 2' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as any)
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 5,
        activeChecks: 2,
        vmQueues: 2
      })

      const processMethod = (job as any).processHealthQueues.bind(job)
      await processMethod()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: 'running' },
        select: { id: true, name: true }
      })

      expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled()
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

      mockPrisma.machine.findMany.mockResolvedValue(manyVMs as any)
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 0,
        activeChecks: 0,
        vmQueues: 0
      })

      const processMethod = (job as any).processHealthQueues.bind(job)
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

      const processMethod = (job as any).processHealthQueues.bind(job)
      await processMethod()

      expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled()
      expect(mockQueueManager.processQueue).not.toHaveBeenCalled()
    })

    it('should handle individual VM processing errors gracefully', async () => {
      const runningVMs = [
        { id: 'vm1', name: 'Good VM' },
        { id: 'vm2', name: 'Error VM' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as any)
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

      const processMethod = (job as any).processHealthQueues.bind(job)
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

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as any)
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 3,
        activeChecks: 1,
        vmQueues: 1
      })

      // Mock debug logger
      const debugLogSpy = jest.fn()
        ; (job as any).debug = { log: debugLogSpy }

      const processMethod = (job as any).processHealthQueues.bind(job)
      await processMethod()

      expect(debugLogSpy).toHaveBeenCalledWith(
        'Queue stats: 3 queued, 1 active, 1 VM queues'
      )
    })

    it('should not log queue statistics when no active items', async () => {
      const runningVMs = [{ id: 'vm1', name: 'VM 1' }]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as any)
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)
      mockQueueManager.processQueue.mockResolvedValue(undefined)
      mockQueueManager.getQueueStatistics.mockReturnValue({
        totalQueued: 0,
        activeChecks: 0,
        vmQueues: 0
      })

      // Mock debug logger
      const debugLogSpy = jest.fn()
        ; (job as any).debug = { log: debugLogSpy }

      const processMethod = (job as any).processHealthQueues.bind(job)
      await processMethod()

      // Should not log stats when everything is zero
      expect(debugLogSpy).not.toHaveBeenCalledWith(
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
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      job.start() // Second start

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ProcessHealthQueue job is already running')
      )

      consoleSpy.mockRestore()
    })

    it('should prevent concurrent execution', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])
      mockQueueManager.syncFromDatabase.mockResolvedValue(undefined)

      // Start the job
      job.start()

        // Mock the isRunning flag to simulate concurrent execution
        ; (job as any).isRunning = true

      // Mock debug logger to capture skip message
      const debugLogSpy = jest.fn()
        ; (job as any).debug = { log: debugLogSpy }

      // Manually trigger the cron function (simulate cron execution)
      const processMethod = (job as any).processHealthQueues.bind(job)
      await processMethod()

      expect(debugLogSpy).toHaveBeenCalledWith(
        'Previous health queue processing still running, skipping...'
      )
    })
  })
})
