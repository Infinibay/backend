import { ProcessResolver } from '@graphql/resolvers/ProcessResolver'
import { ProcessManager } from '@services/ProcessManager'
import { PrismaClient } from '@prisma/client'
import { mockDeep } from 'jest-mock-extended'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'

// Mock ProcessManager
jest.mock('@services/ProcessManager')

// Mock SocketService and EventManager to avoid side effects
jest.mock('@services/SocketService', () => ({
  getSocketService: jest.fn(() => ({
    sendToUser: jest.fn()
  }))
}))

jest.mock('@services/EventManager', () => ({
  getEventManager: jest.fn(() => ({
    dispatchEvent: jest.fn()
  }))
}))

describe('ProcessResolver', () => {
  let processResolver: ProcessResolver
  let mockProcessManager: jest.Mocked<ProcessManager>
  let mockContext: any

  beforeEach(() => {
    jest.clearAllMocks()

    processResolver = new ProcessResolver()

    const ctxPrisma = mockDeep<PrismaClient>()
    ctxPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' } as any)
    mockContext = {
      prisma: ctxPrisma,
      virtioSocketWatcher: mockDeep<VirtioSocketWatcherService>(),
      user: { id: 'user-1', role: 'USER' }
    }

    mockProcessManager = mockDeep<ProcessManager>()
    ;(ProcessManager as jest.Mock).mockImplementation(() => mockProcessManager)
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
