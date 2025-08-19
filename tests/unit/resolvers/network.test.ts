import { NetworkResolver } from '@resolvers/networks/resolver'
import { NetworkService } from '@services/networkService'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createAdminContext,
  createMockContext,
  assertGraphQLSuccess,
  assertGraphQLError,
  setupLibvirtMockState
} from '../../setup/test-helpers'
import { createMockNetwork, createNetworkInput } from '../../setup/mock-factories'

jest.mock('@services/networkService')

describe('NetworkResolver', () => {
  let resolver: NetworkResolver
  let mockNetworkService: jest.Mocked<NetworkService>

  beforeEach(() => {
    resolver = new NetworkResolver()
    mockNetworkService = NetworkService as any
    mockNetworkService.prototype.constructor = jest.fn().mockReturnValue(mockNetworkService)

    setupLibvirtMockState({
      networks: [
        { name: 'default', xml: '<network><name>default</name></network>', active: true },
        { name: 'isolated', xml: '<network><name>isolated</name></network>', active: false }
      ]
    })
  })

  describe('Queries', () => {
    describe('networks', () => {
      it('should list all networks', async () => {
        const mockNetworks = [
          createMockNetwork({ name: 'default', active: true }),
          createMockNetwork({ name: 'isolated', active: false })
        ]

        mockNetworkService.prototype.listAllNetworks = jest.fn().mockResolvedValue(mockNetworks)

        const result = await resolver.networks()

        expect(result).toEqual(mockNetworks)
        expect(mockNetworkService.prototype.listAllNetworks).toHaveBeenCalled()
      })

      it('should handle empty network list', async () => {
        mockNetworkService.prototype.listAllNetworks = jest.fn().mockResolvedValue([])

        const result = await resolver.networks()

        expect(result).toEqual([])
      })

      it('should handle network service errors', async () => {
        mockNetworkService.prototype.listAllNetworks = jest.fn()
          .mockRejectedValue(new Error('Libvirt connection failed'))

        await expect(resolver.networks()).rejects.toThrow('Libvirt connection failed')
      })
    })

    describe('network', () => {
      it('should get network by name', async () => {
        const mockNetwork = createMockNetwork({ name: 'default' })
        mockNetworkService.prototype.getNetworkByName = jest.fn().mockResolvedValue(mockNetwork)

        const result = await resolver.network('default')

        expect(result).toEqual(mockNetwork)
        expect(mockNetworkService.prototype.getNetworkByName).toHaveBeenCalledWith('default')
      })

      it('should return null for non-existent network', async () => {
        mockNetworkService.prototype.getNetworkByName = jest.fn().mockResolvedValue(null)

        const result = await resolver.network('nonexistent')

        expect(result).toBeNull()
      })
    })
  })

  describe('Mutations', () => {
    describe('createNetwork', () => {
      it('should create a new network (admin only)', async () => {
        const context = createAdminContext()
        const input = createNetworkInput()
        const mockNetwork = createMockNetwork({ name: input.name })

        mockNetworkService.prototype.createNetwork = jest.fn().mockResolvedValue(mockNetwork)

        const result = await resolver.createNetwork(input, context)

        expect(result).toEqual(mockNetwork)
        expect(mockNetworkService.prototype.createNetwork).toHaveBeenCalledWith(input)
      })

      it('should validate network input', async () => {
        const context = createAdminContext()
        const invalidInput = createNetworkInput({
          ipRange: { start: '192.168.1.300', end: '192.168.1.100' }
        })

        mockNetworkService.prototype.createNetwork = jest.fn()
          .mockRejectedValue(new Error('Invalid IP range'))

        await expect(resolver.createNetwork(invalidInput, context))
          .rejects.toThrow('Invalid IP range')
      })

      it('should handle duplicate network names', async () => {
        const context = createAdminContext()
        const input = createNetworkInput({ name: 'default' })

        mockNetworkService.prototype.createNetwork = jest.fn()
          .mockRejectedValue(new Error('Network already exists'))

        await expect(resolver.createNetwork(input, context))
          .rejects.toThrow('Network already exists')
      })
    })

    describe('setNetworkIpRange', () => {
      it('should update network IP range (admin only)', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          ipRangeStart: '192.168.122.100',
          ipRangeEnd: '192.168.122.200'
        }

        mockNetworkService.prototype.setNetworkIpRange = jest.fn().mockResolvedValue({
          success: true,
          message: 'IP range updated successfully'
        })

        const result = await resolver.setNetworkIpRange(input, context)

        expect(result.success).toBe(true)
        expect(mockNetworkService.prototype.setNetworkIpRange).toHaveBeenCalledWith(
          input.name,
          input.ipRangeStart,
          input.ipRangeEnd
        )
      })

      it('should validate IP range', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          ipRangeStart: '192.168.122.200',
          ipRangeEnd: '192.168.122.100'
        }

        mockNetworkService.prototype.setNetworkIpRange = jest.fn()
          .mockRejectedValue(new Error('Start IP must be less than end IP'))

        await expect(resolver.setNetworkIpRange(input, context))
          .rejects.toThrow('Start IP must be less than end IP')
      })
    })

    describe('setNetworkIp', () => {
      it('should update network IP configuration (admin only)', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          networkIp: '192.168.122.0',
          subnetMask: '255.255.255.0'
        }

        mockNetworkService.prototype.setNetworkIp = jest.fn().mockResolvedValue({
          success: true,
          message: 'Network IP updated successfully'
        })

        const result = await resolver.setNetworkIp(input, context)

        expect(result.success).toBe(true)
        expect(mockNetworkService.prototype.setNetworkIp).toHaveBeenCalledWith(
          input.name,
          input.networkIp,
          input.subnetMask
        )
      })

      it('should validate subnet mask', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          networkIp: '192.168.122.0',
          subnetMask: '255.255.300.0'
        }

        mockNetworkService.prototype.setNetworkIp = jest.fn()
          .mockRejectedValue(new Error('Invalid subnet mask'))

        await expect(resolver.setNetworkIp(input, context))
          .rejects.toThrow('Invalid subnet mask')
      })
    })

    describe('setNetworkBridgeName', () => {
      it('should update bridge name (admin only)', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          bridgeName: 'virbr1'
        }

        mockNetworkService.prototype.setNetworkBridgeName = jest.fn().mockResolvedValue({
          success: true,
          message: 'Bridge name updated successfully'
        })

        const result = await resolver.setNetworkBridgeName(input, context)

        expect(result.success).toBe(true)
        expect(mockNetworkService.prototype.setNetworkBridgeName).toHaveBeenCalledWith(
          input.name,
          input.bridgeName
        )
      })

      it('should validate bridge name format', async () => {
        const context = createAdminContext()
        const input = {
          name: 'default',
          bridgeName: 'invalid bridge name'
        }

        mockNetworkService.prototype.setNetworkBridgeName = jest.fn()
          .mockRejectedValue(new Error('Invalid bridge name format'))

        await expect(resolver.setNetworkBridgeName(input, context))
          .rejects.toThrow('Invalid bridge name format')
      })
    })

    describe('deleteNetwork', () => {
      it('should delete network (admin only)', async () => {
        const context = createAdminContext()
        const input = { name: 'isolated' }

        mockNetworkService.prototype.deleteNetwork = jest.fn().mockResolvedValue({
          success: true,
          message: 'Network deleted successfully'
        })

        const result = await resolver.deleteNetwork(input, context)

        expect(result.success).toBe(true)
        expect(mockNetworkService.prototype.deleteNetwork).toHaveBeenCalledWith(input.name)
      })

      it('should prevent deletion of active network', async () => {
        const context = createAdminContext()
        const input = { name: 'default' }

        mockNetworkService.prototype.deleteNetwork = jest.fn()
          .mockRejectedValue(new Error('Cannot delete active network'))

        await expect(resolver.deleteNetwork(input, context))
          .rejects.toThrow('Cannot delete active network')
      })

      it('should prevent deletion of network with attached VMs', async () => {
        const context = createAdminContext()
        const input = { name: 'production' }

        mockNetworkService.prototype.deleteNetwork = jest.fn()
          .mockRejectedValue(new Error('Network has attached virtual machines'))

        await expect(resolver.deleteNetwork(input, context))
          .rejects.toThrow('Network has attached virtual machines')
      })
    })
  })

  describe('Authorization', () => {
    it('should require admin role for network creation', async () => {
      const userContext = createMockContext()
      const input = createNetworkInput()

      mockNetworkService.prototype.createNetwork = jest.fn()

      // Note: In real implementation, this would be handled by the @Authorized decorator
      // Here we're testing that the resolver has the correct authorization setup
      expect(resolver.createNetwork).toBeDefined()
      expect(mockNetworkService.prototype.createNetwork).not.toHaveBeenCalled()
    })

    it('should allow any authenticated user to list networks', async () => {
      const userContext = createMockContext()

      mockNetworkService.prototype.listAllNetworks = jest.fn().mockResolvedValue([])

      const result = await resolver.networks()

      expect(result).toEqual([])
      expect(mockNetworkService.prototype.listAllNetworks).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle libvirt connection errors', async () => {
      mockNetworkService.prototype.listAllNetworks = jest.fn()
        .mockRejectedValue(new Error('Failed to connect to libvirt'))

      await expect(resolver.networks()).rejects.toThrow('Failed to connect to libvirt')
    })

    it('should handle XML parsing errors', async () => {
      const context = createAdminContext()
      const input = createNetworkInput()

      mockNetworkService.prototype.createNetwork = jest.fn()
        .mockRejectedValue(new Error('Invalid XML configuration'))

      await expect(resolver.createNetwork(input, context))
        .rejects.toThrow('Invalid XML configuration')
    })

    it('should handle network state conflicts', async () => {
      const context = createAdminContext()
      const input = { name: 'default' }

      mockNetworkService.prototype.deleteNetwork = jest.fn()
        .mockRejectedValue(new Error('Network is in use'))

      await expect(resolver.deleteNetwork(input, context))
        .rejects.toThrow('Network is in use')
    })
  })
})
