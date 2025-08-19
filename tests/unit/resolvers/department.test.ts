import 'reflect-metadata'
import { DepartmentResolver } from '@resolvers/department/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createMockDepartment,
  createMockDepartmentConfiguration,
  createMockDepartmentInput,
  createMockMachines,
  createMockNetworkFilterWithRules,
  createMockDepartments,
  createMockNWFilter
} from '../../setup/mock-factories'
import {
  createAdminContext,
  createMockContext
} from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-errors'

// Mock EventManager
jest.mock('@services/DepartmentEventManager', () => ({
  DepartmentEventManager: {
    getInstance: jest.fn(() => ({
      dispatch: jest.fn(),
      subscribeToDepartment: jest.fn(),
      unsubscribeFromDepartment: jest.fn()
    }))
  }
}))

// Mock NetworkService
jest.mock('@services/NetworkService', () => ({
  NetworkService: {
    getInstance: jest.fn(() => ({
      createDepartmentNetwork: jest.fn(),
      updateDepartmentNetwork: jest.fn(),
      deleteDepartmentNetwork: jest.fn(),
      assignIPRange: jest.fn(),
      releaseIPRange: jest.fn(),
      getDepartmentIPUsage: jest.fn()
    }))
  }
}))

describe('DepartmentResolver', () => {
  let resolver: DepartmentResolver
  let mockDepartmentEventManager: any
  let mockNetworkService: any

  beforeEach(() => {
    resolver = new DepartmentResolver()
    const DepartmentEventManager = require('@services/DepartmentEventManager').DepartmentEventManager
    const NetworkService = require('@services/NetworkService').NetworkService
    mockDepartmentEventManager = DepartmentEventManager.getInstance()
    mockNetworkService = NetworkService.getInstance()
    jest.clearAllMocks()
  })

  describe('department', () => {
    it('should return department by id with relations', async () => {
      const department = createMockDepartment()
      const configuration = createMockDepartmentConfiguration({ departmentId: department.id })
      const machines = createMockMachines(3).map(m => ({ ...m, departmentId: department.id }))
      const filter = createMockNWFilter()

      const departmentWithRelations = {
        ...department,
        configuration,
        machines,
        nwFilters: [{ nwFilter: filter }],
        serviceConfigs: []
      }

      mockPrisma.department.findUnique.mockResolvedValue(departmentWithRelations)

      const result = await resolver.department(department.id)

      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: department.id },
        include: {
          machines: true,
          nwFilters: {
            include: { nwFilter: true }
          },
          configuration: true,
          serviceConfigs: true
        }
      })
      expect(result).toEqual(departmentWithRelations)
    })

    it('should return null if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      const result = await resolver.department('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('departments', () => {
    it('should return all departments', async () => {
      const departments = createMockDepartments(5)

      mockPrisma.department.findMany.mockResolvedValue(departments)

      const result = await resolver.departments()

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith({
        include: {
          machines: true,
          configuration: true
        },
        orderBy: { name: 'asc' }
      })
      expect(result).toEqual(departments)
    })

    it('should return empty array when no departments exist', async () => {
      mockPrisma.department.findMany.mockResolvedValue([])

      const result = await resolver.departments()

      expect(result).toEqual([])
    })

    it('should include machine count for each department', async () => {
      const departments = createMockDepartments(2).map((dept, index) => ({
        ...dept,
        machines: createMockMachines(index + 1)
      }))

      mockPrisma.department.findMany.mockResolvedValue(departments)

      const result = await resolver.departments()

      expect(result[0].machines).toHaveLength(1)
      expect(result[1].machines).toHaveLength(2)
    })
  })

  describe('createDepartment', () => {
    it('should create department with valid input', async () => {
      const input = createMockDepartmentInput()
      const createdDepartment = createMockDepartment(input)
      const configuration = createMockDepartmentConfiguration({
        departmentId: createdDepartment.id
      })

      mockPrisma.department.findFirst.mockResolvedValue(null) // Name doesn't exist
      mockPrisma.department.create.mockResolvedValue({
        ...createdDepartment,
        configuration,
        machines: [],
        nwFilters: []
      })
      mockNetworkService.createDepartmentNetwork.mockResolvedValue({ success: true })
      mockNetworkService.assignIPRange.mockResolvedValue({
        subnet: input.ipSubnet || '192.168.100.0/24'
      })

      const context = createAdminContext()
      const result = await resolver.createDepartment(context, input.name, input)

      expect(mockPrisma.department.create).toHaveBeenCalledWith({
        data: {
          name: input.name,
          internetSpeed: input.internetSpeed,
          ipSubnet: input.ipSubnet,
          configuration: {
            create: {
              cleanTraffic: false
            }
          }
        },
        include: {
          configuration: true,
          machines: true
        }
      })
      expect(mockNetworkService.createDepartmentNetwork).toHaveBeenCalled()
      expect(result.name).toBe(input.name)
    })

    it('should throw error if department name already exists', async () => {
      const input = createMockDepartmentInput()
      const existingDepartment = createMockDepartment({ name: input.name })

      mockPrisma.department.findFirst.mockResolvedValue(existingDepartment)

      const context = createAdminContext()
      await expect(
        resolver.createDepartment(context, input.name, input)
      ).rejects.toThrow(UserInputError)
      expect(mockPrisma.department.create).not.toHaveBeenCalled()
    })

    it('should validate IP subnet format', async () => {
      const input = createMockDepartmentInput({ ipSubnet: 'invalid-subnet' })

      mockPrisma.department.findFirst.mockResolvedValue(null)

      const context = createAdminContext()
      await expect(
        resolver.createDepartment(context, input.name, input)
      ).rejects.toThrow(UserInputError)
    })

    it('should validate internet speed', async () => {
      const input = createMockDepartmentInput({ internetSpeed: -1 })

      mockPrisma.department.findFirst.mockResolvedValue(null)

      const context = createAdminContext()
      await expect(
        resolver.createDepartment(context, input.name, input)
      ).rejects.toThrow(UserInputError)
    })

    it('should handle network creation failure', async () => {
      const input = createMockDepartmentInput()
      const createdDepartment = createMockDepartment(input)

      mockPrisma.department.findFirst.mockResolvedValue(null)
      mockPrisma.department.create.mockResolvedValue(createdDepartment)
      mockNetworkService.createDepartmentNetwork.mockRejectedValue(
        new Error('Network creation failed')
      )

      const context = createAdminContext()
      await expect(
        resolver.createDepartment(context, input.name, input)
      ).rejects.toThrow('Network creation failed')
    })
  })

  describe('updateDepartment', () => {
    it('should update department properties', async () => {
      const department = createMockDepartment()
      const updateInput = {
        name: 'Updated Department',
        internetSpeed: 200
      }
      const updatedDepartment = { ...department, ...updateInput }

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.department.findFirst.mockResolvedValue(null) // New name doesn't exist
      mockPrisma.department.update.mockResolvedValue(updatedDepartment)

      const result = await resolver.updateDepartment(department.id, updateInput)

      expect(mockPrisma.department.update).toHaveBeenCalledWith({
        where: { id: department.id },
        data: updateInput,
        include: {
          configuration: true,
          machines: true
        }
      })
      expect(result).toEqual(updatedDepartment)
    })

    it('should update IP subnet and reconfigure network', async () => {
      const department = createMockDepartment()
      const newSubnet = '10.0.0.0/24'
      const updateInput = { ipSubnet: newSubnet }

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.department.update.mockResolvedValue({ ...department, ipSubnet: newSubnet })
      mockNetworkService.updateDepartmentNetwork.mockResolvedValue({ success: true })

      const result = await resolver.updateDepartment(department.id, updateInput)

      expect(mockNetworkService.updateDepartmentNetwork).toHaveBeenCalledWith(
        department.id,
        { subnet: newSubnet }
      )
      expect(result.ipSubnet).toBe(newSubnet)
    })

    it('should throw error if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        resolver.updateDepartment('non-existent', { name: 'New Name' })
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if new name already exists', async () => {
      const department = createMockDepartment()
      const otherDepartment = createMockDepartment({ name: 'Existing Name' })

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.department.findFirst.mockResolvedValue(otherDepartment)

      await expect(
        resolver.updateDepartment(department.id, { name: 'Existing Name' })
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('destroyDepartment', () => {
    it('should destroy department without machines', async () => {
      const department = createMockDepartment()
      const departmentWithNoMachines = { ...department, machines: [] }

      mockPrisma.department.findUnique.mockResolvedValue(departmentWithNoMachines)
      mockPrisma.department.delete.mockResolvedValue(department)
      mockNetworkService.deleteDepartmentNetwork.mockResolvedValue({ success: true })
      mockNetworkService.releaseIPRange.mockResolvedValue({ success: true })

      const result = await resolver.destroyDepartment(department.id)

      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: department.id }
      })
      expect(mockNetworkService.deleteDepartmentNetwork).toHaveBeenCalledWith(department.id)
      expect(mockNetworkService.releaseIPRange).toHaveBeenCalledWith(department.ipSubnet)
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('destroyed')
      })
    })

    it('should force destroy department with machines if force flag is set', async () => {
      const department = createMockDepartment()
      const machines = createMockMachines(3)
      const departmentWithMachines = { ...department, machines }

      mockPrisma.department.findUnique.mockResolvedValue(departmentWithMachines)
      mockPrisma.machine.deleteMany.mockResolvedValue({ count: 3 })
      mockPrisma.department.delete.mockResolvedValue(department)
      mockNetworkService.deleteDepartmentNetwork.mockResolvedValue({ success: true })

      const result = await resolver.destroyDepartment(department.id, true)

      expect(mockPrisma.machine.deleteMany).toHaveBeenCalledWith({
        where: { departmentId: department.id }
      })
      expect(mockPrisma.department.delete).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should not destroy department with machines without force flag', async () => {
      const department = createMockDepartment()
      const machines = createMockMachines(2)
      const departmentWithMachines = { ...department, machines }

      mockPrisma.department.findUnique.mockResolvedValue(departmentWithMachines)

      await expect(
        resolver.destroyDepartment(department.id, false)
      ).rejects.toThrow(UserInputError)
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
    })

    it('should throw error if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        resolver.destroyDepartment('non-existent')
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('updateDepartmentConfiguration', () => {
    it('should update department configuration', async () => {
      const department = createMockDepartment()
      const configuration = createMockDepartmentConfiguration({
        departmentId: department.id,
        cleanTraffic: false
      })

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.departmentConfiguration.upsert.mockResolvedValue({
        ...configuration,
        cleanTraffic: true
      })

      const result = await resolver.updateDepartmentConfiguration(department.id, {
        cleanTraffic: true
      })

      expect(mockPrisma.departmentConfiguration.upsert).toHaveBeenCalledWith({
        where: { departmentId: department.id },
        update: { cleanTraffic: true },
        create: {
          departmentId: department.id,
          cleanTraffic: true
        }
      })
      expect(result.cleanTraffic).toBe(true)
    })

    it('should create configuration if not exists', async () => {
      const department = createMockDepartment()
      const newConfiguration = createMockDepartmentConfiguration({
        departmentId: department.id,
        cleanTraffic: true
      })

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.departmentConfiguration.upsert.mockResolvedValue(newConfiguration)

      const result = await resolver.updateDepartmentConfiguration(department.id, {
        cleanTraffic: true
      })

      expect(result).toEqual(newConfiguration)
    })
  })

  describe('addMachineToDepartment', () => {
    it('should add machine to department', async () => {
      const department = createMockDepartment()
      const machine = createMockMachines(1)[0]

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockPrisma.machine.update.mockResolvedValue({
        ...machine,
        departmentId: department.id
      })

      const result = await resolver.addMachineToDepartment(department.id, machine.id)

      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { departmentId: department.id }
      })
      expect(result.departmentId).toBe(department.id)
    })

    it('should throw error if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        resolver.addMachineToDepartment('non-existent', 'machine-id')
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if machine not found', async () => {
      const department = createMockDepartment()

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(
        resolver.addMachineToDepartment(department.id, 'non-existent')
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if machine already in another department', async () => {
      const department = createMockDepartment()
      const machine = createMockMachines(1)[0]
      machine.departmentId = 'other-department-id'

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findUnique.mockResolvedValue(machine)

      await expect(
        resolver.addMachineToDepartment(department.id, machine.id)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('removeMachineFromDepartment', () => {
    it('should remove machine from department', async () => {
      const department = createMockDepartment()
      const machine = createMockMachines(1)[0]
      machine.departmentId = department.id

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockPrisma.machine.update.mockResolvedValue({
        ...machine,
        departmentId: null
      })

      const result = await resolver.removeMachineFromDepartment(machine.id)

      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { departmentId: null }
      })
      expect(result.departmentId).toBeNull()
    })

    it('should throw error if machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(
        resolver.removeMachineFromDepartment('non-existent')
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if machine not in any department', async () => {
      const machine = createMockMachines(1)[0]
      machine.departmentId = null

      mockPrisma.machine.findUnique.mockResolvedValue(machine)

      await expect(
        resolver.removeMachineFromDepartment(machine.id)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('getDepartmentStatistics', () => {
    it('should return department statistics', async () => {
      const department = createMockDepartment()
      const machines = createMockMachines(5).map((m, i) => ({
        ...m,
        departmentId: department.id,
        status: i < 3 ? 'running' : 'stopped',
        cpuCores: 4,
        ramGB: 8,
        diskSizeGB: 100
      }))

      mockPrisma.department.findUnique.mockResolvedValue({
        ...department,
        machines
      })
      mockNetworkService.getDepartmentIPUsage.mockResolvedValue({
        totalIPs: 254,
        usedIPs: 5,
        availableIPs: 249
      })

      const result = await resolver.getDepartmentStatistics(department.id)

      expect(result).toEqual({
        totalMachines: 5,
        runningMachines: 3,
        stoppedMachines: 2,
        totalCPUCores: 20,
        totalRAMGB: 40,
        totalDiskGB: 500,
        ipUsage: {
          totalIPs: 254,
          usedIPs: 5,
          availableIPs: 249
        }
      })
    })

    it('should return zero statistics for department without machines', async () => {
      const department = createMockDepartment()

      mockPrisma.department.findUnique.mockResolvedValue({
        ...department,
        machines: []
      })
      mockNetworkService.getDepartmentIPUsage.mockResolvedValue({
        totalIPs: 254,
        usedIPs: 0,
        availableIPs: 254
      })

      const result = await resolver.getDepartmentStatistics(department.id)

      expect(result).toEqual({
        totalMachines: 0,
        runningMachines: 0,
        stoppedMachines: 0,
        totalCPUCores: 0,
        totalRAMGB: 0,
        totalDiskGB: 0,
        ipUsage: {
          totalIPs: 254,
          usedIPs: 0,
          availableIPs: 254
        }
      })
    })
  })

  describe('Authorization Tests', () => {
    it('should require ADMIN role for createDepartment', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        DepartmentResolver.prototype,
        'createDepartment'
      )
      expect(metadata).toBe('ADMIN')
    })

    it('should require ADMIN role for updateDepartment', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        DepartmentResolver.prototype,
        'updateDepartment'
      )
      expect(metadata).toBe('ADMIN')
    })

    it('should require ADMIN role for destroyDepartment', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        DepartmentResolver.prototype,
        'destroyDepartment'
      )
      expect(metadata).toBe('ADMIN')
    })

    it('should allow USER role for viewing departments', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        DepartmentResolver.prototype,
        'departments'
      )
      expect(metadata).toBe('USER')
    })
  })
})
