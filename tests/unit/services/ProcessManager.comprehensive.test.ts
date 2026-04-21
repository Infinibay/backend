import 'reflect-metadata'
import { PrismaClient, Machine } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { ProcessManager, ProcessSortBy } from '../../../app/services/ProcessManager'
import { VirtioSocketWatcherService } from '../../../app/services/VirtioSocketWatcherService'

const mockInfinization = {
  getVMStatus: jest.fn()
}

jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}))

describe('ProcessManager', () => {
  let service: ProcessManager
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockVirtioService: DeepMockProxy<VirtioSocketWatcherService>
  const testMachineId = 'vm-process-test'

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()
    mockVirtioService = mockDeep<VirtioSocketWatcherService>()

    service = new ProcessManager(mockPrisma, mockVirtioService)
  })

  describe('listProcesses', () => {
    it('should list all processes from a VM', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' }
      const mockProcesses = [
        { pid: 1, name: 'System', cpuUsage: 0.1, memoryKb: 1024, status: 'running' },
        { pid: 1234, name: 'Chrome', cpuUsage: 2.5, memoryKb: 51200, status: 'running' }
      ]
      const mockResponse = {
        success: true,
        data: { processes: mockProcesses }
      }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true })
      jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse as any)

      const result = await service.listProcesses(testMachineId)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('System')
      expect(mockVirtioService.sendSafeCommand).toHaveBeenCalled()
    })

    it('should return empty array when VM has no processes', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' }
      const mockResponse = { success: true, data: { processes: [] } }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true })
      jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse as any)

      const result = await service.listProcesses(testMachineId)

      expect(result).toHaveLength(0)
    })

    it('should throw error on command execution failure', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' }
      const mockResponse = { success: false, error: 'Process enumeration failed' }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true })
      jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse as any)

      // listProcesses throws on failure
      await expect(service.listProcesses(testMachineId)).rejects.toThrow()
    })

    it('should throw error when connection fails', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true })
      jest.spyOn(mockVirtioService, 'sendSafeCommand').mockRejectedValue(new Error('Connection lost'))

      await expect(service.listProcesses(testMachineId)).rejects.toThrow('Connection lost')
    })
  })

  describe('getRunningMachine', () => {
    it('should return null when VM does not exist', async () => {
      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null)

      const result = await (service as any).getRunningMachine(testMachineId)

      expect(result).toBe(null)
    })

    it('should return null when VM is not running', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'stopped', internalName: 'vm-test' }
      const mockStatus = { processAlive: false }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue(mockStatus)

      const result = await (service as any).getRunningMachine(testMachineId)

      expect(result).toBe(null)
    })

    it('should return machine when VM is running', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' }
      const mockStatus = { processAlive: true }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as Machine)
      mockInfinization.getVMStatus.mockResolvedValue(mockStatus)

      const result = await (service as any).getRunningMachine(testMachineId)

      expect(result).toEqual({ machine: mockMachine })
    })

    it('should update machine status when different from infinization', async () => {
      const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'stopped', internalName: 'vm-test' } as any
      const mockStatus = { processAlive: true }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine)
      mockInfinization.getVMStatus.mockResolvedValue(mockStatus)

      await (service as any).getRunningMachine(testMachineId)

      expect(mockPrisma.machine.update).toHaveBeenCalled()
    })
  })
})
