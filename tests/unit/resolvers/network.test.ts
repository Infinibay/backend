import 'reflect-metadata'
import { NetworkResolver } from '@graphql/resolvers/networks/resolver'
import { NetworkService } from '@services/networkService'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createAdminContext,
  createMockContext,
  assertGraphQLSuccess,
  assertGraphQLError,
  setupLibvirtMockState
} from '../../setup/test-helpers'
import type { 
  CreateNetworkInput, 
  DeleteNetworkInput, 
  IpRangeInput, 
  NetworkIpInput, 
  BridgeNameInput 
} from '@graphql/resolvers/networks/types'

// Mock NetworkService
jest.mock('@services/networkService')

describe('NetworkResolver', () => {
  let resolver: NetworkResolver
  let mockNetworkService: jest.Mocked<NetworkService>
  const context = createAdminContext()

  beforeEach(() => {
    jest.clearAllMocks()
    resolver = new NetworkResolver()
    
    // Create a proper mock instance
    mockNetworkService = {
      getAllNetworks: jest.fn(),
      getNetwork: jest.fn(),
      createNetwork: jest.fn(),
      deleteNetwork: jest.fn(),
      setNetworkIp: jest.fn(),
      setIpRange: jest.fn(),
      setBridgeName: jest.fn()
    } as unknown as jest.Mocked<NetworkService>
    
    // Replace the service in the resolver
    (resolver as unknown as { networkService: jest.Mocked<NetworkService> }).networkService = mockNetworkService

    setupLibvirtMockState({
      networks: [
        { name: 'default', xml: '<network><name>default</name></network>', active: true },
        { name: 'isolated', xml: '<network><name>isolated</name></network>', active: false }
      ]
    })
  })

  describe('Query: networks', () => {
    it('should return all networks', async () => {
      const mockNetworks = [
        { name: 'default', xml: { uuid: ['uuid1'], bridge: [{ $: { name: 'br0', stp: 'on', delay: '0' } }], ip: [{ $: { address: '192.168.1.1', netmask: '255.255.255.0' } }] } },
        { name: 'isolated', xml: { uuid: ['uuid2'] } }
      ]

      mockNetworkService.getAllNetworks.mockResolvedValue(mockNetworks)

      const result = await resolver.networks()

      expect(mockNetworkService.getAllNetworks).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('default')
      expect(result[1].name).toBe('isolated')
    })

    it('should return empty array when no networks', async () => {
      mockNetworkService.getAllNetworks.mockResolvedValue([])

      const result = await resolver.networks()

      expect(result).toEqual([])
    })
  })

  describe('Query: network', () => {
    it('should return network by name', async () => {
      const mockNetwork = { 
        name: 'default', 
        xml: { 
          uuid: ['test-uuid'],
          bridge: [{ $: { name: 'br0', stp: 'on', delay: '0' } }],
          ip: [{ $: { address: '192.168.1.1', netmask: '255.255.255.0' } }]
        } 
      }
      mockNetworkService.getNetwork.mockResolvedValue(mockNetwork)

      const result = await resolver.network('default')

      expect(mockNetworkService.getNetwork).toHaveBeenCalledWith('default')
      expect(result.name).toBe('default')
      expect(result.uuid).toBe('test-uuid')
    })
  })

  describe('Mutation: createNetwork', () => {
    it('should create a new network', async () => {
      const input: CreateNetworkInput = {
        name: 'new-network',
        bridgeName: 'br0',
        description: 'Test network'
      }

      mockNetworkService.createNetwork.mockResolvedValue(undefined)

      const result = await resolver.createNetwork(input)

      expect(mockNetworkService.createNetwork).toHaveBeenCalledWith(input)
      expect(result).toBe(true)
    })

    it('should handle creation errors', async () => {
      const input: CreateNetworkInput = {
        name: 'default',
        bridgeName: 'br0',
        description: 'Duplicate network'
      }
      
      mockNetworkService.createNetwork.mockRejectedValue(
        new Error('Network with name default already exists')
      )

      await expect(resolver.createNetwork(input))
        .rejects.toThrow('Network with name default already exists')
    })
  })

  describe('Mutation: setNetworkIpRange', () => {
    it('should set network IP range', async () => {
      const input: IpRangeInput = {
        networkName: 'default',
        start: '192.168.122.100',
        end: '192.168.122.200'
      }

      mockNetworkService.setIpRange.mockResolvedValue(undefined)

      const result = await resolver.setNetworkIpRange(input)

      expect(mockNetworkService.setIpRange).toHaveBeenCalledWith('default', '192.168.122.100', '192.168.122.200')
      expect(result).toBe(true)
    })
  })

  describe('Mutation: setNetworkIp', () => {
    it('should set network IP configuration', async () => {
      const input: NetworkIpInput = {
        networkName: 'default',
        address: '192.168.1.1',
        netmask: '255.255.255.0'
      }

      mockNetworkService.setNetworkIp.mockResolvedValue(undefined)

      const result = await resolver.setNetworkIp(input)

      expect(mockNetworkService.setNetworkIp).toHaveBeenCalledWith('default', '192.168.1.1', '255.255.255.0')
      expect(result).toBe(true)
    })
  })

  describe('Mutation: setNetworkBridgeName', () => {
    it('should set network bridge name', async () => {
      const input: BridgeNameInput = {
        networkName: 'default',
        bridgeName: 'br1'
      }

      mockNetworkService.setBridgeName.mockResolvedValue(undefined)

      const result = await resolver.setNetworkBridgeName(input)

      expect(mockNetworkService.setBridgeName).toHaveBeenCalledWith('default', 'br1')
      expect(result).toBe(true)
    })
  })

  describe('Mutation: deleteNetwork', () => {
    it('should delete a network', async () => {
      const input: DeleteNetworkInput = {
        name: 'isolated'
      }

      mockNetworkService.deleteNetwork.mockResolvedValue(undefined)

      const result = await resolver.deleteNetwork(input)

      expect(mockNetworkService.deleteNetwork).toHaveBeenCalledWith('isolated')
      expect(result).toBe(true)
    })

    it('should handle deletion errors', async () => {
      const input: DeleteNetworkInput = {
        name: 'default'
      }

      mockNetworkService.deleteNetwork.mockRejectedValue(
        new Error('Cannot delete default network')
      )

      await expect(resolver.deleteNetwork(input))
        .rejects.toThrow('Failed to delete network: Cannot delete default network')
    })
  })

})