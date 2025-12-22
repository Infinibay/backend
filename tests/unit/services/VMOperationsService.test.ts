import 'reflect-metadata'
import { VMOperationsService } from '../../../app/services/VMOperationsService'
import { PrismaClient } from '@prisma/client'

// Mock InfinizationService
const mockInfinization = {
  startVM: jest.fn(),
  stopVM: jest.fn(),
  restartVM: jest.fn(),
  resetVM: jest.fn(),
  suspendVM: jest.fn(),
  resumeVM: jest.fn(),
  getVMStatus: jest.fn()
}

jest.mock('../../../app/services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
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
      mockInfinization.startVM.mockResolvedValue({
        success: true,
        message: 'VM started successfully'
      })

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(true)
      expect(result.message).toBe('VM started successfully')
      expect(mockInfinization.startVM).toHaveBeenCalledWith(machineId)
    })

    it('should handle start failure', async () => {
      mockInfinization.startVM.mockResolvedValue({
        success: false,
        error: 'VM already running'
      })

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('VM already running')
    })

    it('should handle exceptions', async () => {
      mockInfinization.startVM.mockRejectedValue(new Error('Connection failed'))

      const result = await service.startMachine(machineId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Connection failed')
    })
  })

  describe('forcePowerOff', () => {
    const machineId = 'vm-123'

    it('should successfully force power off a machine', async () => {
      mockInfinization.stopVM.mockResolvedValue({
        success: true,
        message: 'VM forcefully stopped'
      })

      const result = await service.forcePowerOff(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.stopVM).toHaveBeenCalledWith(machineId, {
        graceful: false,
        force: true
      })
    })

    it('should handle force power off failure', async () => {
      mockInfinization.stopVM.mockResolvedValue({
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
      mockInfinization.stopVM.mockResolvedValue({
        success: true,
        message: 'VM powered off'
      })

      const result = await service.gracefulPowerOff(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.stopVM).toHaveBeenCalledWith(machineId, {
        graceful: true,
        timeout: 30000,
        force: true
      })
    })
  })

  describe('restartMachine', () => {
    const machineId = 'vm-123'

    it('should successfully restart a machine', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted'
      })

      const result = await service.restartMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.restartVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('resetMachine', () => {
    const machineId = 'vm-123'

    it('should successfully reset a machine', async () => {
      mockInfinization.resetVM.mockResolvedValue({
        success: true,
        message: 'VM reset'
      })

      const result = await service.resetMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.resetVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('suspendMachine', () => {
    const machineId = 'vm-123'

    it('should successfully suspend a machine', async () => {
      mockInfinization.suspendVM.mockResolvedValue({
        success: true,
        message: 'VM suspended'
      })

      const result = await service.suspendMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.suspendVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('resumeMachine', () => {
    const machineId = 'vm-123'

    it('should successfully resume a machine', async () => {
      mockInfinization.resumeVM.mockResolvedValue({
        success: true,
        message: 'VM resumed'
      })

      const result = await service.resumeMachine(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.resumeVM).toHaveBeenCalledWith(machineId)
    })
  })

  describe('getStatus', () => {
    const machineId = 'vm-123'

    it('should return VM status', async () => {
      mockInfinization.getVMStatus.mockResolvedValue({
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
      mockInfinization.getVMStatus.mockRejectedValue(new Error('Failed'))

      const result = await service.getStatus(machineId)

      expect(result).toBeNull()
    })
  })

  describe('performGracefulRestart', () => {
    const machineId = 'vm-123'

    it('should restart on first attempt if successful', async () => {
      mockInfinization.restartVM.mockResolvedValue({
        success: true,
        message: 'VM restarted'
      })

      const result = await service.performGracefulRestart(machineId)

      expect(result.success).toBe(true)
      expect(mockInfinization.restartVM).toHaveBeenCalledTimes(1)
    })

    it('should retry up to maxRetries on failure', async () => {
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

      const result = await service.performGracefulRestart(machineId, 2)

      // 2 restart attempts + 1 force stop + 1 start
      expect(mockInfinization.restartVM).toHaveBeenCalledTimes(2)
      expect(mockInfinization.stopVM).toHaveBeenCalledTimes(1)
      expect(mockInfinization.startVM).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
    }, 15000) // Increase timeout due to retry delays
  })
})
