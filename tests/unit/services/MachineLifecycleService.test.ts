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
import { CreateMachineInputType, UpdateMachineHardwareInput } from '../../../app/graphql/resolvers/machine/type'
import { User } from '@prisma/client'

// Mock dependencies
jest.mock('../../../app/services/cleanup/machineCleanupService')
jest.mock('../../../app/services/vm/hardwareUpdateService')
jest.mock('../../../app/utils/VirtManager')
jest.mock('../../../app/services/EventManager')
jest.mock('systeminformation')
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-123')
}))

// Mock types for better type safety
type MockUser = User | null

describe.skip('MachineLifecycleService', () => {
  let service: MachineLifecycleService
  let mockUser: MockUser
  let mockEventManager: ReturnType<typeof jest.mocked<ReturnType<typeof getEventManager>>>

  beforeEach(() => {
    jest.clearAllMocks()
    
    mockUser = createMockUser()

    // Mock EventManager
    mockEventManager = {
      dispatchEvent: jest.fn().mockResolvedValue(undefined),
      setIo: jest.fn(),
      broadcastToAll: jest.fn(),
      dispatchToRoom: jest.fn(),
      joinRoom: jest.fn(),
      leaveRoom: jest.fn()
    } as unknown as ReturnType<typeof jest.mocked<ReturnType<typeof getEventManager>>>
    
    const getEventManagerMock = jest.mocked(getEventManager)
    getEventManagerMock.mockReturnValue(mockEventManager)

    // Mock systeminformation
    const siMock = jest.mocked(si)
    siMock.graphics.mockResolvedValue({
      controllers: [
        { pciBus: '0000:01:00.0', model: 'NVIDIA GeForce GTX 1080' },
        { pciBus: '0000:02:00.0', model: 'AMD Radeon RX 580' }
      ],
      displays: []
    })

    service = new MachineLifecycleService(mockPrisma, mockUser)
  })

  describe('createMachine', () => {
    it('should create machine with custom hardware', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        customCores: 4,
        customRam: 8,
        customStorage: 100,
        os: 'Ubuntu 22.04',
        applications: [],
        username: 'admin',
        password: 'password123'
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
        os: 'Ubuntu 22.04',
        templateId: null,
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100,
        gpuPciAddress: null
      })

      ;(mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: unknown) => {
        const tx = {
          department: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(mockDepartment)
          },
          machine: {
            create: jest.fn().mockResolvedValue(mockMachine)
          },
          machineApplication: {
            create: jest.fn()
          }
        }
        return (fn as (prisma: unknown) => Promise<unknown>)(tx)
      })

      // Spy on setImmediate to prevent background execution
      const setImmediateSpy = jest.spyOn(global, 'setImmediate')

      const result = await service.createMachine(input)

      expect(result).toEqual(mockMachine)
      expect(result.cpuCores).toBe(4)
      expect(result.ramGB).toBe(8)
      expect(result.diskSizeGB).toBe(100)
      expect(setImmediateSpy).toHaveBeenCalled()
    })

    it('should create machine with template', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        templateId: 'template-123',
        os: 'Windows 11',
        applications: [
          { applicationId: 'app-1', parameters: '{}', machineId: '' }
        ],
        username: 'admin',
        password: 'password123',
        productKey: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX'
      }

      const mockTemplate = {
        id: 'template-123',
        name: 'Large VM',
        cores: 8,
        ram: 16,
        storage: 500,
        createdAt: new Date('2024-01-01'),
        description: 'Large VM template',
        categoryId: null
      }

      const mockDepartment = {
        id: 'dept-123',
        name: 'Engineering'
      }

      const mockMachine = {
        id: 'machine-123',
        name: 'Test Machine',
        userId: 'user-123',
        status: 'building',
        os: 'Windows 11',
        templateId: 'template-123',
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 8,
        ramGB: 16,
        diskSizeGB: 500,
        gpuPciAddress: null,
        configuration: {
          id: 'config-123',
          graphicPort: 0,
          graphicProtocol: 'spice',
          graphicHost: 'localhost',
          graphicPassword: null
        },
        department: mockDepartment,
        template: mockTemplate,
        user: mockUser
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(mockTemplate)
      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(mockDepartment)
            },
            machine: {
              create: jest.fn().mockResolvedValue(mockMachine)
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
        os: 'Ubuntu 22.04',
        applications: [],
        username: 'admin',
        password: 'password123'
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      await expect(service.createMachine(input))
        .rejects.toThrow(UserInputError)
    })

    it('should throw error if custom hardware specs missing', async () => {
      const input: CreateMachineInputType = {
        name: 'Test Machine',
        templateId: 'custom',
        os: 'Ubuntu 22.04',
        applications: [],
        username: 'admin',
        password: 'password123'
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
        os: 'Ubuntu 22.04',
        departmentId: 'non-existent',
        applications: [],
        username: 'admin',
        password: 'password123'
      }

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null)
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
        os: 'Ubuntu 22.04',
        applications: [
          { applicationId: 'app-1', parameters: '{"key": "value1"}', machineId: '' },
          { applicationId: 'app-2', parameters: '{"key": "value2"}', machineId: '' }
        ],
        username: 'admin',
        password: 'password123'
      }

      const mockDepartment = {
        id: 'dept-123',
        name: 'Default Department'
      }

      const mockMachine = {
        id: 'machine-123',
        name: 'Test Machine',
        userId: 'user-123',
        status: 'building',
        os: 'Ubuntu 22.04',
        templateId: null,
        internalName: 'mock-uuid-123',
        departmentId: 'dept-123',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100,
        gpuPciAddress: null,
        configuration: {},
        department: mockDepartment,
        template: null,
        user: mockUser
      }

      const createAppSpy = jest.fn()

      mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          const tx = {
            department: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(mockDepartment)
            },
            machine: {
              create: jest.fn().mockResolvedValue(mockMachine)
            },
            machineApplication: {
              create: createAppSpy
            }
          }
          return fn(tx as unknown as typeof mockPrisma)
        }
        return Promise.resolve([])
      })

      await service.createMachine(input)

      expect(createAppSpy).toHaveBeenCalledTimes(2)
      expect(createAppSpy).toHaveBeenCalledWith({
        data: {
          machineId: 'machine-123',
          applicationId: 'app-1',
          parameters: '{"key": "value1"}'
        }
      })
      expect(createAppSpy).toHaveBeenCalledWith({
        data: {
          machineId: 'machine-123',
          applicationId: 'app-2',
          parameters: '{"key": "value2"}'
        }
      })
    })
  })

  describe('destroyMachine', () => {
    it('should destroy machine successfully', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        userId: 'user-123'
      })
      const machineWithRelations = {
        ...mockMachine,
        configuration: {},
        nwFilters: []
      }

      mockPrisma.machine.findFirst.mockResolvedValue(machineWithRelations as never)

      const mockCleanupService = {
        cleanupVM: jest.fn()
      }
      const MachineCleanupServiceMock = MachineCleanupService as jest.MockedClass<typeof MachineCleanupService>
      MachineCleanupServiceMock.mockImplementation(() => mockCleanupService as unknown as MachineCleanupService)

      const result = await service.destroyMachine('machine-123')

      expect(mockPrisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: 'machine-123', userId: 'user-123' },
        include: {
          configuration: true,
          nwFilters: {
            include: { nwFilter: true }
          }
        }
      })
      expect(mockCleanupService.cleanupVM).toHaveBeenCalledWith('machine-123')
      expect(result).toEqual({
        success: true,
        message: 'Machine destroyed'
      })
    })

    it('should allow admin to destroy any machine', async () => {
      const adminUser = createMockUser({ id: 'admin-123', role: 'ADMIN' })
      const adminService = new MachineLifecycleService(mockPrisma, adminUser)

      const mockMachine = createMockMachine({
        id: 'machine-123',
        userId: 'other-user'
      })
      const machineWithRelations = {
        ...mockMachine,
        configuration: {},
        nwFilters: []
      }

      mockPrisma.machine.findFirst.mockResolvedValue(machineWithRelations as never)

      const mockCleanupService = {
        cleanupVM: jest.fn()
      }
      const MachineCleanupServiceMock = MachineCleanupService as jest.MockedClass<typeof MachineCleanupService>
      MachineCleanupServiceMock.mockImplementation(() => mockCleanupService as unknown as MachineCleanupService)

      const result = await adminService.destroyMachine('machine-123')

      expect(mockPrisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: 'machine-123' },
        include: {
          configuration: true,
          nwFilters: {
            include: { nwFilter: true }
          }
        }
      })
      expect(result.success).toBe(true)
    })

    it('should return error if machine not found', async () => {
      mockPrisma.machine.findFirst.mockResolvedValue(null)

      const result = await service.destroyMachine('non-existent')

      expect(result).toEqual({
        success: false,
        message: 'Machine not found'
      })
    })

    it('should handle cleanup errors gracefully', async () => {
      const mockMachine = createMockMachine({
        id: 'machine-123',
        userId: 'user-123'
      })
      const machineWithRelations = {
        ...mockMachine,
        configuration: {},
        nwFilters: []
      }

      mockPrisma.machine.findFirst.mockResolvedValue(machineWithRelations as never)

      const mockCleanupService = {
        cleanupVM: jest.fn().mockRejectedValue(new Error('Cleanup failed'))
      }
      const MachineCleanupServiceMock = MachineCleanupService as jest.MockedClass<typeof MachineCleanupService>
      MachineCleanupServiceMock.mockImplementation(() => mockCleanupService as unknown as MachineCleanupService)

      const result = await service.destroyMachine('machine-123')

      expect(result).toEqual({
        success: false,
        message: 'Error destroying machine: Cleanup failed'
      })
    })
  })

  describe('updateMachineHardware', () => {
    it('should update CPU cores', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        cpuCores: 8
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      const updatedMachine = createMockMachine({
        id: 'machine-123',
        cpuCores: 8
      })
      const machineWithRelations = {
        ...updatedMachine,
        configuration: {},
        department: {},
        template: null,
        user: mockUser
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(machineWithRelations as never)

      const mockHardwareUpdateService = {
        updateHardware: jest.fn()
      }
      const HardwareUpdateServiceMock = jest.mocked(HardwareUpdateService)
      HardwareUpdateServiceMock.mockImplementation(() => mockHardwareUpdateService as never)

      const result = await service.updateMachineHardware(input)

      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: 'machine-123' },
        data: { cpuCores: 8 },
        include: {
          configuration: true,
          department: true,
          template: true,
          user: true
        }
      })
      expect(result).toEqual(updatedMachine)
    })

    it('should update RAM', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        ramGB: 32
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      const updatedMachine = createMockMachine({
        id: 'machine-123',
        ramGB: 32
      })
      const machineWithRelations = {
        ...updatedMachine,
        configuration: {},
        department: {},
        template: null,
        user: mockUser
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(machineWithRelations as never)

      const mockHardwareUpdateService = {
        updateHardware: jest.fn()
      }
      const HardwareUpdateServiceMock = jest.mocked(HardwareUpdateService)
      HardwareUpdateServiceMock.mockImplementation(() => mockHardwareUpdateService as never)

      const result = await service.updateMachineHardware(input)

      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: 'machine-123' },
        data: { ramGB: 32 },
        include: {
          configuration: true,
          department: true,
          template: true,
          user: true
        }
      })
      expect(result.ramGB).toBe(32)
    })

    it('should update GPU PCI address', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        gpuPciAddress: '0000:01:00.0'
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      const updatedMachine = createMockMachine({
        id: 'machine-123',
        gpuPciAddress: '0000:01:00.0'
      })
      const machineWithRelations = {
        ...updatedMachine,
        department: {},
        template: null,
        user: mockUser
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(machineWithRelations as never)

      const mockHardwareUpdateService = {
        updateHardware: jest.fn()
      }
      const HardwareUpdateServiceMock = jest.mocked(HardwareUpdateService)
      HardwareUpdateServiceMock.mockImplementation(() => mockHardwareUpdateService as never)

      const result = await service.updateMachineHardware(input)

      expect(si.graphics).toHaveBeenCalled()
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: 'machine-123' },
        data: { gpuPciAddress: '0000:01:00.0' },
        include: {
          configuration: true,
          department: true,
          template: true,
          user: true
        }
      })
      expect(result.gpuPciAddress).toBe('0000:01:00.0')
    })

    it('should remove GPU PCI address when set to null', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        gpuPciAddress: null
      }

      const mockMachine = createMockMachine({
        id: 'machine-123',
        gpuPciAddress: '0000:01:00.0'
      })

      const updatedMachine = createMockMachine({
        id: 'machine-123',
        gpuPciAddress: null
      })
      const machineWithRelations = {
        ...updatedMachine,
        department: {},
        template: null,
        user: mockUser
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(machineWithRelations as never)

      const mockHardwareUpdateService = {
        updateHardware: jest.fn()
      }
      const HardwareUpdateServiceMock = jest.mocked(HardwareUpdateService)
      HardwareUpdateServiceMock.mockImplementation(() => mockHardwareUpdateService as never)

      const result = await service.updateMachineHardware(input)

      expect(si.graphics).not.toHaveBeenCalled()
      expect(result.gpuPciAddress).toBeNull()
    })

    it('should throw error if machine not found', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'non-existent',
        cpuCores: 8
      }

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow('Machine with ID non-existent not found')
    })

    it('should throw error for invalid CPU cores', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        cpuCores: 0
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow('CPU cores must be positive.')
    })

    it('should throw error for invalid RAM', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        ramGB: -8
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow('RAM must be positive.')
    })

    it('should throw error for invalid GPU PCI address', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123',
        gpuPciAddress: '0000:99:99.9'
      }

      const mockMachine = createMockMachine({
        id: 'machine-123'
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      await expect(service.updateMachineHardware(input))
        .rejects.toThrow('Invalid GPU PCI address: 0000:99:99.9. Not found or not a GPU.')
    })

    it('should return machine unchanged if no updates provided', async () => {
      const input: UpdateMachineHardwareInput = {
        id: 'machine-123'
      }

      const mockMachine = createMockMachine({
        id: 'machine-123',
        cpuCores: 4,
        ramGB: 8
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.updateMachineHardware(input)

      expect(mockPrisma.machine.update).not.toHaveBeenCalled()
      expect(result).toEqual(mockMachine)
    })
  })
})