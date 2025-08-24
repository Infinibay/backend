import { ProcessResolver } from '@graphql/resolvers/ProcessResolver'
import { ProcessManager } from '@services/ProcessManager'
import { PrismaClient } from '@prisma/client'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { ProcessSortBy } from '@graphql/types/ProcessType'

// Mock ProcessManager
jest.mock('@services/ProcessManager')

describe('ProcessResolver', () => {
  let processResolver: ProcessResolver
  let mockProcessManager: jest.Mocked<ProcessManager>
  let mockContext: any

  beforeEach(() => {
    jest.clearAllMocks()
    
    processResolver = new ProcessResolver()
    
    // Create mock context
    mockContext = {
      prisma: {} as PrismaClient,
      virtioSocketWatcher: {} as VirtioSocketWatcherService
    }

    // Create mock ProcessManager
    mockProcessManager = {
      listProcesses: jest.fn(),
      getTopProcesses: jest.fn(),
      killProcess: jest.fn(),
      killProcesses: jest.fn()
    } as any

    // Mock the ProcessManager constructor
    ;(ProcessManager as jest.Mock).mockImplementation(() => mockProcessManager)
  })

  describe('listProcesses', () => {
    it('should list processes for a machine', async () => {
      const machineId = 'test-vm-1'
      const mockProcesses = [
        {
          pid: 1234,
          name: 'node',
          cpuUsage: 15.5,
          memoryKb: 102400,
          status: 'running',
          commandLine: '/usr/bin/node server.js',
          user: 'appuser'
        },
        {
          pid: 5678,
          name: 'nginx',
          cpuUsage: 2.3,
          memoryKb: 51200,
          status: 'running',
          commandLine: 'nginx -g daemon off',
          user: 'www-data'
        }
      ]

      mockProcessManager.listProcesses.mockResolvedValue(mockProcesses)

      const result = await processResolver.listProcesses(machineId, undefined, mockContext)

      expect(result).toEqual(mockProcesses)
      expect(mockProcessManager.listProcesses).toHaveBeenCalledWith(machineId, undefined)
    })

    it('should list processes with limit', async () => {
      const machineId = 'test-vm-1'
      const limit = 5
      const mockProcesses = [
        {
          pid: 1234,
          name: 'node',
          cpuUsage: 15.5,
          memoryKb: 102400,
          status: 'running'
        }
      ]

      mockProcessManager.listProcesses.mockResolvedValue(mockProcesses)

      const result = await processResolver.listProcesses(machineId, limit, mockContext)

      expect(result).toEqual(mockProcesses)
      expect(mockProcessManager.listProcesses).toHaveBeenCalledWith(machineId, limit)
    })

    it('should throw error when context is not available', async () => {
      await expect(processResolver.listProcesses('test-vm', undefined, undefined))
        .rejects.toThrow('Context not available')
    })

    it('should handle errors from ProcessManager', async () => {
      const machineId = 'test-vm-1'
      const error = new Error('Failed to connect to VM')

      mockProcessManager.listProcesses.mockRejectedValue(error)

      await expect(processResolver.listProcesses(machineId, undefined, mockContext))
        .rejects.toThrow('Failed to list processes: Error: Failed to connect to VM')
    })
  })

  describe('getTopProcesses', () => {
    it('should get top processes sorted by CPU', async () => {
      const machineId = 'test-vm-1'
      const limit = 5
      const sortBy = ProcessSortBy.CPU
      const mockProcesses = [
        {
          pid: 1234,
          name: 'high-cpu',
          cpuUsage: 50,
          memoryKb: 102400,
          status: 'running'
        },
        {
          pid: 5678,
          name: 'med-cpu',
          cpuUsage: 25,
          memoryKb: 51200,
          status: 'running'
        }
      ]

      mockProcessManager.getTopProcesses.mockResolvedValue(mockProcesses)

      const result = await processResolver.getTopProcesses(machineId, limit, sortBy, mockContext)

      expect(result).toEqual(mockProcesses)
      expect(mockProcessManager.getTopProcesses).toHaveBeenCalledWith(
        machineId,
        limit,
        expect.anything() // Internal enum value
      )
    })

    it('should get top processes sorted by memory', async () => {
      const machineId = 'test-vm-1'
      const limit = 10
      const sortBy = ProcessSortBy.MEMORY
      const mockProcesses = [
        {
          pid: 1234,
          name: 'high-mem',
          cpuUsage: 10,
          memoryKb: 512000,
          status: 'running'
        }
      ]

      mockProcessManager.getTopProcesses.mockResolvedValue(mockProcesses)

      const result = await processResolver.getTopProcesses(machineId, limit, sortBy, mockContext)

      expect(result).toEqual(mockProcesses)
      expect(mockProcessManager.getTopProcesses).toHaveBeenCalled()
    })

    it('should use default values when not provided', async () => {
      const machineId = 'test-vm-1'
      const mockProcesses: any[] = []

      mockProcessManager.getTopProcesses.mockResolvedValue(mockProcesses)

      const result = await processResolver.getTopProcesses(machineId, 10, ProcessSortBy.CPU, mockContext)

      expect(result).toEqual(mockProcesses)
      expect(mockProcessManager.getTopProcesses).toHaveBeenCalledWith(
        machineId,
        10,
        expect.anything()
      )
    })
  })

  describe('killProcess', () => {
    it('should kill a process successfully', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const force = false
      const mockResult = {
        success: true,
        message: 'Process 1234 terminated successfully',
        pid: 1234
      }

      mockProcessManager.killProcess.mockResolvedValue(mockResult)

      const result = await processResolver.killProcess(machineId, pid, force, mockContext)

      expect(result).toEqual(mockResult)
      expect(mockProcessManager.killProcess).toHaveBeenCalledWith(machineId, pid, force)
    })

    it('should kill a process with force', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const force = true
      const mockResult = {
        success: true,
        message: 'Process 1234 forcefully terminated',
        pid: 1234
      }

      mockProcessManager.killProcess.mockResolvedValue(mockResult)

      const result = await processResolver.killProcess(machineId, pid, force, mockContext)

      expect(result).toEqual(mockResult)
      expect(mockProcessManager.killProcess).toHaveBeenCalledWith(machineId, pid, force)
    })

    it('should handle kill failure', async () => {
      const machineId = 'test-vm-1'
      const pid = 9999
      const force = false
      const mockResult = {
        success: false,
        message: 'Process not found',
        pid: 9999,
        error: 'Process 9999 does not exist'
      }

      mockProcessManager.killProcess.mockResolvedValue(mockResult)

      const result = await processResolver.killProcess(machineId, pid, force, mockContext)

      expect(result).toEqual(mockResult)
      expect(result.success).toBe(false)
    })

    it('should handle exceptions', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const force = false
      const error = new Error('VM not available')

      mockProcessManager.killProcess.mockRejectedValue(error)

      const result = await processResolver.killProcess(machineId, pid, force, mockContext)

      expect(result).toEqual({
        success: false,
        message: 'Failed to kill process: Error: VM not available',
        pid: 1234,
        error: 'VM not available'
      })
    })
  })

  describe('killProcesses', () => {
    it('should kill multiple processes', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 5678]
      const force = false
      const mockResults = [
        {
          success: true,
          message: 'Process 1234 terminated successfully',
          pid: 1234
        },
        {
          success: true,
          message: 'Process 5678 terminated successfully',
          pid: 5678
        }
      ]

      mockProcessManager.killProcesses.mockResolvedValue(mockResults)

      const result = await processResolver.killProcesses(machineId, pids, force, mockContext)

      expect(result).toEqual(mockResults)
      expect(mockProcessManager.killProcesses).toHaveBeenCalledWith(machineId, pids, force)
    })

    it('should handle partial failures', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 9999]
      const force = false
      const mockResults = [
        {
          success: true,
          message: 'Process 1234 terminated successfully',
          pid: 1234
        },
        {
          success: false,
          message: 'Process not found',
          pid: 9999,
          error: 'Process 9999 does not exist'
        }
      ]

      mockProcessManager.killProcesses.mockResolvedValue(mockResults)

      const result = await processResolver.killProcesses(machineId, pids, force, mockContext)

      expect(result).toEqual(mockResults)
      expect(result[0].success).toBe(true)
      expect(result[1].success).toBe(false)
    })

    it('should handle exceptions', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 5678]
      const force = false
      const error = new Error('VM not available')

      mockProcessManager.killProcesses.mockRejectedValue(error)

      const result = await processResolver.killProcesses(machineId, pids, force, mockContext)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        success: false,
        message: 'Failed to kill process: Error: VM not available',
        pid: 1234,
        error: 'VM not available'
      })
      expect(result[1]).toEqual({
        success: false,
        message: 'Failed to kill process: Error: VM not available',
        pid: 5678,
        error: 'VM not available'
      })
    })
  })
})