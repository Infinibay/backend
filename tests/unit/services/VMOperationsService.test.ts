import 'reflect-metadata'
import { VMOperationsService, VMOperationResult } from '../../../app/services/VMOperationsService'
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
  const specialCharsMachineId = 'vm@#$%^&*()'

  let machineFindUnique: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    // startMachine now reads Machine.status to refuse power-on during a disk op
    // (audit H1). Default the row to a stopped, non-disk-op status so existing
    // power tests pass through; the disk-op describe below overrides it.
    machineFindUnique = jest.fn().mockResolvedValue({ status: 'off' })
    mockPrisma = { machine: { findUnique: machineFindUnique } } as unknown as PrismaClient
    service = new VMOperationsService(mockPrisma)
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
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

    it('should handle empty machineId gracefully', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine(invalidMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid machine ID')
    })

    it('should handle special characters in machineId', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid characters in machine ID'))

      const result = await service.startMachine(specialCharsMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid characters in machine ID')
    })
  })

  describe('startMachine — disk-op refusal (audit H1)', () => {
    it.each(['backing_up', 'restoring', 'snapshotting'])(
      'refuses to start while a disk operation (%s) holds the row, without calling startVM',
      async (status) => {
        machineFindUnique.mockResolvedValueOnce({ status })

        const result = await service.startMachine(validMachineId)

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/disk operation in progress/i)
        expect(mockInfinization.startVM).not.toHaveBeenCalled()
      }
    )

    it('still starts when the row is in a normal stopped status', async () => {
      machineFindUnique.mockResolvedValueOnce({ status: 'off' })
      mockInfinization.startVM.mockResolvedValue({ success: true, message: 'ok' })

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.startVM).toHaveBeenCalledWith(validMachineId)
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

    it('should handle force power off failure when VM is stopped', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: false,
        error: 'VM is already stopped'
      })

      const result = await service.forcePowerOff(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM is already stopped')
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

    it('should handle graceful power off when VM is stopped', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: false,
        error: 'VM already stopped'
      })

      const result = await service.gracefulPowerOff(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toContain('VM already stopped')
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

    it('should handle reset exceptions', async () => {
      mockInfinization.resetVM.mockRejectedValue(new Error('Reset failed'))

      const result = await service.resetMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Reset failed')
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

    it('should handle suspend exceptions', async () => {
      mockInfinization.suspendVM.mockRejectedValue(new Error('Suspend failed'))

      const result = await service.suspendMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Suspend failed')
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

    it('should handle resume exceptions', async () => {
      mockInfinization.resumeVM.mockRejectedValue(new Error('Resume failed'))

      const result = await service.resumeMachine(validMachineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Resume failed')
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

    it('should handle empty machineId', async () => {
      mockInfinization.getVMStatus.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.getStatus(invalidMachineId)

      expect(result).toBeNull()
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent start and stop operations', async () => {
      mockInfinization.startVM.mockResolvedValue({ success: true, message: 'Started' })
      mockInfinization.stopVM.mockResolvedValue({ success: true, message: 'Stopped' })

      const [startResult, stopResult] = await Promise.all([
        service.startMachine(validMachineId),
        service.forcePowerOff(validMachineId)
      ])

      expect(startResult.success).toBe(true)
      expect(stopResult.success).toBe(true)
    })

    it('should handle multiple identical concurrent requests', async () => {
      mockInfinization.startVM.mockResolvedValue({ success: true, message: 'Started' })

      const results = await Promise.all([
        service.startMachine(validMachineId),
        service.startMachine(validMachineId),
        service.startMachine(validMachineId)
      ])

      expect(results.every(r => r.success)).toBe(true)
      expect(mockInfinization.startVM).toHaveBeenCalledTimes(3)
    })
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

    it('should handle machineId with whitespace', async () => {
      const whitespaceId = '  vm-123  '
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine(whitespaceId)

      expect(result.success).toBe(false)
    })

    it('should handle very long machineId', async () => {
      const longId = 'a'.repeat(1000)
      mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'))

      const result = await service.startMachine(longId)

      expect(result.success).toBe(false)
    })
  })

  describe('error message formatting', () => {
    it('should preserve error messages from infinization', async () => {
      mockInfinization.startVM.mockRejectedValue(
        new Error('Specific error message from service')
      )

      const result = await service.startMachine(validMachineId)

      expect(result.error).toBe('Specific error message from service')
    })

    it('should handle errors without messages', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error())

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(false)
    })

    it('should handle non-Error exceptions', async () => {
      mockInfinization.startVM.mockRejectedValue('String error')

      const result = await service.startMachine(validMachineId)

      expect(result.success).toBe(false)
      // Non-Error values don't have .message, so error will be undefined
      expect(result.error).toBeUndefined()
    })
  })

  describe('close', () => {
    it('should be a no-op for infinization', async () => {
      await expect(service.close()).resolves.toBeUndefined()
    })
  })
})
