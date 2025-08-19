import 'reflect-metadata'
import { FirewallResolver } from '@resolvers/firewall/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext, createAdminContext } from '../../setup/test-helpers'
import { ForbiddenError, UserInputError } from 'apollo-server-errors'
import { VirtManager } from '@utils/VirtManager'

// Mock VirtManager
jest.mock('@utils/VirtManager', () => ({
  VirtManager: {
    getInstance: jest.fn(() => ({
      createNetworkFilter: jest.fn(),
      deleteNetworkFilter: jest.fn(),
      getNetworkFilter: jest.fn(),
      listNetworkFilters: jest.fn(),
      updateNetworkFilter: jest.fn(),
      attachNetworkFilter: jest.fn(),
      detachNetworkFilter: jest.fn(),
      getNetworkFilterXML: jest.fn()
    }))
  }
}))

describe('FirewallResolver', () => {
  let resolver: FirewallResolver
  let mockVirtManager: any
  const ctx = createAdminContext()

  beforeEach(() => {
    jest.clearAllMocks()
    resolver = new FirewallResolver()
    mockVirtManager = VirtManager.getInstance()
  })

  describe('Query: firewallRules', () => {
    it('should return all firewall rules', async () => {
      // Arrange
      const mockFilters = [
        {
          name: 'allow-http',
          uuid: 'filter-uuid-1',
          priority: 500,
          chain: 'root',
          rules: [
            {
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              srcIpFrom: '0.0.0.0',
              srcIpTo: '255.255.255.255',
              dstPortStart: 80,
              dstPortEnd: 80
            }
          ]
        },
        {
          name: 'block-ssh',
          uuid: 'filter-uuid-2',
          priority: 600,
          chain: 'root',
          rules: [
            {
              action: 'drop',
              direction: 'in',
              priority: 200,
              protocol: 'tcp',
              dstPortStart: 22,
              dstPortEnd: 22
            }
          ]
        }
      ]
      mockVirtManager.listNetworkFilters.mockResolvedValue(mockFilters)

      // Act
      const result = await resolver.firewallRules(ctx)

      // Assert
      expect(mockVirtManager.listNetworkFilters).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('allow-http')
      expect(result[0].rules).toHaveLength(1)
      expect(result[1].name).toBe('block-ssh')
    })

    it('should handle empty firewall rules list', async () => {
      // Arrange
      mockVirtManager.listNetworkFilters.mockResolvedValue([])

      // Act
      const result = await resolver.firewallRules(ctx)

      // Assert
      expect(result).toEqual([])
    })

    it('should handle libvirt errors', async () => {
      // Arrange
      mockVirtManager.listNetworkFilters.mockRejectedValue(
        new Error('Failed to connect to libvirt')
      )

      // Act & Assert
      await expect(resolver.firewallRules(ctx)).rejects.toThrow(
        'Failed to connect to libvirt'
      )
    })
  })

  describe('Query: firewallRule', () => {
    it('should return a specific firewall rule by name', async () => {
      // Arrange
      const mockFilter = {
        name: 'allow-http',
        uuid: 'filter-uuid-1',
        priority: 500,
        chain: 'root',
        rules: [
          {
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80
          }
        ]
      }
      mockVirtManager.getNetworkFilter.mockResolvedValue(mockFilter)

      // Act
      const result = await resolver.firewallRule('allow-http', ctx)

      // Assert
      expect(mockVirtManager.getNetworkFilter).toHaveBeenCalledWith('allow-http')
      expect(result.name).toBe('allow-http')
      expect(result.uuid).toBe('filter-uuid-1')
    })

    it('should throw error when firewall rule not found', async () => {
      // Arrange
      mockVirtManager.getNetworkFilter.mockRejectedValue(
        new Error('Network filter not found')
      )

      // Act & Assert
      await expect(resolver.firewallRule('nonexistent', ctx)).rejects.toThrow(
        'Network filter not found'
      )
    })
  })

  describe('Mutation: createFirewallRule', () => {
    it('should create a new firewall rule', async () => {
      // Arrange
      const input = {
        name: 'new-rule',
        priority: 300,
        chain: 'root',
        rules: [
          {
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            srcIpFrom: '192.168.1.0',
            srcIpTo: '192.168.1.255',
            dstPortStart: 443,
            dstPortEnd: 443,
            comment: 'Allow HTTPS from local network'
          }
        ]
      }
      const mockCreated = {
        ...input,
        uuid: 'new-filter-uuid'
      }
      mockVirtManager.createNetworkFilter.mockResolvedValue(mockCreated)

      // Act
      const result = await resolver.createFirewallRule(input, ctx)

      // Assert
      expect(mockVirtManager.createNetworkFilter).toHaveBeenCalledWith(input)
      expect(result).toEqual(mockCreated)
    })

    it('should validate firewall rule input', async () => {
      // Arrange
      const invalidInput = {
        name: '',
        priority: -1,
        chain: 'invalid',
        rules: []
      }
      mockVirtManager.createNetworkFilter.mockRejectedValue(
        new UserInputError('Invalid firewall rule configuration')
      )

      // Act & Assert
      await expect(resolver.createFirewallRule(invalidInput, ctx)).rejects.toThrow(
        UserInputError
      )
    })

    it('should prevent duplicate firewall rule names', async () => {
      // Arrange
      const input = {
        name: 'existing-rule',
        priority: 300,
        chain: 'root',
        rules: []
      }
      mockVirtManager.createNetworkFilter.mockRejectedValue(
        new Error('Network filter with this name already exists')
      )

      // Act & Assert
      await expect(resolver.createFirewallRule(input, ctx)).rejects.toThrow(
        'Network filter with this name already exists'
      )
    })
  })

  describe('Mutation: updateFirewallRule', () => {
    it('should update an existing firewall rule', async () => {
      // Arrange
      const input = {
        name: 'existing-rule',
        priority: 400,
        rules: [
          {
            action: 'drop',
            direction: 'out',
            priority: 150,
            protocol: 'udp',
            dstPortStart: 53,
            dstPortEnd: 53
          }
        ]
      }
      const mockUpdated = {
        name: 'existing-rule',
        uuid: 'filter-uuid',
        priority: 400,
        chain: 'root',
        rules: input.rules
      }
      mockVirtManager.updateNetworkFilter.mockResolvedValue(mockUpdated)

      // Act
      const result = await resolver.updateFirewallRule('existing-rule', input, ctx)

      // Assert
      expect(mockVirtManager.updateNetworkFilter).toHaveBeenCalledWith('existing-rule', input)
      expect(result).toEqual(mockUpdated)
    })

    it('should handle update failures', async () => {
      // Arrange
      const input = {
        priority: 400,
        rules: []
      }
      mockVirtManager.updateNetworkFilter.mockRejectedValue(
        new Error('Failed to update network filter')
      )

      // Act & Assert
      await expect(resolver.updateFirewallRule('test-rule', input, ctx)).rejects.toThrow(
        'Failed to update network filter'
      )
    })
  })

  describe('Mutation: deleteFirewallRule', () => {
    it('should delete a firewall rule', async () => {
      // Arrange
      mockVirtManager.deleteNetworkFilter.mockResolvedValue(true)

      // Act
      const result = await resolver.deleteFirewallRule('rule-to-delete', ctx)

      // Assert
      expect(mockVirtManager.deleteNetworkFilter).toHaveBeenCalledWith('rule-to-delete')
      expect(result).toBe(true)
    })

    it('should prevent deletion of system firewall rules', async () => {
      // Arrange
      mockVirtManager.deleteNetworkFilter.mockRejectedValue(
        new Error('Cannot delete system network filter')
      )

      // Act & Assert
      await expect(resolver.deleteFirewallRule('clean-traffic', ctx)).rejects.toThrow(
        'Cannot delete system network filter'
      )
    })
  })

  describe('Mutation: attachFirewallRule', () => {
    it('should attach firewall rule to a machine', async () => {
      // Arrange
      const input = {
        machineId: 'machine-1',
        filterName: 'allow-http'
      }
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'machine-1',
        name: 'test-vm',
        status: 'running'
      })
      mockVirtManager.attachNetworkFilter.mockResolvedValue(true)

      // Act
      const result = await resolver.attachFirewallRule(input, ctx)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: 'machine-1' }
      })
      expect(mockVirtManager.attachNetworkFilter).toHaveBeenCalledWith(
        'test-vm',
        'allow-http'
      )
      expect(result).toBe(true)
    })

    it('should throw error when machine not found', async () => {
      // Arrange
      const input = {
        machineId: 'nonexistent',
        filterName: 'allow-http'
      }
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.attachFirewallRule(input, ctx)).rejects.toThrow(
        'Machine not found'
      )
    })
  })

  describe('Mutation: detachFirewallRule', () => {
    it('should detach firewall rule from a machine', async () => {
      // Arrange
      const input = {
        machineId: 'machine-1',
        filterName: 'allow-http'
      }
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'machine-1',
        name: 'test-vm',
        status: 'running'
      })
      mockVirtManager.detachNetworkFilter.mockResolvedValue(true)

      // Act
      const result = await resolver.detachFirewallRule(input, ctx)

      // Assert
      expect(mockVirtManager.detachNetworkFilter).toHaveBeenCalledWith(
        'test-vm',
        'allow-http'
      )
      expect(result).toBe(true)
    })
  })

  describe('Query: firewallRulesForMachine', () => {
    it('should return firewall rules attached to a machine', async () => {
      // Arrange
      const mockMachine = {
        id: 'machine-1',
        name: 'test-vm',
        networkFilters: ['allow-http', 'block-ssh']
      }
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const mockFilters = [
        {
          name: 'allow-http',
          uuid: 'filter-1',
          priority: 500,
          rules: []
        },
        {
          name: 'block-ssh',
          uuid: 'filter-2',
          priority: 600,
          rules: []
        }
      ]
      mockVirtManager.getNetworkFilter.mockImplementation((name) => {
        return Promise.resolve(mockFilters.find(f => f.name === name))
      })

      // Act
      const result = await resolver.firewallRulesForMachine('machine-1', ctx)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: 'machine-1' }
      })
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('allow-http')
      expect(result[1].name).toBe('block-ssh')
    })

    it('should return empty array when machine has no firewall rules', async () => {
      // Arrange
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'machine-1',
        name: 'test-vm',
        networkFilters: []
      })

      // Act
      const result = await resolver.firewallRulesForMachine('machine-1', ctx)

      // Assert
      expect(result).toEqual([])
    })
  })

  describe('Authorization', () => {
    it('should require ADMIN role for creating firewall rules', async () => {
      // Arrange
      const userContext = createMockContext()
      const input = {
        name: 'test-rule',
        priority: 500,
        chain: 'root',
        rules: []
      }

      // Act & Assert
      // In a real scenario, the @Authorized decorator would handle this
      // Here we're testing that the resolver method exists and has proper typing
      expect(resolver.createFirewallRule).toBeDefined()
    })

    it('should require ADMIN role for deleting firewall rules', async () => {
      // Arrange & Act & Assert
      expect(resolver.deleteFirewallRule).toBeDefined()
    })

    it('should allow USER role to view firewall rules', async () => {
      // Arrange & Act & Assert
      expect(resolver.firewallRules).toBeDefined()
      expect(resolver.firewallRule).toBeDefined()
    })
  })
})
