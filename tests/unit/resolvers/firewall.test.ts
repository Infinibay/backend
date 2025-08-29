import 'reflect-metadata'
import { FirewallResolver } from '@resolvers/firewall/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext, createAdminContext } from '../../setup/test-helpers'
import { UserInputError, ForbiddenError } from 'apollo-server-errors'
import { NetworkFilterService } from '@services/networkFilterService'
import { FilterType } from '../../../app/graphql/resolvers/firewall/types'
import {
  createMockNWFilter,
  createMockFWRule,
  createMockDepartment,
  createMockMachine
} from '../../setup/mock-factories'

// Mock NetworkFilterService
jest.mock('@services/networkFilterService')

describe('FirewallResolver', () => {
  let resolver: FirewallResolver
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>
  const ctx = createAdminContext()

  beforeEach(() => {
    jest.clearAllMocks()
    mockNetworkFilterService = {
      connect: jest.fn(),
      close: jest.fn(),
      createFilter: jest.fn(),
      updateFilter: jest.fn(),
      deleteFilter: jest.fn(),
      createRule: jest.fn(),
      deleteRule: jest.fn(),
      flushNWFilter: jest.fn(),
      deduplicateRules: jest.fn()
    } as unknown as jest.Mocked<NetworkFilterService>

    resolver = new FirewallResolver(mockNetworkFilterService)
  })

  describe('Query: listFilters', () => {
    it('should return generic filters when no department or vm specified', async () => {
      const mockFilters = [
        createMockNWFilter({ id: 'filter-1', name: 'allow-http', type: 'generic' }),
        createMockNWFilter({ id: 'filter-2', name: 'block-ssh', type: 'generic' })
      ]

      mockPrisma.nWFilter.findMany.mockResolvedValue(
        mockFilters.map(f => ({ ...f, vms: [], departments: [], rules: [], references: [] }))
      )

      const result = await resolver.listFilters(ctx)

      expect(mockPrisma.nWFilter.findMany).toHaveBeenCalledWith({
        include: {
          vms: true,
          departments: true,
          rules: true,
          references: true
        },
        where: {
          type: 'generic'
        }
      })
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('allow-http')
    })

    it('should return department-specific filters', async () => {
      const departmentId = 'dept-123'
      const mockFilters = [
        createMockNWFilter({ id: 'filter-1', name: 'dept-filter' })
      ]

      mockPrisma.nWFilter.findMany.mockResolvedValue(
        mockFilters.map(f => ({ ...f, vms: [], departments: [{ id: departmentId }], rules: [], references: [] }))
      )

      const result = await resolver.listFilters(ctx, departmentId, null)

      expect(mockPrisma.nWFilter.findMany).toHaveBeenCalledWith({
        include: {
          vms: true,
          departments: true,
          rules: true,
          references: true
        },
        where: {
          departments: {
            some: {
              id: departmentId
            }
          }
        }
      })
      expect(result).toHaveLength(1)
    })

    it('should return VM-specific filters', async () => {
      const vmId = 'vm-123'
      const mockFilters = [
        createMockNWFilter({ id: 'filter-1', name: 'vm-filter' })
      ]

      mockPrisma.nWFilter.findMany.mockResolvedValue(
        mockFilters.map(f => ({ ...f, vms: [{ id: vmId }], departments: [], rules: [], references: [] }))
      )

      const result = await resolver.listFilters(ctx, null, vmId)

      expect(mockPrisma.nWFilter.findMany).toHaveBeenCalledWith({
        include: {
          vms: true,
          rules: true,
          references: true
        },
        where: {
          vms: {
            some: {
              id: vmId
            }
          }
        }
      })
      expect(result).toHaveLength(1)
    })

    it('should throw error when both departmentId and vmId are specified', async () => {
      await expect(
        resolver.listFilters(ctx, 'dept-123', 'vm-123')
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Query: getFilter', () => {
    it('should return a specific filter by ID', async () => {
      const mockFilter = createMockNWFilter({ id: 'filter-1', name: 'test-filter' })
      const mockFilterWithRelations = {
        ...mockFilter,
        vms: [],
        departments: [],
        rules: [createMockFWRule({ nwFilterId: 'filter-1' })],
        references: []
      }

      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRelations)

      const result = await resolver.getFilter('filter-1', ctx)

      expect(mockPrisma.nWFilter.findUnique).toHaveBeenCalledWith({
        where: { id: 'filter-1' },
        include: {
          rules: true,
          references: true
        }
      })
      expect(result?.name).toBe('test-filter')
    })

    it('should return null when filter not found', async () => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(null)

      const result = await resolver.getFilter('nonexistent', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Query: listFilterRules', () => {
    it('should return rules for a specific filter', async () => {
      const filterId = 'filter-1'
      const mockRules = [
        createMockFWRule({ id: 'rule-1', nwFilterId: filterId }),
        createMockFWRule({ id: 'rule-2', nwFilterId: filterId })
      ]

      mockPrisma.fWRule.findMany.mockResolvedValue(mockRules)

      const result = await resolver.listFilterRules(filterId, ctx)

      expect(mockPrisma.fWRule.findMany).toHaveBeenCalledWith({
        where: { nwFilterId: filterId }
      })
      expect(result).toHaveLength(2)
    })

    it('should return all rules when no filter specified', async () => {
      const mockRules = [
        createMockFWRule({ id: 'rule-1' }),
        createMockFWRule({ id: 'rule-2' }),
        createMockFWRule({ id: 'rule-3' })
      ]

      mockPrisma.fWRule.findMany.mockResolvedValue(mockRules)

      const result = await resolver.listFilterRules(null, ctx)

      expect(mockPrisma.fWRule.findMany).toHaveBeenCalledWith()
      expect(result).toHaveLength(3)
    })
  })

  describe('Mutation: createFilter', () => {
    it('should create a new filter', async () => {
      const input = {
        name: 'new-filter',
        description: 'Test filter',
        type: FilterType.GENERIC,
        chain: 'root',
        priority: 500
      }

      const mockCreatedFilter = createMockNWFilter({
        ...input,
        id: 'filter-new',
        internalName: 'new-filter',
        uuid: 'uuid-123'
      })

      mockNetworkFilterService.createFilter.mockResolvedValue(mockCreatedFilter)

      const result = await resolver.createFilter(input)

      expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
        input.name,
        input.description,
        input.chain,
        input.type
      )
      expect(result.name).toBe('new-filter')
    })

    it('should handle creation errors', async () => {
      const input = {
        name: 'new-filter',
        description: 'Test filter',
        type: FilterType.GENERIC,
        chain: 'root'
      }

      mockNetworkFilterService.createFilter.mockRejectedValue(
        new UserInputError('Filter name already exists')
      )

      await expect(resolver.createFilter(input)).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: updateFilter', () => {
    it('should update an existing filter', async () => {
      const filterId = 'filter-1'
      const input = {
        description: 'Updated description',
        priority: 600
      }

      const existingFilter = createMockNWFilter({ id: filterId })
      const updatedFilter = { ...existingFilter, ...input }

      // Reset the mock to ensure clean state
      mockNetworkFilterService.updateFilter.mockReset()

      mockPrisma.nWFilter.findUnique.mockResolvedValue(existingFilter)
      mockPrisma.nWFilter.update.mockResolvedValue(updatedFilter)
      mockPrisma.fWRule.findMany.mockResolvedValue([])
      mockPrisma.filterReference.findMany.mockResolvedValue([])
      mockNetworkFilterService.updateFilter.mockResolvedValue(updatedFilter)

      const result = await resolver.updateFilter(filterId, input, ctx)

      expect(mockNetworkFilterService.updateFilter).toHaveBeenCalled()
      expect(result.description).toBe('Updated description')
    })

    it('should handle filter not found case', async () => {
      const input = { description: 'test' }
      const mockResult = createMockNWFilter({ description: 'test' })

      mockPrisma.nWFilter.findUnique.mockResolvedValue(null)
      mockPrisma.fWRule.findMany.mockResolvedValue([])
      mockPrisma.filterReference.findMany.mockResolvedValue([])
      mockNetworkFilterService.updateFilter.mockResolvedValue(mockResult)

      const result = await resolver.updateFilter('nonexistent', input, ctx)

      expect(result).toBeDefined()
    })
  })

  describe('Mutation: deleteFilter', () => {
    it('should delete a filter', async () => {
      const filterId = 'filter-1'
      const mockFilter = createMockNWFilter({ id: filterId })

      mockPrisma.nWFilter.delete.mockResolvedValue(mockFilter)

      const result = await resolver.deleteFilter(filterId, ctx)

      expect(mockPrisma.nWFilter.delete).toHaveBeenCalledWith({
        where: { id: filterId }
      })
      expect(result).toBe(true)
    })

    it('should handle filter deletion', async () => {
      const mockFilter = createMockNWFilter({ id: 'filter-1' })
      mockPrisma.nWFilter.delete.mockResolvedValue(mockFilter)

      const result = await resolver.deleteFilter('filter-1', ctx)

      expect(result).toBe(true)
    })
  })

  describe('Mutation: createFilterRule', () => {
    it('should create a new filter rule', async () => {
      const filterId = 'filter-1'
      const input = {
        filterId,
        protocol: 'tcp',
        action: 'accept',
        direction: 'in',
        priority: 100,
        srcPortStart: undefined,
        srcPortEnd: undefined,
        dstPortStart: 80,
        dstPortEnd: 80,
        comment: undefined,
        ipVersion: undefined,
        state: undefined
      }

      const mockCreatedRule = createMockFWRule({
        ...input,
        id: 'rule-new',
        nwFilterId: filterId
      })

      mockNetworkFilterService.createRule.mockResolvedValue(mockCreatedRule)

      const result = await resolver.createFilterRule(filterId, input, ctx)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        filterId,
        input.action,
        input.direction,
        input.priority,
        input.protocol || 'all',
        undefined, // port parameter
        {
          srcPortStart: input.srcPortStart,
          srcPortEnd: input.srcPortEnd,
          dstPortStart: input.dstPortStart,
          dstPortEnd: input.dstPortEnd,
          comment: input.comment,
          ipVersion: input.ipVersion,
          state: input.state
        }
      )
      expect(result.protocol).toBe('tcp')
    })

    it('should handle rule creation', async () => {
      const input = { filterId: 'filter-1', protocol: 'tcp', action: 'accept', direction: 'in', priority: 100 }
      const mockRule = createMockFWRule(input)

      mockNetworkFilterService.createRule.mockResolvedValue(mockRule)

      const result = await resolver.createFilterRule('filter-1', input, ctx)

      expect(result).toBeDefined()
    })
  })

  describe('Mutation: updateFilterRule', () => {
    it('should update a filter rule', async () => {
      const ruleId = 'rule-1'
      const input = {
        priority: 200,
        action: 'drop',
        direction: 'out'
      }

      const existingRule = createMockFWRule({ id: ruleId, nwFilterId: 'filter-1' })
      const updatedRule = { ...existingRule, ...input }

      mockPrisma.fWRule.findUnique.mockResolvedValue(existingRule)
      mockPrisma.fWRule.update.mockResolvedValue(updatedRule)

      const result = await resolver.updateFilterRule(ruleId, input, ctx)

      expect(mockPrisma.fWRule.update).toHaveBeenCalledWith({
        where: { id: ruleId },
        data: input
      })
      expect(result.action).toBe('drop')
    })

    it('should handle rule update', async () => {
      const input = { priority: 100, action: 'accept', direction: 'in' }
      const mockRule = createMockFWRule({ ...input, id: 'rule-1' })

      mockPrisma.fWRule.findUnique.mockResolvedValue(null)
      mockPrisma.fWRule.update.mockResolvedValue(mockRule)

      const result = await resolver.updateFilterRule('rule-1', input, ctx)

      expect(result).toBeDefined()
    })
  })

  describe('Mutation: deleteFilterRule', () => {
    it('should delete a filter rule', async () => {
      const ruleId = 'rule-1'
      const mockRule = createMockFWRule({ id: ruleId, nwFilterId: 'filter-1' })

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockPrisma.fWRule.delete.mockResolvedValue(mockRule)

      const result = await resolver.deleteFilterRule(ruleId, ctx)

      expect(mockPrisma.fWRule.delete).toHaveBeenCalledWith({
        where: { id: ruleId }
      })
      expect(result).toBe(true)
    })

    it('should handle rule deletion', async () => {
      const mockRule = createMockFWRule({ id: 'rule-1' })

      mockPrisma.fWRule.findUnique.mockResolvedValue(null)
      mockPrisma.fWRule.delete.mockResolvedValue(mockRule)

      const result = await resolver.deleteFilterRule('rule-1', ctx)

      expect(result).toBe(true)
    })
  })

  describe('Mutation: flushNWFilter', () => {
    it('should flush a filter to libvirt', async () => {
      const filterId = 'filter-1'
      const mockFilter = createMockNWFilter({ id: filterId })

      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilter)
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)

      const result = await resolver.flushFilter(filterId, ctx)

      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(filterId)
      expect(result).toBe(true)
    })

    it('should handle filter flush', async () => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(null)
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)

      const result = await resolver.flushFilter('filter-1', ctx)

      expect(result).toBe(true)
    })
  })
})
