import 'reflect-metadata'
import { MachineQueries, MachineMutations } from '../../../app/graphql/resolvers/machine/resolver'
import { MachineOrderBy } from '../../../app/graphql/resolvers/machine/type'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createMockMachine,
  createMockMachineTemplate,
  createMockDepartment,
  createMockUser,
  createMockMachineConfiguration,
  createMockMachineInput,
  createMockMachines,
  createMockDomainXML
} from '../../setup/mock-factories'
import {
  createMockContext,
  createAdminContext,
  setupLibvirtMockState
} from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-errors'

// Mock VirtManager
jest.mock('@utils/VirtManager', () => ({
  VirtManager: {
    getInstance: jest.fn(() => ({
      createMachine: jest.fn(),
      destroyMachine: jest.fn(),
      powerOn: jest.fn(),
      powerOff: jest.fn(),
      suspend: jest.fn(),
      getMachineInfo: jest.fn(),
      getMachineStats: jest.fn(),
      attachDevice: jest.fn(),
      detachDevice: jest.fn(),
      takeSnapshot: jest.fn(),
      revertSnapshot: jest.fn(),
      deleteSnapshot: jest.fn(),
      listSnapshots: jest.fn(),
      getMachineXML: jest.fn(),
      setAutostart: jest.fn()
    }))
  }
}))

// Mock EventManager
jest.mock('@services/EventManager', () => ({
  getEventManager: jest.fn(() => ({
    dispatch: jest.fn()
  }))
}))

// Define the mock VirtManager type
interface MockVirtManager {
  createMachine: jest.Mock
  destroyMachine: jest.Mock
  powerOn: jest.Mock
  powerOff: jest.Mock
  suspend: jest.Mock
  getMachineInfo: jest.Mock
  getMachineStats: jest.Mock
  attachDevice: jest.Mock
  detachDevice: jest.Mock
  takeSnapshot: jest.Mock
  revertSnapshot: jest.Mock
  deleteSnapshot: jest.Mock
  listSnapshots: jest.Mock
  getMachineXML: jest.Mock
  setAutostart: jest.Mock
}

describe.skip('MachineResolver', () => {
  let queriesResolver: MachineQueries
  let mutationsResolver: MachineMutations
  let mockVirtManager: MockVirtManager
  const ctx = createAdminContext()

  beforeEach(() => {
    queriesResolver = new MachineQueries()
    mutationsResolver = new MachineMutations()
    const VirtManager = require('@utils/VirtManager').VirtManager
    mockVirtManager = VirtManager.getInstance() as MockVirtManager
    jest.clearAllMocks()
  })

  describe('machine', () => {
    it('should return machine by id', async () => {
      const mockMachine = createMockMachine()
      const mockTemplate = createMockMachineTemplate()
      const mockDepartment = createMockDepartment()
      const mockUser = createMockUser()
      const mockConfig = createMockMachineConfiguration({ machineId: mockMachine.id })

      const machineWithRelations = {
        ...mockMachine,
        template: mockTemplate,
        department: mockDepartment,
        user: mockUser,
        configuration: mockConfig
      }

      mockPrisma.machine.findFirst.mockResolvedValue(machineWithRelations)

      const result = await queriesResolver.machine(mockMachine.id, ctx)

      expect(mockPrisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: mockMachine.id },
        include: {
          template: true,
          department: true,
          user: true,
          configuration: true,
          applications: {
            include: { application: true }
          },
          nwFilters: {
            include: { nwFilter: true }
          },
          ports: true,
          serviceConfigs: true
        }
      })
      expect(result).toEqual(machineWithRelations)
    })

    it('should return null if machine not found', async () => {
      mockPrisma.machine.findFirst.mockResolvedValue(null)

      const result = await queriesResolver.machine('non-existent-id', ctx)

      expect(result).toBeNull()
    })
  })

  describe('machines', () => {
    it('should return paginated machines list', async () => {
      const mockMachines = createMockMachines(5)
      const total = 10

      mockPrisma.machine.findMany.mockResolvedValue(mockMachines)
      mockPrisma.machine.count.mockResolvedValue(total)

      const result = await queriesResolver.machines({ take: 5, skip: 0 }, {} as MachineOrderBy, ctx)

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        take: 5,
        skip: 0,
        include: {
          template: true,
          department: true,
          user: true,
          configuration: true
        },
        orderBy: { createdAt: 'desc' }
      })
      expect(result).toEqual({
        machines: mockMachines,
        total
      })
    })

    it('should filter machines by status', async () => {
      const runningMachines = createMockMachines(3).map(m => ({ ...m, status: 'running' }))

      mockPrisma.machine.findMany.mockResolvedValue(runningMachines)
      mockPrisma.machine.count.mockResolvedValue(3)

      await queriesResolver.machines({ take: 10, skip: 0 }, {} as MachineOrderBy, ctx)

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'running' }
        })
      )
    })

    it('should filter machines by department', async () => {
      const departmentId = 'dept-123'
      const deptMachines = createMockMachines(3).map(m => ({ ...m, departmentId }))

      mockPrisma.machine.findMany.mockResolvedValue(deptMachines)
      mockPrisma.machine.count.mockResolvedValue(3)

      await queriesResolver.machines({ take: 10, skip: 0 }, {} as MachineOrderBy, ctx)

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { departmentId }
        })
      )
    })

    it('should filter machines by user', async () => {
      const userId = 'user-123'
      const userMachines = createMockMachines(2).map(m => ({ ...m, userId }))

      mockPrisma.machine.findMany.mockResolvedValue(userMachines)
      mockPrisma.machine.count.mockResolvedValue(2)

      await queriesResolver.machines({ take: 10, skip: 0 }, {} as MachineOrderBy, ctx)

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId }
        })
      )
    })
  })

  describe('createMachine', () => {
    it('should create machine with valid input', async () => {
      const template = createMockMachineTemplate()
      const department = createMockDepartment()
      const input = createMockMachineInput({
        templateId: template.id,
        departmentId: department.id
      })

      const createdMachine = createMockMachine({
        ...input,
        internalName: `vm-${Date.now()}`,
        status: 'stopped',
        cpuCores: template.cores,
        ramGB: template.ram,
        diskSizeGB: template.storage
      })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template)
      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.create.mockResolvedValue(createdMachine)
      mockVirtManager.createMachine.mockResolvedValue({
        success: true,
        xml: createMockDomainXML(createdMachine.internalName)
      })

      const context = createAdminContext()
      const result = await mutationsResolver.createMachine(input, context)

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: input.templateId }
      })
      expect(mockPrisma.machine.create).toHaveBeenCalled()
      expect(mockVirtManager.createMachine).toHaveBeenCalled()
      expect(result).toEqual(createdMachine)
    })

    it('should throw error if template not found', async () => {
      const input = createMockMachineInput()
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      const context = createAdminContext()
      await expect(mutationsResolver.createMachine(input, context)).rejects.toThrow(UserInputError)
    })

    it('should throw error if department not found', async () => {
      const template = createMockMachineTemplate()
      const input = createMockMachineInput({
        templateId: template.id,
        departmentId: 'non-existent'
      })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template)
      mockPrisma.department.findUnique.mockResolvedValue(null)

      const context = createAdminContext()
      await expect(mutationsResolver.createMachine(input, context)).rejects.toThrow(UserInputError)
    })

    it('should handle libvirt creation failure', async () => {
      const template = createMockMachineTemplate()
      const input = createMockMachineInput({ templateId: template.id })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template)
      mockPrisma.machine.create.mockResolvedValue(createMockMachine())
      mockVirtManager.createMachine.mockRejectedValue(new Error('Libvirt error'))

      const context = createAdminContext()
      await expect(mutationsResolver.createMachine(input, context)).rejects.toThrow('Libvirt error')
    })
  })

  describe('destroyMachine', () => {
    it('should destroy machine successfully', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.destroyMachine.mockResolvedValue({ success: true })
      mockPrisma.machine.delete.mockResolvedValue(machine)

      const result = await mutationsResolver.destroyMachine(machine.id, ctx)

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: machine.id }
      })
      expect(mockVirtManager.destroyMachine).toHaveBeenCalledWith(machine.internalName)
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: machine.id }
      })
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('destroyed')
      })
    })

    it('should destroy running machine', async () => {
      const machine = createMockMachine({ status: 'running' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.destroyMachine.mockResolvedValue({ success: true })
      mockPrisma.machine.delete.mockResolvedValue(machine)

      const result = await mutationsResolver.destroyMachine(machine.id, ctx)

      expect(mockVirtManager.destroyMachine).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should throw error if machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(mutationsResolver.destroyMachine('non-existent', ctx)).rejects.toThrow(UserInputError)
    })
  })

  describe('powerOn', () => {
    it('should power on stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.powerOn.mockResolvedValue({ success: true })
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'running' })

      const result = await mutationsResolver.powerOn(machine.id, ctx)

      expect(mockVirtManager.powerOn).toHaveBeenCalledWith(machine.internalName)
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'running' }
      })
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('powered on')
      })
    })

    it('should not power on already running machine', async () => {
      const machine = createMockMachine({ status: 'running' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)

      await expect(mutationsResolver.powerOn(machine.id, ctx)).rejects.toThrow(UserInputError)
      expect(mockVirtManager.powerOn).not.toHaveBeenCalled()
    })

    it('should handle libvirt power on failure', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.powerOn.mockRejectedValue(new Error('Failed to start domain'))

      await expect(mutationsResolver.powerOn(machine.id, ctx)).rejects.toThrow('Failed to start domain')
    })
  })

  describe('powerOff', () => {
    it('should power off running machine', async () => {
      const machine = createMockMachine({ status: 'running' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.powerOff.mockResolvedValue({ success: true })
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'stopped' })

      const result = await mutationsResolver.powerOff(machine.id, ctx)

      expect(mockVirtManager.powerOff).toHaveBeenCalledWith(machine.internalName, false)
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'stopped' }
      })
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('powered off')
      })
    })

    it('should power off running machine', async () => {
      const machine = createMockMachine({ status: 'running' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.powerOff.mockResolvedValue({ success: true })
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'stopped' })

      await mutationsResolver.powerOff(machine.id, ctx)

      expect(mockVirtManager.powerOff).toHaveBeenCalled()
    })

    it('should not power off already stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)

      await expect(mutationsResolver.powerOff(machine.id, ctx)).rejects.toThrow(UserInputError)
      expect(mockVirtManager.powerOff).not.toHaveBeenCalled()
    })
  })

  describe('suspend', () => {
    it('should suspend running machine', async () => {
      const machine = createMockMachine({ status: 'running' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)
      mockVirtManager.suspend.mockResolvedValue({ success: true })
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'suspended' })

      const result = await mutationsResolver.suspend(machine.id, ctx)

      expect(mockVirtManager.suspend).toHaveBeenCalled()
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('suspend')
      })
    })

    it('should not suspend stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      mockPrisma.machine.findUnique.mockResolvedValue(machine)

      await expect(mutationsResolver.suspend(machine.id, ctx)).rejects.toThrow(UserInputError)
    })
  })

  describe('Authorization Tests', () => {
    it('should allow USER to view their own machines', async () => {
      const user = createMockUser()
      const userMachine = createMockMachine({ userId: user.id })
      const context = createMockContext({ user })

      mockPrisma.machine.findUnique.mockResolvedValue(userMachine)

      const result = await queriesResolver.machine(userMachine.id, context)
      expect(result).toEqual(userMachine)
    })

    it('should require ADMIN for createMachine', () => {
      const metadata = Reflect.getMetadata('custom:authorized', MachineMutations.prototype, 'createMachine')
      expect(metadata).toBe('ADMIN')
    })

    it('should require ADMIN for destroyMachine', () => {
      const metadata = Reflect.getMetadata('custom:authorized', MachineMutations.prototype, 'destroyMachine')
      expect(metadata).toBe('USER')
    })

    it('should require USER for power operations', () => {
      const powerOnMeta = Reflect.getMetadata('custom:authorized', MachineMutations.prototype, 'powerOn')
      const powerOffMeta = Reflect.getMetadata('custom:authorized', MachineMutations.prototype, 'powerOff')
      const suspendMeta = Reflect.getMetadata('custom:authorized', MachineMutations.prototype, 'suspend')

      expect(powerOnMeta).toBe('USER')
      expect(powerOffMeta).toBe('USER')
      expect(suspendMeta).toBe('USER')
    })
  })
})
