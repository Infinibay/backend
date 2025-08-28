import { ProcessManager } from '@services/ProcessManager'
import { PrismaClient } from '@prisma/client'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'

// Mock libvirt-node (auto-mocked from __mocks__ directory)
jest.mock('libvirt-node')

// Mock getLibvirtConnection
jest.mock('@utils/libvirt', () => ({
  getLibvirtConnection: jest.fn(() => Promise.resolve({}))
}))

// Mock Prisma
const mockPrisma = {
  machine: {
    findUnique: jest.fn()
  }
} as unknown as PrismaClient

// Mock VirtioSocketWatcherService
const mockVirtioSocketWatcher = {
  sendSafeCommand: jest.fn(),
  sendProcessCommand: jest.fn()
} as unknown as VirtioSocketWatcherService

describe('ProcessManager', () => {
  let processManager: ProcessManager

  beforeEach(() => {
    jest.clearAllMocks()
    
    processManager = new ProcessManager(mockPrisma, mockVirtioSocketWatcher)
    
    // Reset libvirt mock state
    const mockLibvirt = require('libvirt-node')
    if (mockLibvirt.__resetLibvirtMockState) {
      mockLibvirt.__resetLibvirtMockState()
    }
    // Clear Machine lookups
    if (mockLibvirt.Machine) {
      mockLibvirt.Machine.lookupByName.mockClear()
      mockLibvirt.Machine.lookupByUuidString.mockClear()
    }
  })

  describe('listProcesses', () => {
    it('should list processes via VirtIO socket when available', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }
      
      // Setup mock domain
      const mockDomain = {
        name: 'test-vm',
        state: 'running',
        getState: jest.fn().mockReturnValue({ result: 1 })
      }
      
      // Mock Machine.lookupByName to return the domain
      const mockLibvirt = require('libvirt-node')
      mockLibvirt.Machine.lookupByName.mockReturnValue(mockDomain)

      const mockProcesses = [
        {
          pid: 1234,
          name: 'node',
          cpu_usage: 15.5,
          memory_kb: 102400,
          status: 'running'
        },
        {
          pid: 5678,
          name: 'nginx',
          cpu_usage: 2.3,
          memory_kb: 51200,
          status: 'running'
        }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: true,
        data: mockProcesses
      })

      const result = await processManager.listProcesses(machineId)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        pid: 1234,
        name: 'node',
        cpuUsage: 15.5,
        memoryKb: 102400,
        status: 'running',
        commandLine: undefined,
        user: undefined,
        startTime: undefined
      })

      expect(mockVirtioSocketWatcher.sendSafeCommand).toHaveBeenCalledWith(
        machineId,
        { action: 'ProcessList', params: undefined },
        30000
      )
    })

    it('should throw error when VirtIO is not available', async () => {
      const machineId = 'test-vm-2'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }
      
      // Setup mock domain
      const mockDomain2 = {
        name: 'test-vm',
        state: 'running',
        getState: jest.fn().mockReturnValue({ result: 1 })
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: false,
        error: 'InfiniService not available'
      })
      
      // Setup mock domain in libvirt
      const mockLibvirt = require('libvirt-node')
      mockLibvirt.Machine.lookupByName.mockReturnValue(mockDomain2)
      mockLibvirt.__setLibvirtMockState({
        domains: new Map([['test-vm', mockDomain2]])
      })

      await expect(processManager.listProcesses(machineId))
        .rejects.toThrow('Failed to get process list: InfiniService not available')
    })

    it('should throw error when machine is not found', async () => {
      const machineId = 'non-existent'
      
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(processManager.listProcesses(machineId))
        .rejects.toThrow(`Machine ${machineId} is not available`)
    })

    it('should throw error when machine is not running', async () => {
      const machineId = 'stopped-vm'
      const mockMachine = {
        id: machineId,
        name: 'stopped-vm',
        status: 'stopped',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)

      await expect(processManager.listProcesses(machineId))
        .rejects.toThrow(`Machine ${machineId} is not available`)
    })
  })

  describe('killProcess', () => {
    it('should kill a process successfully via VirtIO', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: true
      })

      const result = await processManager.killProcess(machineId, pid, false)

      expect(result).toEqual({
        success: true,
        message: `Process ${pid} terminated successfully`,
        pid
      })

      expect(mockVirtioSocketWatcher.sendSafeCommand).toHaveBeenCalledWith(
        machineId,
        { action: 'ProcessKill', params: { pid, force: false } },
        30000
      )
    })

    it('should handle kill failure gracefully', async () => {
      const machineId = 'test-vm-1'
      const pid = 9999
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Process not found'
      })

      const result = await processManager.killProcess(machineId, pid, false)

      expect(result).toEqual({
        success: false,
        message: 'Process not found',
        pid,
        error: 'Process not found'
      })
    })

    it('should return error when VirtIO is not available for kill', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: false,
        error: 'InfiniService not available'
      })
      
      // Setup mock domain in libvirt
      const mockLibvirt = require('libvirt-node')
      const mockDomain3 = {
        name: 'test-vm',
        state: 'running',
        getState: jest.fn().mockReturnValue({ result: 1 })
      }
      mockLibvirt.Machine.lookupByName.mockReturnValue(mockDomain3)
      mockLibvirt.__setLibvirtMockState({
        domains: new Map([['test-vm', mockDomain3]])
      })

      const result = await processManager.killProcess(machineId, pid, false)

      expect(result).toEqual({
        success: false,
        message: 'InfiniService not available',
        pid,
        error: 'InfiniService not available'
      })
    })
  })

  describe('getTopProcesses', () => {
    it('should return top processes sorted by CPU', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      // Mock VirtIO service returning already sorted and limited processes
      const mockProcesses = [
        { pid: 2, name: 'high-cpu', cpu_usage: 50, memory_kb: 2000, status: 'running' },
        { pid: 3, name: 'med-cpu', cpu_usage: 25, memory_kb: 3000, status: 'running' }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: true,
        data: mockProcesses
      })

      const result = await processManager.getTopProcesses(machineId, 2)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('high-cpu')
      expect(result[1].name).toBe('med-cpu')
      
      // Verify the command was sent with correct params
      expect(mockVirtioSocketWatcher.sendSafeCommand).toHaveBeenCalledWith(
        machineId,
        { action: 'ProcessTop', params: { limit: 2, sort_by: 'cpu' } },
        30000
      )
    })

    it('should return top processes sorted by memory', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      // Mock VirtIO service returning already sorted and limited processes by memory
      const mockProcesses = [
        { pid: 2, name: 'high-mem', cpu_usage: 5, memory_kb: 5000, status: 'running' },
        { pid: 3, name: 'med-mem', cpu_usage: 25, memory_kb: 3000, status: 'running' }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockResolvedValue({
        success: true,
        data: mockProcesses
      })

      const { ProcessSortBy } = require('@services/ProcessManager')
      const result = await processManager.getTopProcesses(machineId, 2, ProcessSortBy.MEMORY)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('high-mem')
      expect(result[1].name).toBe('med-mem')
      
      // Verify the command was sent with correct params
      expect(mockVirtioSocketWatcher.sendSafeCommand).toHaveBeenCalledWith(
        machineId,
        { action: 'ProcessTop', params: { limit: 2, sort_by: 'memory' } },
        30000
      )
    })
  })

  describe('killProcesses', () => {
    it('should kill multiple processes', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 5678]
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true })

      const results = await processManager.killProcesses(machineId, pids, false)

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
      expect(mockVirtioSocketWatcher.sendSafeCommand).toHaveBeenCalledTimes(2)
    })

    it('should handle partial failures when killing multiple processes', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 9999]
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        internalName: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Process not found' })

      const results = await processManager.killProcesses(machineId, pids, false)

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[1].error).toBe('Process not found')
    })
  })
})