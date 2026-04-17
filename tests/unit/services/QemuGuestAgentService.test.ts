import 'reflect-metadata'
import { QemuGuestAgentService } from '@services/QemuGuestAgentService'
import { getInfinization } from '@services/InfinizationService'
import { Infinization } from '@infinibay/infinization'

// Mock dependencies
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn()
}))

jest.mock('@main/logger', () => {
  const mockChild = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  }
  return {
    __esModule: true,
    default: {
      ...mockChild,
      child: jest.fn(() => mockChild)
    }
  }
})

// Reference to the mock for assertions (child logger methods)
// The mock is created inside jest.mock, so we get a reference via importing the mocked module
import logger from '@main/logger'
const mockDebugLog = logger.child({}) as jest.Mocked<typeof logger>

const mockVirshCommand = (vmId: string, command: string, args: string[]): string => {
  const guestExecCmd = {
    execute: 'guest-exec',
    arguments: {
      path: command,
      arg: args,
      'capture-output': true
    }
  }
  return `virsh qemu-agent-command ${vmId} '${JSON.stringify(guestExecCmd)}'`
}

describe('QemuGuestAgentService', () => {
  let service: QemuGuestAgentService
  let mockInfinization: any
  const validVmId = 'test-vm-123'

  // Helper to create proper VM status mocks with all required fields
  const createVMStatusMock = (
    vmId: string = 'test-vm-123',
    status: string = 'running',
    processAlive: boolean = true
  ) => ({
    vmId,
    qmpStatus: 'connected',
    pid: 12345,
    uptime: 3600,
    status,
    processAlive,
    consistent: true
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockInfinization = {
      getVMStatus: jest.fn(),
      qemuAgentCommand: jest.fn()
    } as any

    ;(getInfinization as jest.Mock).mockResolvedValue(mockInfinization)
    service = new QemuGuestAgentService()
  })

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await service.initialize()
      expect(getInfinization).toHaveBeenCalled()
      expect(mockDebugLog.info).toHaveBeenCalledWith(
        'QEMU Guest Agent Service initialized'
      )
    })

  describe('executeCommand', () => {
    beforeEach(() => {
      // Mock the infinization instance after initialization
      service['infinization'] = mockInfinization
    })

    describe('VM running checks', () => {
      it('should return guidance when VM is running', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(
          validVmId,
          'systemctl',
          ['status', 'infiniservice']
        )

        expect(mockInfinization.getVMStatus).toHaveBeenCalledWith(validVmId)
        expect(result.success).toBe(false)
        expect(result.error).toContain('QEMU Guest Agent commands not yet supported')
        expect(result.output).toContain('virsh qemu-agent-command')
      })

      it('should reject command if VM is not running', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'stopped',
          processAlive: false,
          consistent: false
        })

        const result = await service.executeCommand(
          validVmId,
          'systemctl',
          ['status', 'infiniservice']
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe(`VM ${validVmId} is not running`)
        expect(mockInfinization.qemuAgentCommand).not.toHaveBeenCalled()
      })
    })

    describe('command validation', () => {
      it('should handle empty command', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(validVmId, '')
        expect(result.success).toBe(false)
      })

      it('should handle null command', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(validVmId, '' as any)
        expect(result.success).toBe(false)
      })

      it('should handle whitespace-only command', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(validVmId, '   ')
        expect(result.success).toBe(false)
      })

      it('should generate valid virsh command format', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(
          validVmId,
          'systemctl',
          ['status', 'infiniservice']
        )

        expect(result.output).toContain(`virsh qemu-agent-command ${validVmId}`)
        expect(result.output).toContain('guest-exec')
        expect(result.output).toContain('systemctl')
        expect(result.output).toContain('infiniservice')
      })
    })

    describe('edge cases', () => {
      it('should handle empty VM ID', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand('', 'ls')
        expect(result.success).toBe(false)
      })

      it('should handle very long VM ID', async () => {
        const longVmId = 'a'.repeat(1000)
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(longVmId, 'ls')
        expect(result.success).toBe(false)
        expect(result.output).toContain(longVmId)
      })

      it('should handle special characters in command', async () => {
        mockInfinization.getVMStatus.mockResolvedValue({
          status: 'running',
          processAlive: true,
          consistent: true
        })

        const result = await service.executeCommand(
          validVmId,
          'echo $HOME',
          ['|', 'grep', 'test']
        )
        expect(result.success).toBe(false)
        expect(result.output).toContain('echo')
      })
    })

    describe('service not initialized', () => {
      it('should throw error if not initialized', async () => {
        const newService = new QemuGuestAgentService()
        await expect(
          newService.executeCommand(validVmId, 'test')
        ).rejects.toThrow('Service not initialized')
      })
    })
  })

  describe('checkInfiniService', () => {
    const vmId = 'test-vm-123'

    beforeEach(() => {
      service['infinization'] = mockInfinization
    })

    it('should return diagnostics when service is not running', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.checkInfiniService(vmId)

      expect(result.installed).toBe(false)
      expect(result.running).toBe(false)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0]).toContain('Diagnostic commands to run manually')
    })

    it('should provide helpful diagnostic commands', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.checkInfiniService(vmId)

      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('1. Check if InfiniService is installed')
      )
      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('2. Check if socket file exists in VM')
      )
      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('3. Check InfiniService logs')
      )
      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('4. Check if virtio-serial device is available')
      )
      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('5. Install InfiniService if missing')
      )
    })

    it('should handle exceptions during check', async () => {
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Connection failed')
      )

      const result = await service.checkInfiniService(vmId)

      expect(result.installed).toBe(false)
      expect(result.running).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('getSystemInfo', () => {
    const vmId = 'test-vm-123'

    beforeEach(() => {
      service['infinization'] = mockInfinization
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })
    })

    it('should collect system information when all commands succeed', async () => {
      const mockExecuteCommand = jest.spyOn(
        service,
        'executeCommand' as any
      )

      mockExecuteCommand.mockResolvedValueOnce({
        success: true,
        output: 'test-vm-hostname'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: true,
        output: 'Linux 5.15.0-91-generic'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: true,
        output: 'Ubuntu 22.04 LTS'
      })

      const result = await service.getSystemInfo(vmId)

      expect(result.success).toBe(true)
      expect(result.info?.hostname).toBe('test-vm-hostname')
      expect(result.info?.kernel).toBe('Linux 5.15.0-91-generic')
      expect(result.info?.os).toBe('Ubuntu 22.04 LTS')

      mockExecuteCommand.mockRestore()
    })

    it('should return error when no commands succeed', async () => {
      const mockExecuteCommand = jest.spyOn(
        service,
        'executeCommand' as any
      )

      mockExecuteCommand.mockResolvedValueOnce({
        success: false,
        error: 'Command failed'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: false,
        error: 'Command failed'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: false,
        error: 'Command failed'
      })

      const result = await service.getSystemInfo(vmId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Command failed')

      mockExecuteCommand.mockRestore()
    })

    it('should collect partial information when some commands fail', async () => {
      const mockExecuteCommand = jest.spyOn(
        service,
        'executeCommand' as any
      )

      mockExecuteCommand.mockResolvedValueOnce({
        success: true,
        output: 'test-host'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: false,
        error: 'Failed'
      })
      mockExecuteCommand.mockResolvedValueOnce({
        success: true,
        output: 'Ubuntu 22.04'
      })

      const result = await service.getSystemInfo(vmId)

      expect(result.success).toBe(true)
      expect(result.info?.hostname).toBe('test-host')
      expect(result.info?.os).toBe('Ubuntu 22.04')
      expect(result.info?.kernel).toBeUndefined()

      mockExecuteCommand.mockRestore()
    })

    it('should handle exceptions during system info collection', async () => {
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Network error')
      )

      const result = await service.getSystemInfo(vmId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  describe('diagnoseSocketIssues', () => {
    const vmId = 'test-vm-123'

    beforeEach(() => {
      service['infinization'] = mockInfinization
    })

    it('should provide comprehensive diagnostics when VM is running', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.diagnoseSocketIssues(vmId)

      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.recommendations.length).toBeGreaterThan(0)
      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('VM State: Running')
      )
      expect(result.recommendations).toContainEqual(
        expect.stringContaining('EACCES (Permission Denied):')
      )
      expect(result.recommendations).toContainEqual(
        expect.stringContaining('ECONNREFUSED (Connection Refused):')
      )
      expect(result.recommendations).toContainEqual(
        expect.stringContaining('ENOENT (No Such File):')
      )
    })

    it('should handle non-running VM gracefully', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'stopped',
        processAlive: false,
        consistent: false
      })

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.diagnoseSocketIssues(vmId)

      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('VM State: stopped')
      )
      expect(result.recommendations).toContainEqual(
        expect.stringContaining('• VM is not running')
      )
    })

    it('should handle VM not found scenario', async () => {
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('VM not found')
      )

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.diagnoseSocketIssues(vmId)

      expect(result.diagnostics).toContainEqual(
        expect.stringContaining('VM State: Error checking')
      )
      expect(result.recommendations).toContainEqual(
        expect.stringContaining('• VM not found')
      )
    })

    it('should include socket file path in diagnostics', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      mockInfinization.qemuAgentCommand.mockRejectedValue(
        new Error('Not implemented')
      )

      const result = await service.diagnoseSocketIssues(vmId)

      expect(result.diagnostics).toContainEqual(
        expect.stringContaining(
          `1. Host socket path: /opt/infinibay/sockets/${vmId}.socket`
        )
      )
    })
  })

  describe('getStateName', () => {
    it('should return correct state name for valid state numbers', () => {
      const states = [
        { code: 0, name: 'No State' },
        { code: 1, name: 'Running' },
        { code: 2, name: 'Blocked' },
        { code: 3, name: 'Paused' },
        { code: 4, name: 'Shutdown' },
        { code: 5, name: 'Shutoff' },
        { code: 6, name: 'Crashed' },
        { code: 7, name: 'PM Suspended' }
      ]

      states.forEach(({ code, name }) => {
        const result = (service as any).getStateName(code)
        expect(result).toBe(name)
      })
    })

    it('should return unknown state for invalid state numbers', () => {
      const result = (service as any).getStateName(999)
      expect(result).toBe('Unknown (999)')
    })
  })

  describe('buildVirshCommand', () => {
    it('should build correct virsh command for guest-exec', () => {
      const result = (service as any).buildVirshCommand(
        'test-vm',
        'systemctl',
        ['status', 'infiniservice']
      )

      expect(result).toContain('virsh qemu-agent-command')
      expect(result).toContain('test-vm')
      expect(result).toContain('guest-exec')
      expect(result).toContain('systemctl')
    })

    it('should properly escape command arguments', () => {
      const result = (service as any).buildVirshCommand(
        'test-vm',
        'bash',
        ['-c', 'echo "Hello World"']
      )

      expect(result).toContain(
        JSON.stringify({
          execute: 'guest-exec',
          arguments: {
            path: 'bash',
            arg: ['-c', 'echo "Hello World"'],
            'capture-output': true
          }
        })
      )
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle empty VM ID', async () => {
      service['infinization'] = mockInfinization
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Invalid VM ID')
      )

      const result = await service.executeCommand('', 'test', [])

      expect(result.success).toBe(false)
    })

    it('should handle VM ID with special characters', async () => {
      service['infinization'] = mockInfinization
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Invalid VM ID')
      )

      const result = await service.executeCommand('vm-with-special-chars_123', 'test', [])

      expect(result.success).toBe(false)
    })

    it('should handle very long commands', async () => {
      service['infinization'] = mockInfinization
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Command too long')
      )

      const longCmd = 'a'.repeat(10000)
      const result = await service.executeCommand(
        'test-vm',
        longCmd,
        ['arg1', 'arg2']
      )

      expect(result.success).toBe(false)
    })

    it('should handle null or undefined arguments', async () => {
      service['infinization'] = mockInfinization
      mockInfinization.getVMStatus.mockRejectedValue(
        new Error('Test')
      )

      const result1 = await service.executeCommand('test-vm', 'command')
      expect(result1.success).toBe(false)

      const result2 = await service.executeCommand(
        'test-vm',
        'command',
        undefined as any
      )
      expect(result2.success).toBe(false)
    })
  })

  describe('integration scenarios', () => {
    it('should handle multi-step diagnostic workflow', async () => {
      service['infinization'] = mockInfinization
      
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      // Mock executeCommand to return partial results
      const executeSpy = jest.spyOn(
        service,
        'executeCommand' as any
      )
      
      executeSpy.mockImplementation((vmId: any, cmd: any) => {
        if (cmd === 'hostname') {
          return Promise.resolve({ success: true, output: 'test-host' })
        }
        if (cmd === 'uname') {
          return Promise.resolve({ success: false, error: 'Failed' })
        }
        if (cmd === 'cat') {
          return Promise.resolve({ success: true, output: 'Ubuntu 22.04' })
        }
        return Promise.resolve({ success: false, error: 'Unknown command' })
      })

      const systemInfo = await service.getSystemInfo('test-vm')
      expect(systemInfo.success).toBe(true)
      expect(systemInfo.info?.hostname).toBe('test-host')
      expect(systemInfo.info?.kernel).toBeUndefined()
      expect(systemInfo.info?.os).toBe('Ubuntu 22.04')

      executeSpy.mockRestore()
    })

    it('should handle complete socket diagnostic workflow', async () => {
      service['infinization'] = mockInfinization
      
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      const result = await service.diagnoseSocketIssues('test-vm')

      expect(result.diagnostics.length).toBeGreaterThan(5)
      expect(result.recommendations.length).toBeGreaterThan(5)
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.stringContaining('VM ID: test-vm'),
        expect.stringContaining('Timestamp'),
        expect.stringContaining('VM State: Running'),
        expect.stringContaining('Socket File Checks')
      ]))

      expect(result.recommendations).toEqual(expect.arrayContaining([
        expect.stringContaining('EACCES'),
        expect.stringContaining('ECONNREFUSED'),
        expect.stringContaining('ENOENT')
      ]))
    })
  })
})
})
