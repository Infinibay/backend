import 'reflect-metadata'
import { VMOperationsService } from '../../../app/services/VMOperationsService'
import { PrismaClient } from '@prisma/client'

// Mock InfinivirtService
const mockInfinivirt = {
  startVM: jest.fn(),
  stopVM: jest.fn(),
  restartVM: jest.fn(),
  resetVM: jest.fn(),
  suspendVM: jest.fn(),
  resumeVM: jest.fn(),
  getVMStatus: jest.fn()
}

jest.mock('../../../app/services/InfinivirtService', () => ({
  getInfinivirt: jest.fn(() => Promise.resolve(mockInfinivirt))
}))

describe('VMOperationsService', () => {
  let service: VMOperationsService
  let mockPrisma: PrismaClient

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = {} as PrismaClient
    service = new VMOperationsService(mockPrisma)
  })

  describe('startMachine', () => {
    const machineId = 'vm-123'

    it('should successfully start a machine', async () => {
      mockInfinivirt.startVM.mockResolvedValue({
        success: true,
        message: 'VM started successfully'
      })

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(true)
      expect(result.message).toBe('VM started successfully')
      expect(mockInfinivirt.startVM).toHaveBeenCalledWith(machineId)
    })

    it('should handle start failure', async () => {
      mockInfinivirt.startVM.mockResolvedValue({
        success: false,
        error: 'VM already running'
      })

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM already running')
    })

    it('should handle exceptions', async () => {
      mockInfinivirt.startVM.mockRejectedValue(new Error('Connection failed'))

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection failed')
    })
  })

  describe('forcePowerOff', () => {
    const machineId = 'vm-123'

    it('should successfully force power off a machine', async () => {
      mockInfinivirt.stopVM.mockResolvedValue({
        success: true,
        message: 'VM forcefully stopped'
      })

      const result = await service.forcePowerOff(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.stopVM).toHaveBeenCalledWith(machineId, {
        graceful: false,
        force: true
      })
    })

    it('should handle force power off failure', async () => {
      mockInfinivirt.stopVM.mockResolvedValue({
        success: false,
        error: 'VM not found'
      })

      const result = await service.forcePowerOff(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM not found')
    })
  })

  describe('gracefulPowerOff', () => {
    const machineId = 'vm-123'

    it('should successfully gracefully power off a machine', async () => {
      mockInfinivirt.stopVM.mockResolvedValue({
        success: true,
        message: 'VM powered off'
      })

      const result = await service.gracefulPowerOff(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.stopVM).toHaveBeenCalledWith(machineId, {
        graceful: true,
        timeout: 30000,
        force: true
      })
    })
  })

  describe('restartMachine', () => {
    const machineId = 'vm-123'

    it('should successfully restart a machine', async () => {
      mockInfinivirt.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted'
      })

      const result = await service.restartMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.restartVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('resetMachine', () => {
    const machineId = 'vm-123'

    it('should successfully reset a machine', async () => {
      mockInfinivirt.resetVM.mockResolvedValue({
        success: true,
        message: 'VM reset'
      })

      const result = await service.resetMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.resetVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('suspendMachine', () => {
    const machineId = 'vm-123'

    it('should successfully suspend a machine', async () => {
      mockInfinivirt.suspendVM.mockResolvedValue({
        success: true,
        message: 'VM suspended'
      })

      const result = await service.suspendMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.suspendVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('resumeMachine', () => {
    const machineId = 'vm-123'

    it('should successfully resume a machine', async () => {
      mockInfinivirt.resumeVM.mockResolvedValue({
        success: true,
        message: 'VM resumed'
      })

      const result = await service.resumeMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.resumeVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('getStatus', () => {
    const machineId = 'vm-123'

    it('should return VM status', async () => {
      mockInfinivirt.getVMStatus.mockResolvedValue({
        status: 'running',
        processAlive: true,
        consistent: true
      })

      const result = await service.getStatus(machineId)

      expect(result).toEqual({
        status: 'running',
        processAlive: true,
        consistent: true
      })
    })

    it('should return null on error', async () => {
      mockInfinivirt.getVMStatus.mockRejectedValue(new Error('Failed'))

      const result = await service.getStatus(machineId)

      expect(result).toBeNull()
    })
  })

  describe('performGracefulRestart', () => {
    const machineId = 'vm-123'

    it('should restart on first attempt if successful', async () => {
      mockInfinivirt.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted'
      })

      const result = await service.performGracefulRestart(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinivirt.restartVM).toHaveBeenCalledTimes(1)
    })

    it('should retry up to maxRetries on failure', async () => {
      mockInfinivirt.restartVM.mockResolvedValue({
        success: false,
        error: 'Restart failed'
      })
      mockInfinivirt.stopVM.mockResolvedValue({
        success: true,
        message: 'VM stopped'
      })
      mockInfinivirt.startVM.mockResolvedValue({
        success: true,
        message: 'VM started'
      })

      const result = await service.performGracefulRestart(machineId, 2)

      // 2 restart attempts + 1 force stop + 1 start
      expect(mockInfinivirt.restartVM).toHaveBeenCalledTimes(2)
      expect(mockInfinivirt.stopVM).toHaveBeenCalledTimes(1)
      expect(mockInfinivirt.startVM).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
    }, 15000) // Increase timeout due to retry delays
  })
})
