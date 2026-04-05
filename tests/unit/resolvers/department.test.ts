import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DepartmentResolver } from '../../../app/graphql/resolvers/department/resolver'
import { getEventManager } from '../../../app/services/events/EventManager'
import { DepartmentCleanupService } from '../../../app/services/cleanup/departmentCleanupService'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createMockDepartment,
  createMockDepartmentConfiguration,
  createMockDepartmentInput,
  createMockMachines,
  createMockDepartments
} from '../../setup/mock-factories'
import {
  createAdminContext,
  createMockContext
} from '../../setup/test-helpers'
import { InfinibayContext } from '../../../app/utils/context'
import { UserInputError } from 'apollo-server-errors'

const mockEventManager = {
  dispatchEvent: jest.fn()
}

const mockCleanupService = {
  cleanupDepartment: jest.fn()
}

const mockNetworkService = {
  configureNetwork: jest.fn()
}

jest.mock('../../../app/services/EventManager', () => ({
  getEventManager: () => mockEventManager
}))

jest.mock('../../../app/services/cleanup/departmentCleanupService', () => ({
  DepartmentCleanupService: jest.fn().mockImplementation(() => mockCleanupService)
}))

jest.mock('../../../app/services/network/DepartmentNetworkService', () => ({
  DepartmentNetworkService: jest.fn().mockImplementation(() => mockNetworkService)
}))

jest.mock('../../../app/services/firewall/FirewallRuleService', () => ({
  FirewallRuleService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../../../app/services/firewall/FirewallPolicyService', () => ({
  FirewallPolicyService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../../../app/services/firewall/FirewallOrchestrationService', () => ({
  FirewallOrchestrationService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../../../app/services/firewall/FirewallValidationService', () => ({
  FirewallValidationService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../../../app/services/firewall/InfinizationFirewallService', () => ({
  InfinizationFirewallService: jest.fn().mockImplementation(() => ({}))
}))

describe('DepartmentResolver', () => {
  let resolver: DepartmentResolver
  const ctx = createAdminContext() as InfinibayContext

  // Helper to build expected department response from a mock department
  function expectedDepartmentResponse (dept: any, totalMachines: number = 0) {
    return {
      id: dept.id,
      name: dept.name,
      createdAt: dept.createdAt,
      internetSpeed: dept.internetSpeed || undefined,
      ipSubnet: dept.ipSubnet || undefined,
      bridgeName: dept.bridgeName || undefined,
      gatewayIP: dept.gatewayIP || undefined,
      dnsServers: dept.dnsServers,
      ntpServers: dept.ntpServers,
      totalMachines,
      firewallPolicy: dept.firewallPolicy,
      firewallDefaultConfig: dept.firewallDefaultConfig || undefined,
      firewallCustomRules: dept.firewallCustomRules || undefined
    }
  }

  beforeEach(() => {
    resolver = new DepartmentResolver()
    jest.clearAllMocks()

    // Reset event manager mock
    mockEventManager.dispatchEvent.mockReset()

    // Reset cleanup service mock
    mockCleanupService.cleanupDepartment.mockReset()

    // Reset network service mock
    mockNetworkService.configureNetwork.mockReset()
  })

  describe('Query: department', () => {
    it('should return department by id with relations', async () => {
      const department = createMockDepartment()
      const departmentWithRelations = {
        ...department,
        machines: [] // Only include machines as that's what the resolver expects
      }

      mockPrisma.department.findUnique.mockResolvedValue(departmentWithRelations)

      const result = await resolver.department(department.id, ctx)

      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: department.id },
        include: {
          machines: true
        }
      })

      expect(result).toEqual(expectedDepartmentResponse(department, 0))
    })

    it('should return null if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      const result = await resolver.department('non-existent-id', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Query: departments', () => {
    it('should return all departments', async () => {
      const departments = createMockDepartments(5).map(dept => ({
        ...dept,
        machines: [] // Add machines array to each department
      }))

      mockPrisma.department.findMany.mockResolvedValue(departments)

      const result = await resolver.departments(ctx)

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith({ include: { machines: true } })
      expect(result).toHaveLength(5)
      expect(result[0]).toEqual(expect.objectContaining({
        id: departments[0].id,
        name: departments[0].name,
        totalMachines: 0
      }))
    })

    it('should return empty array when no departments exist', async () => {
      mockPrisma.department.findMany.mockResolvedValue([])

      const result = await resolver.departments(ctx)

      expect(result).toEqual([])
    })
  })

  describe('Query: findDepartmentByName', () => {
    it('should find department by name', async () => {
      const department = createMockDepartment({ name: 'Engineering' })
      const departmentWithRelations = {
        ...department,
        machines: [],
        nwFilters: [],
        configuration: null
      }

      mockPrisma.department.findFirst.mockResolvedValue(departmentWithRelations)

      const result = await resolver.findDepartmentByName('Engineering', ctx)

      expect(mockPrisma.department.findFirst).toHaveBeenCalledWith({
        where: {
          name: {
            equals: 'Engineering',
            mode: 'insensitive'
          }
        },
        include: {
          machines: true
        }
      })
      expect(result).toEqual(expectedDepartmentResponse(department, 0))
    })

    it('should return null if department not found by name', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null)

      const result = await resolver.findDepartmentByName('NonExistent', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Mutation: createDepartment', () => {
    it('should create a new department', async () => {
      const createdDepartment = createMockDepartment({ name: 'Engineering', ipSubnet: '10.10.1.0/24' })

      // Mock: no existing department with same name
      mockPrisma.department.findFirst.mockResolvedValue(null)
      // Mock: getNextAvailableSubnet - findMany returns empty array (no existing departments)
      mockPrisma.department.findMany.mockResolvedValue([])
      // Mock: department creation
      mockPrisma.department.create.mockResolvedValue(createdDepartment)
      // Mock: findUnique after network configuration
      mockPrisma.department.findUnique.mockResolvedValue(createdDepartment)
      // Mock: network configuration succeeds
      mockNetworkService.configureNetwork.mockResolvedValue(undefined as never)

      const result = await resolver.createDepartment('Engineering', null as any, ctx)

      expect(mockPrisma.department.create).toHaveBeenCalled()
      expect(result).toEqual(expectedDepartmentResponse(createdDepartment, 0))
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'departments',
        'create',
        { id: createdDepartment.id },
        ctx.user?.id
      )
    })

    it('should create department with minimal data', async () => {
      const createdDepartment = createMockDepartment({ name: 'HR', ipSubnet: '10.10.1.0/24' })

      mockPrisma.department.findFirst.mockResolvedValue(null)
      mockPrisma.department.findMany.mockResolvedValue([])
      mockPrisma.department.create.mockResolvedValue(createdDepartment)
      mockPrisma.department.findUnique.mockResolvedValue(createdDepartment)
      mockNetworkService.configureNetwork.mockResolvedValue(undefined as never)

      const result = await resolver.createDepartment('HR', null as any, ctx)

      expect(mockPrisma.department.create).toHaveBeenCalled()
      expect(result).toEqual(expectedDepartmentResponse(createdDepartment, 0))
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'departments',
        'create',
        { id: createdDepartment.id },
        ctx.user?.id
      )
    })
  })

  describe('Mutation: destroyDepartment', () => {
    it('should delete department successfully when no machines exist', async () => {
      const department = createMockDepartment()

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findMany.mockResolvedValue([]) // No machines in department
      mockCleanupService.cleanupDepartment.mockResolvedValue(undefined as never)

      const result = await resolver.destroyDepartment(department.id, ctx)

      // Verify proper sequence of operations
      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: department.id }
      })
      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { departmentId: department.id }
      })

      // Verify cleanup service was called
      expect(mockCleanupService.cleanupDepartment).toHaveBeenCalledWith(department.id)

      // Verify event dispatch for deletion
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'departments',
        'delete',
        { id: department.id },
        ctx.user?.id
      )

      // Verify returned department data
      expect(result).toEqual(expectedDepartmentResponse(department, 0))
    })

    it('should throw error if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        resolver.destroyDepartment('non-existent-id', ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if department has machines', async () => {
      const department = createMockDepartment()
      const machines = createMockMachines(2)

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findMany.mockResolvedValue(machines)

      await expect(
        resolver.destroyDepartment(department.id, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })
})
