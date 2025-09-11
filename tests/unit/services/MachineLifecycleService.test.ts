import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { MachineLifecycleService } from '../../../app/services/machineLifecycleService'
import { mockPrisma } from '../../setup/jest.setup'
import { UserInputError, ApolloError } from 'apollo-server-express'
import { MachineCleanupService } from '../../../app/services/cleanup/machineCleanupService'
import { HardwareUpdateService } from '../../../app/services/vm/hardwareUpdateService'
import VirtManager from '../../../app/utils/VirtManager'
import { getEventManager } from '../../../app/services/EventManager'
import si from 'systeminformation'
import {
  createMockMachine,
  createMockMachineTemplate,
  createMockDepartment,
  createMockUser
} from '../../setup/mock-factories'
import { CreateMachineInputType, UpdateMachineHardwareInput, OsEnum } from '../../../app/graphql/resolvers/machine/type'
import { User } from '@prisma/client'

// Mock dependencies
jest.mock('../../../app/services/cleanup/machineCleanupService')
jest.mock('../../../app/services/vm/hardwareUpdateService')
jest.mock('../../../app/utils/VirtManager')
jest.mock('../../../app/services/EventManager', () => ({
  getEventManager: jest.fn()
}))
jest.mock('systeminformation')
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-123')
}))

// Mock types for better type safety
type MockUser = User | null

describe('MachineLifecycleService', () => {
  let service: MachineLifecycleService
  let mockUser: MockUser
  let mockEventManager: ReturnType<typeof jest.mocked<ReturnType<typeof getEventManager>>>

  beforeEach(() => {
    jest.clearAllMocks()

    mockUser = createMockUser()

    // Mock VirtManager
    const VirtManagerMock = VirtManager as unknown as jest.Mock
    VirtManagerMock.mockImplementation(() => ({
      setPrisma: jest.fn(),
      createMachine: jest.fn()
    }))

    // Mock EventManager
    mockEventManager = {
      dispatchEvent: jest.fn().mockResolvedValue(undefined as never),
      setIo: jest.fn(),
      broadcastToAll: jest.fn(),
      dispatchToRoom: jest.fn(),
      joinRoom: jest.fn(),
      leaveRoom: jest.fn()
    } as unknown as ReturnType<typeof jest.mocked<ReturnType<typeof getEventManager>>>

    ;(getEventManager as jest.Mock).mockReturnValue(mockEventManager)

    // Mock systeminformation
    const siMock = jest.mocked(si)
    siMock.graphics.mockResolvedValue({
      controllers: [
        {
          pciBus: '0000:01:00.0',
          model: 'NVIDIA GeForce GTX 1080',
          vendor: 'NVIDIA',
          bus: 'PCIe',
          vram: 8192,
          vramDynamic: false
        },
        {
          pciBus: '0000:02:00.0',
          model: 'AMD Radeon RX 580',
          vendor: 'AMD',
          bus: 'PCIe',
          vram: 8192,
          vramDynamic: false
        }
      ],
      displays: []
    } as unknown as si.Systeminformation.GraphicsData)

    service = new MachineLifecycleService(mockPrisma, mockUser)
  })

  describe('createMachine', () => {
    it('should create machine with custom hardware', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        customCores: 4,
        customRam: 8,
        customStorage: 100,
        os: OsEnum.UBUNTU,
        applications: [],
        username: 'admin',
        password: 'password123',
        departmentId: 'dept-123',
        pciBus: null
      }

      const mockDepartment = createMockDepartment({
        id: 'dept-123',
        name: 'Default Department'
      })

      const mockMachine = createMockMachine({
        id: 'machine-123',
        name: 'Test Machine',
        userId: 'user-123',
        status: 'building',
        os: OsEnum.UBUNTU,
        templateId: null,
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100,
        gpuPciAddress: null
      })

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(mockDepartment as never),
              findFirst: jest.fn().mockResolvedValue(mockDepartment as never)
            },
            machine: {
              create: jest.fn().mockResolvedValue(mockMachine as never)
            },
            machineApplication: {
              create: jest.fn()
            }
          }
          return fn(tx as unknown as typeof mockPrisma)
        }
        return Promise.resolve([])
      })

      const result = await service.createMachine(input)

      expect(result).toEqual(mockMachine)
      expect(result.cpuCores).toBe(4)
      expect(result.ramGB).toBe(8)
      expect(result.diskSizeGB).toBe(100)
    })

    it('should create machine with template', async () => {
      const input: CreateMachineInputType = {
        name: 'Windows Machine',
        templateId: 'template-123',
        os: OsEnum.WINDOWS11,
        applications: [{ applicationId: 'app-1', parameters: {}, machineId: '' }],
        username: 'admin',
        password: 'password123',
        productKey: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
        departmentId: 'dept-123',
        pciBus: null
      }

      const mockTemplate = createMockMachineTemplate({
        id: 'template-123',
        name: 'Windows Template',
        cores: 8,
        ram: 16,
        storage: 500
      })

      const mockDepartment = {
        id: 'dept-123',
        name: 'Default Department'
      }

      const mockMachine = createMockMachine({
        id: 'machine-123',
        name: 'Windows Machine',
        userId: 'user-123',
        status: 'building',
        os: OsEnum.WINDOWS11,
        templateId: 'template-123',
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 8,
        ramGB: 16,
        diskSizeGB: 500,
        gpuPciAddress: null
      })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(mockTemplate)

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(mockDepartment as never)
            },
            machine: {
              create: jest.fn().mockResolvedValue(mockMachine as never)
            },
            machineApplication: {
              create: jest.fn()
            }
          }
          return fn(tx as unknown as typeof mockPrisma)
        }
        return Promise.resolve([])
      })

      const result = await service.createMachine(input)

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'template-123' }
      })
      expect(result).toEqual(mockMachine)
      expect(result.cpuCores).toBe(8)
      expect(result.ramGB).toBe(16)
      expect(result.diskSizeGB).toBe(500)
    })

    it('should throw error if template not found', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        templateId: 'non-existent',
        os: OsEnum.UBUNTU,
        applications: [],
        username: 'admin',
        password: 'password123',
        departmentId: 'dept-123',
        pciBus: null
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      await expect(service.createMachine(input))
        .rejects.toThrow(UserInputError)
    })

    it('should throw error if custom hardware specs missing', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        templateId: 'custom',
        os: OsEnum.UBUNTU,
        applications: [],
        username: 'admin',
        password: 'password123',
        departmentId: 'dept-123',
        pciBus: null
      }

      await expect(service.createMachine(input))
        .rejects.toThrow('Custom hardware specifications are required when not using a template')
    })

    it('should throw error if department not found', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        customCores: 4,
        customRam: 8,
        customStorage: 100,
        os: OsEnum.UBUNTU,
        departmentId: 'non-existent',
        applications: [],
        username: 'admin',
        password: 'password123',
        pciBus: null
      }

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(null as never),
              findFirst: jest.fn().mockResolvedValue(null as never)
            },
            machine: {
              create: jest.fn()
            },
            machineApplication: {
              create: jest.fn()
            }
          }
          return fn(tx as unknown as typeof mockPrisma)
        }
        return Promise.resolve([])
      })

      await expect(service.createMachine(input))
        .rejects.toThrow('Department not found')
    })

    it('should create machine applications', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        customCores: 4,
        customRam: 8,
        customStorage: 100,
        os: OsEnum.UBUNTU,
        applications: [
          { applicationId: 'app-1', parameters: { key: 'value1' }, machineId: '' },
          { applicationId: 'app-2', parameters: { key: 'value2' }, machineId: '' }
        ],
        username: 'admin',
        password: 'password123',
        departmentId: 'dept-123',
        pciBus: null
      }

      const mockDepartment = {
        id: 'dept-123',
        name: 'Default Department'
      }

      const mockMachine = createMockMachine({
        id: 'machine-123',
        name: 'Test Machine',
        userId: 'user-123',
        status: 'building',
        os: OsEnum.UBUNTU,
        templateId: null,
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100,
        gpuPciAddress: null
      })

      const createApplicationMock = jest.fn()

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(mockDepartment as never),
              findFirst: jest.fn().mockResolvedValue(mockDepartment as never)
            },
            machine: {
              create: jest.fn().mockResolvedValue(mockMachine as never)
            },
            machineApplication: {
              create: createApplicationMock
            }
          }
          return fn(tx as unknown as typeof mockPrisma)
        }
        return Promise.resolve([])
      })

      const result = await service.createMachine(input)

      expect(result).toEqual(mockMachine)
      expect(createApplicationMock).toHaveBeenCalledTimes(2)
      expect(createApplicationMock).toHaveBeenCalledWith({
        data: {
          machineId: 'machine-123',
          applicationId: 'app-1',
          parameters: { key: 'value1' }
        }
      })
      expect(createApplicationMock).toHaveBeenCalledWith({
        data: {
          machineId: 'machine-123',
          applicationId: 'app-2',
          parameters: { key: 'value2' }
        }
      })
    })
  })

  describe('destroyMachine', () => {
    it('should destroy machine successfully', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        userId: mockUser?.id || 'user-123'
      })

      mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)

      // Mock the MachineCleanupService
      const mockCleanupVM = jest.fn();
      (MachineCleanupService as unknown as jest.Mock).mockImplementation(() => ({
        cleanupVM: mockCleanupVM
      }))

      const result = await service.destroyMachine('machine-123')

      expect(result).toEqual({
        success: true,
        message: 'Machine destroyed'
      })
      expect(mockPrisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: 'machine-123', userId: mockUser?.id },
        include: {
          configuration: true,
          nwFilters: {
            include: {
              nwFilter: true
            }
          }
        }
      })
      expect(mockCleanupVM).toHaveBeenCalledWith('machine-123')
    })

    it('should return error if machine not found', async () => {
      mockPrisma.machine.findFirst.mockResolvedValue(null)

      const result = await service.destroyMachine('non-existent')

      expect(result).toEqual({
        success: false,
        message: 'Machine not found'
      })
    })

    it('should handle cleanup errors', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        userId: mockUser?.id || 'user-123'
      })

      mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)

      // Mock the MachineCleanupService to throw an error
      const mockCleanupVM = jest.fn(() => Promise.reject(new Error('Cleanup failed')));
      (MachineCleanupService as unknown as jest.Mock).mockImplementation(() => ({
        cleanupVM: mockCleanupVM
      }))

      const result = await service.destroyMachine('machine-123')

      expect(result).toEqual({
        success: false,
        message: 'Error destroying machine: Cleanup failed'
      })
    })
  })

  describe('updateMachineHardware', () => {
    it('should update machine hardware successfully', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        cpuCores: 4,
        ramGB: 8,
        gpuPciAddress: null
      })

      const updatedMachine = {
        ...mockMachine,
        cpuCores: 8,
        ramGB: 16
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(updatedMachine)

      // Mock the HardwareUpdateService
      const mockUpdateHardware = jest.fn();
      (HardwareUpdateService as unknown as jest.Mock).mockImplementation(() => ({
        updateHardware: mockUpdateHardware
      }))

      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        cpuCores: 8,
        ramGB: 16
      }

      const result = await service.updateMachineHardware(input)

      expect(result).toEqual(updatedMachine)
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: 'machine-123' },
        data: {
          cpuCores: 8,
          ramGB: 16
        },
        include: expect.any(Object)
      })
    })

    it('should validate GPU PCI address', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        gpuPciAddress: null
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        gpuPciAddress: 'invalid-pci'
      }

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow('Failed to validate GPU PCI address')
    })

    it('should throw error if machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const input: UpdateMachineHardwareInput = {
        id: 'non-existent',
        cpuCores: 8
      }

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow(ApolloError)
    })

    it('should return same machine if no changes provided', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const input: UpdateMachineHardwareInput = {
        id: 'machine-123'
      }

      const result = await service.updateMachineHardware(input)

      expect(result).toEqual(mockMachine)
      expect(mockPrisma.machine.update).not.toHaveBeenCalled()
    })
  })
})
