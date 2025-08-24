import { ProcessManager } from '@services/ProcessManager'
import { PrismaClient } from '@prisma/client'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import libvirtNode from '@infinibay/libvirt-node'

// Mock libvirt-node (auto-mocked from __mocks__ directory)
jest.mock('@infinibay/libvirt-node')

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
    const mockLibvirt = require('@infinibay/libvirt-node')
    mockLibvirt.__resetLibvirtMockState()
  })

  describe('listProcesses', () => {
    it('should list processes via VirtIO socket when available', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        status: 'running',
        os: 'linux'
      }

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

    it('should fall back to QEMU Guest Agent when VirtIO is not available', async () => {
      const machineId = 'test-vm-2'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockRejectedValue(new Error('No connection'))
      
      // Setup mock domain in libvirt
      const mockLibvirt = require('@infinibay/libvirt-node')
      const mockDomain = {
        name: 'test-vm',
        state: 'running',
        getState: jest.fn().mockReturnValue([1, 1])
      }
      mockLibvirt.__setLibvirtMockState({
        domains: new Map([['test-vm', mockDomain]])
      })
      
      // Mock GuestAgent exec to return process list
      const GuestAgentMock = mockLibvirt.GuestAgent as jest.MockedClass<any>
      GuestAgentMock.prototype.exec = jest.fn().mockReturnValue({
        stdout: 'user    1234  15.5  1.2  102400  51200 ?        S    10:00   0:01 node server.js\n' +
                'nginx   5678   2.3  0.5   51200  25600 ?        S    10:05   0:00 nginx -g daemon off;',
        stderr: ''
      })

      const result = await processManager.listProcesses(machineId)

      expect(result).toHaveLength(2)
      expect(result[0].pid).toBe(1234)
      expect(result[0].name).toBe('node')
      expect(GuestAgentMock.prototype.exec).toHaveBeenCalled()
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

    it('should fall back to QEMU Guest Agent for kill', async () => {
      const machineId = 'test-vm-1'
      const pid = 1234
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockMachine)
      ;(mockVirtioSocketWatcher.sendSafeCommand as jest.Mock).mockRejectedValue(new Error('No connection'))
      
      // Setup mock domain in libvirt
      const mockLibvirt = require('@infinibay/libvirt-node')
      const mockDomain = {
        name: 'test-vm',
        state: 'running',
        getState: jest.fn().mockReturnValue([1, 1])
      }
      mockLibvirt.__setLibvirtMockState({
        domains: new Map([['test-vm', mockDomain]])
      })
      
      // Mock GuestAgent exec to return success
      const GuestAgentMock = mockLibvirt.GuestAgent as jest.MockedClass<any>
      GuestAgentMock.prototype.exec = jest.fn().mockReturnValue({
        stdout: '',
        stderr: ''
      })

      const result = await processManager.killProcess(machineId, pid, false)

      expect(result).toEqual({
        success: true,
        message: `Process ${pid} terminated successfully`,
        pid
      })

      expect(GuestAgentMock.prototype.exec).toHaveBeenCalledWith(`kill ${pid}`, [], true)
    })
  })

  describe('getTopProcesses', () => {
    it('should return top processes sorted by CPU', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      const mockProcesses = [
        { pid: 1, name: 'low-cpu', cpu_usage: 5, memory_kb: 1000, status: 'running' },
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
    })

    it('should return top processes sorted by memory', async () => {
      const machineId = 'test-vm-1'
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
        status: 'running',
        os: 'linux'
      }

      const mockProcesses = [
        { pid: 1, name: 'low-mem', cpu_usage: 50, memory_kb: 1000, status: 'running' },
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
    })
  })

  describe('killProcesses', () => {
    it('should kill multiple processes', async () => {
      const machineId = 'test-vm-1'
      const pids = [1234, 5678]
      const mockMachine = {
        id: machineId,
        name: 'test-vm',
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