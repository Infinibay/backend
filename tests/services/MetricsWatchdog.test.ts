import { MetricsWatchdogJob } from '../../app/crons/MetricsWatchdog'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

// Type definitions for test data - matching what the query actually selects
type TestMachine = {
  id: string
  name: string
}

type TestSystemMetrics = {
  id: string
  timestamp: Date
}

interface TestVirtioService {
  sendSafeCommand: jest.MockedFunction<(machineId: string, command: { action: string }, timeout: number) => Promise<{ success: boolean }>>
}

interface JobWithPrivateMethods {
  checkStaleMetrics: () => Promise<void>
}

// Mock VirtioSocketWatcherService
const mockVirtioService: TestVirtioService = {
  sendSafeCommand: jest.fn()
}

jest.mock('../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: () => mockVirtioService
}))

describe('MetricsWatchdogJob', () => {
  let job: MetricsWatchdogJob
  let mockPrisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()
    job = new MetricsWatchdogJob(mockPrisma)
  })

  afterEach(() => {
    job.stop()
  })

  describe('checkStaleMetrics', () => {
    it('should handle no running VMs gracefully', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { status: 'running' },
        select: { id: true, name: true }
      })

      expect(mockPrisma.systemMetrics.findFirst).not.toHaveBeenCalled()
      expect(mockVirtioService.sendSafeCommand).not.toHaveBeenCalled()
    })

    it('should detect VMs with stale metrics and attempt to ping them', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Stale VM 1' },
        { id: 'vm2', name: 'Stale VM 2' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst.mockResolvedValue(null) // No recent metrics
      mockVirtioService.sendSafeCommand.mockResolvedValue({ success: true })

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Should check metrics for both VMs
      expect(mockPrisma.systemMetrics.findFirst).toHaveBeenCalledTimes(2)

      // Should warn about stale metrics
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Stale VM 1 (vm1) has no recent metrics')
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Stale VM 2 (vm2) has no recent metrics')
      )

      // Should attempt to ping both VMs
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledTimes(2)
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledWith(
        'vm1',
        { action: 'SystemInfo' },
        30000
      )
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledWith(
        'vm2',
        { action: 'SystemInfo' },
        30000
      )

      consoleWarnSpy.mockRestore()
    })

    it('should not ping VMs with recent metrics', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Fresh VM 1' },
        { id: 'vm2', name: 'Fresh VM 2' }
      ]

      const recentMetric: TestSystemMetrics = {
        id: 'metric1',
        timestamp: new Date() // Recent timestamp
      }

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst.mockResolvedValue(recentMetric as never)

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Should check metrics for both VMs
      expect(mockPrisma.systemMetrics.findFirst).toHaveBeenCalledTimes(2)

      // Should not warn or ping since metrics are recent
      expect(consoleWarnSpy).not.toHaveBeenCalled()
      expect(mockVirtioService.sendSafeCommand).not.toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })

    it('should handle ping failures gracefully', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Unreachable VM' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst.mockResolvedValue(null) // No recent metrics
      mockVirtioService.sendSafeCommand.mockRejectedValue(new Error('Connection failed'))

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Should warn about stale metrics
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Unreachable VM (vm1) has no recent metrics')
      )

      // Should attempt to ping
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledWith(
        'vm1',
        { action: 'SystemInfo' },
        30000
      )

      // Should log ping failure
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to ping VM Unreachable VM for metrics:'),
        expect.any(Error)
      )

      consoleWarnSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should use correct time threshold for stale detection', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Test VM' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst.mockResolvedValue(null)

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Verify the time threshold used (2 minutes = 120,000 ms)
      expect(mockPrisma.systemMetrics.findFirst).toHaveBeenCalledWith({
        where: {
          machineId: 'vm1',
          timestamp: {
            gte: expect.any(Date)
          }
        },
        orderBy: { timestamp: 'desc' }
      })

      // Check that the timestamp is approximately 2 minutes ago
      const call = mockPrisma.systemMetrics.findFirst.mock.calls[0]?.[0]
      if (call && call.where && call.where.timestamp && typeof call.where.timestamp === 'object' && 'gte' in call.where.timestamp) {
        const thresholdTime = call.where.timestamp.gte as Date
        const now = new Date()
        const timeDiff = now.getTime() - thresholdTime.getTime()

        // Should be approximately 2 minutes (120,000 ms), allow some tolerance
        expect(timeDiff).toBeGreaterThan(119000) // 1:59
        expect(timeDiff).toBeLessThan(121000) // 2:01
      } else {
        fail('Expected timestamp threshold to be a DateTimeFilter with gte property')
      }
    })

    it('should handle individual VM check errors gracefully', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Good VM' },
        { id: 'vm2', name: 'Error VM' }
      ]

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst
        .mockResolvedValueOnce(null) // vm1 - no recent metrics
        .mockRejectedValueOnce(new Error('Database error')) // vm2 - error

      mockVirtioService.sendSafeCommand.mockResolvedValue({ success: true })

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Should still process the good VM
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Good VM (vm1) has no recent metrics')
      )
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledWith(
        'vm1',
        { action: 'SystemInfo' },
        30000
      )

      // Should log error for the failing VM
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check metrics for VM Error VM'),
        expect.any(Error)
      )

      consoleWarnSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should count and report stale VMs correctly', async () => {
      const runningVMs: TestMachine[] = [
        { id: 'vm1', name: 'Stale VM 1' },
        { id: 'vm2', name: 'Fresh VM' },
        { id: 'vm3', name: 'Stale VM 2' }
      ]

      const recentMetric: TestSystemMetrics = { id: 'recent', timestamp: new Date() }

      mockPrisma.machine.findMany.mockResolvedValue(runningVMs as never[])
      mockPrisma.systemMetrics.findFirst
        .mockResolvedValueOnce(null) // vm1 - stale
        .mockResolvedValueOnce(recentMetric as never) // vm2 - fresh
        .mockResolvedValueOnce(null) // vm3 - stale

      mockVirtioService.sendSafeCommand.mockResolvedValue({ success: true })

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      const checkMethod = (job as unknown as JobWithPrivateMethods).checkStaleMetrics.bind(job)
      await checkMethod()

      // Should report 2 stale VMs
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 VMs with stale metrics')
      )

      // Should ping only the stale VMs
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalledTimes(2)

      consoleWarnSpy.mockRestore()
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
  })
})
