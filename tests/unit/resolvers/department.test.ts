import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DepartmentResolver } from '../../../app/graphql/resolvers/department/resolver'
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
import { InfinibayContext } from '../../../app/utils/context'
import { UserInputError } from 'apollo-server-errors'

describe('DepartmentResolver', () => {
  let resolver: DepartmentResolver
  const ctx = createAdminContext() as InfinibayContext

  beforeEach(() => {
    resolver = new DepartmentResolver()
    jest.clearAllMocks()
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
      
      expect(result).toEqual({
        id: department.id,
        name: department.name,
        createdAt: department.createdAt,
        internetSpeed: department.internetSpeed || undefined,
        ipSubnet: department.ipSubnet || undefined,
        totalMachines: 0
      })
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
        where: { name: 'Engineering' },
        include: {
          machines: true
        }
      })
      expect(result).toEqual({
        id: department.id,
        name: department.name,
        createdAt: department.createdAt,
        internetSpeed: department.internetSpeed || undefined,
        ipSubnet: department.ipSubnet || undefined,
        totalMachines: 0
      })
    })

    it('should return null if department not found by name', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null)

      const result = await resolver.findDepartmentByName('NonExistent', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Mutation: createDepartment', () => {
    it('should create a new department', async () => {
      const createdDepartment = createMockDepartment({ name: 'Engineering' })
      mockPrisma.department.create.mockResolvedValue(createdDepartment)

      const result = await resolver.createDepartment('Engineering', ctx)

      expect(mockPrisma.department.create).toHaveBeenCalledWith({
        data: { name: 'Engineering' }
      })
      expect(result).toEqual({
        id: createdDepartment.id,
        name: createdDepartment.name,
        createdAt: createdDepartment.createdAt,
        internetSpeed: createdDepartment.internetSpeed || undefined,
        ipSubnet: createdDepartment.ipSubnet || undefined,
        totalMachines: 0
      })
    })

    it('should create department with minimal data', async () => {
      const createdDepartment = createMockDepartment({ name: 'HR' })
      mockPrisma.department.create.mockResolvedValue(createdDepartment)

      const result = await resolver.createDepartment('HR', ctx)

      expect(mockPrisma.department.create).toHaveBeenCalledWith({
        data: { name: 'HR' }
      })
      expect(result).toEqual({
        id: createdDepartment.id,
        name: createdDepartment.name,
        createdAt: createdDepartment.createdAt,
        internetSpeed: createdDepartment.internetSpeed || undefined,
        ipSubnet: createdDepartment.ipSubnet || undefined,
        totalMachines: 0
      })
    })

  })

  describe('Mutation: destroyDepartment', () => {
    it('should delete department successfully', async () => {
      const department = createMockDepartment()

      mockPrisma.department.findUnique.mockResolvedValue(department)
      mockPrisma.machine.findMany.mockResolvedValue([]) // No machines in department
      mockPrisma.department.delete.mockResolvedValue(department)

      const result = await resolver.destroyDepartment(department.id, ctx)

      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: department.id }
      })
      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { departmentId: department.id }
      })
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: department.id }
      })
      expect(result).toEqual({
        id: department.id,
        name: department.name,
        createdAt: department.createdAt,
        internetSpeed: department.internetSpeed || undefined,
        ipSubnet: department.ipSubnet || undefined,
        totalMachines: 0
      })
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