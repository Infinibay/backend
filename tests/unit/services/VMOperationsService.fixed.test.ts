import 'reflect-metadata'
import { VMOperationsService } from '../../../app/services/VMOperationsService'
import { PrismaClient } from '@prisma/client'

// Mock InfinizationService
import logger from '@main/logger'
const mockInfinization = {
  startVM: jest.fn(),
  stopVM: jest.fn(),
  restartVM: jest.fn(),
  resetVM: jest.fn(),
  suspendVM: jest.fn(),
  resumeVM: jest.fn(),
  getVMStatus: jest.fn(),
  gracefulShutdown: jest.fn()
}

jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}))

describe('VMOperationsService', () => {
  let service: VMOperationsService
  let mockPrisma: PrismaClient
  const validMachineId = 'vm-123'
  const invalidMachineId = ''

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {} as PrismaClient
    service = new VMOperationsService(mockPrisma)
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('startMachine', () => {
    it('should successfully start a machine', async () => {
      mockInfinization.startVM.mockResolvedValue({
        success: true,
        message: 'VM started successfully'
      })

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(result.message).toBe('VM started successfully')
      expect(mockInfinization.startVM).toHaveBeenCalledWith(validMachineId)
      expect(result.error).toBeUndefined()
    })

    it('should handle start failure with error message', async () => {
      mockInfinization.startVM.mockResolvedValue({
        success: false,
        error: 'VM already running'
      })

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM already running')
      expect(result.message).toBeUndefined()
    })

    it('should handle exceptions and return error', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Connection failed'))

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection failed')
    })
  })

  describe('forcePowerOff', () => {
    it('should successfully force power off a machine', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: true,
        message: 'VM forcefully stopped'
      })

      const result = await service.forcePowerOff(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.stopVM).toHaveBeenCalledWith(validMachineId, {
        graceful: false,
        force: true
      })
    })

    it('should handle force power off failure when VM not found', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: false,
        error: 'VM not found'
      })

      const result = await service.forcePowerOff(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM not found')
    })

    it('should handle exceptions during force power off', async () => {
      mockInfinization.stopVM.mockRejectedValue(new Error('Libvirt connection error'))

      const result = await service.forcePowerOff(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Libvirt connection error')
    })
  })

  describe('gracefulPowerOff', () => {
    const machineId = 'vm-123'

    it('should successfully gracefully power off a machine', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: true,
        message: 'VM powered off'
      })

      const result = await service.gracefulPowerOff(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.stopVM).toHaveBeenCalledWith(machineId, {
        graceful: true,
        timeout: 120000,
        force: true
      })
    })

    it('should handle graceful shutdown timeout', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: false,
        error: 'Shutdown timeout'
      })

      const result = await service.gracefulPowerOff(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Shutdown timeout')
    })
  })

  describe('restartMachine', () => {
    it('should successfully restart a machine', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted successfully'
      })

      const result = await service.restartMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.restartVM).toHaveBeenCalledWith(validMachineId)
    })

    it('should handle restart failure when VM is stopped', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: false,
        error: 'Cannot restart stopped VM'
      })

      const result = await service.restartMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Cannot restart stopped VM')
    })

    it('should handle restart exceptions', async () => {
      mockInfinization.restartVM.mockRejectedValue(new Error('Restart service unavailable'))

      const result = await service.restartMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Restart service unavailable')
    })
  })

  describe('resetMachine', () => {
    it('should successfully reset a machine', async () => {
      mockInfinization.resetVM.mockResolvedValue({
        success: true,
        message: 'VM hardware reset successfully'
      })

      const result = await service.resetMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.resetVM).toHaveBeenCalledWith(validMachineId)
    })

    it('should handle reset failure when VM is not running', async () => {
      mockInfinization.resetVM.mockResolvedValue({
        success: false,
        error: 'VM must be running to reset'
      })

      const result = await service.resetMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM must be running to reset')
    })
  })

  describe('suspendMachine', () => {
    it('should successfully suspend a machine', async () => {
      mockInfinization.suspendVM.mockResolvedValue({
        success: true,
        message: 'VM suspended successfully'
      })

      const result = await service.suspendMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.suspendVM).toHaveBeenCalledWith(validMachineId)
    })

    it('should handle suspend failure when VM is already paused', async () => {
      mockInfinization.suspendVM.mockResolvedValue({
        success: false,
        error: 'VM is already suspended'
      })

      const result = await service.suspendMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM is already suspended')
    })
  })

  describe('resumeMachine', () => {
    it('should successfully resume a machine', async () => {
      mockInfinization.resumeVM.mockResolvedValue({
        success: true,
        message: 'VM resumed successfully'
      })

      const result = await service.resumeMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.resumeVM).toHaveBeenCalledWith(validMachineId)
    })

    it('should handle resume failure when VM is not suspended', async () => {
      mockInfinization.resumeVM.mockResolvedValue({
        success: false,
        error: 'VM is not suspended'
      })

      const result = await service.resumeMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM is not suspended')
    })
  })

  describe('getStatus', () => {
    it('should return VM status when running', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      const result = await service.getStatus(validMachineId)

      expect(result).toEqual({
        status: 'running',
        processAlive: true,
        consistent: true
      })
    })

    it('should return VM status when stopped', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
        status: 'stopped',
        processAlive: false,
        consistent: true
      })

      const result = await service.getStatus(validMachineId)

      expect(result).toEqual({
        status: 'stopped',
        processAlive: false,
        consistent: true
      })
    })

    it('should return null on error', async () => {
      mockInfinization.getVMStatus.mockRejectedValue(new Error('Failed'))

      const result = await service.getStatus(validMachineId)

      expect(result).toBeNull()
    })
  })

  describe('performGracefulRestart', () => {
    it('should restart on first attempt if successful', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted'
      })

      const result = await service.performGracefulRestart(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.restartVM).toHaveBeenCalledTimes(1)
    })

    it('should retry up to maxRetries on failure and fallback to force power off', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: false,
        error: 'Restart failed'
      })
      mockInfinization.stopVM.mockResolvedValue({
        success: true,
        message: 'VM stopped'
      })
      mockInfinization.startVM.mockResolvedValue({
        success: true,
        message: 'VM started'
      })

      const result = await service.performGracefulRestart(validMachineId, 2)

      expect(mockInfinization.restartVM).toHaveBeenCalledTimes(2)
      expect(mockInfinization.stopVM).toHaveBeenCalledTimes(1)
      expect(mockInfinization.startVM).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
    }, 15000)

    it('should fail gracefully when all retries exhausted and force power off also fails', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: false,
        error: 'Restart failed'
      })
      mockInfinization.stopVM.mockResolvedValue({
        success: false,
        error: 'Force power off failed'
      })

      const result = await service.performGracefulRestart(validMachineId, 2)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Force power off failed')
    }, 15000)
  })

  describe('edge cases', () => {
    it('should handle null machineId', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine(null as any)

      expect(result.success).toBe(false)
    })

    it('should handle undefined machineId', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine(undefined as any)

      expect(result.success).toBe(false)
    })

    it('should handle empty string machineId', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine('')

      expect(result.success).toBe(false)
    })

    it('should handle non-Error exceptions', async () => {
      mockInfinization.startVM.mockRejectedValue('String error')

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(false)
      // String exceptions don't have .message property in JavaScript
      expect(result.error).toBeUndefined()
    })
  })

  describe('close', () => {
    it('should be a no-op for infinization', async () => {
      await expect(service.close()).resolves.toBeUndefined()
    })
  })
})
