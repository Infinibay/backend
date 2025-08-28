import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { NetworkService } from '../../../app/services/networkService'
import { Connection, Network } from 'libvirt-node'
import { XMLNetworkGenerator } from '../../../app/utils/VirtManager/xmlNetworkGenerator'

// Mock Domain type (not exported from libvirt-node)
interface MockDomain {
  getName: () => string | null
  getXmlDesc: (flags: number) => Promise<string | null>
}

// Mock dependencies
jest.mock('libvirt-node')
jest.mock('../../../app/utils/VirtManager/xmlNetworkGenerator')
jest.mock('xml2js', () => ({
  parseStringPromise: jest.fn()
}))

describe('NetworkService', () => {
  let networkService: NetworkService
  let mockConnection: jest.Mocked<Connection>
  let mockNetwork: jest.Mocked<Network>
  let mockParseStringPromise: jest.MockedFunction<(xml: string) => Promise<unknown>>

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock network object
    mockNetwork = {
      getName: jest.fn(() => 'test-network'),
      getXmlDesc: jest.fn(() => Promise.resolve('<network>test</network>')),
      create: jest.fn(() => Promise.resolve(0)),
      destroy: jest.fn(() => Promise.resolve(0)),
      undefine: jest.fn(() => Promise.resolve(0)),
      isActive: jest.fn(() => Promise.resolve(true))
    } as unknown as jest.Mocked<Network>

    // Mock connection
    mockConnection = {
      listAllNetworks: jest.fn(),
      listAllDomains: jest.fn()
    } as unknown as jest.Mocked<Connection>

    // Mock Connection.open
    ;(Connection.open as jest.Mock) = jest.fn(() => mockConnection)

    // Mock parseStringPromise
    const xml2js = require('xml2js')
    mockParseStringPromise = xml2js.parseStringPromise as jest.MockedFunction<(xml: string) => Promise<unknown>>

    // Mock XMLNetworkGenerator
    const mockXMLNetworkGenerator = {
      setForwardMode: jest.fn(),
      setIPConfiguration: jest.fn(),
      enableIntraNetworkCommunication: jest.fn(),
      enableService: jest.fn(),
      generateXML: jest.fn(() => Promise.resolve('<network>generated</network>'))
    } as unknown as jest.Mocked<XMLNetworkGenerator>

    ;(XMLNetworkGenerator as jest.MockedClass<typeof XMLNetworkGenerator>).mockImplementation(
      () => mockXMLNetworkGenerator
    )

    // Mock Network.defineXml
    ;(Network.defineXml as jest.Mock) = jest.fn(() => Promise.resolve(mockNetwork))

    // Create service instance
    networkService = new NetworkService()
  })

  describe('validateNetworkName', () => {
    it('should pass validation when network name is unique', async () => {
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue([])

      await expect(networkService.validateNetworkName('unique-network')).resolves.toBeUndefined()

      expect(mockConnection.listAllNetworks).toHaveBeenCalledWith(0)
    })

    it('should throw error when network name already exists', async () => {
      const existingNetwork = { getName: () => 'existing-network' }
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue([existingNetwork as Network])

      await expect(networkService.validateNetworkName('existing-network'))
        .rejects.toThrow('Network with name existing-network already exists')
    })

    it('should throw error when listing networks fails', async () => {
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(null)

      await expect(networkService.validateNetworkName('test-network'))
        .rejects.toThrow('Failed to list networks')
    })
  })

  describe('getAllNetworks', () => {
    it('should return all networks with parsed XML', async () => {
      const mockNetworks = [mockNetwork]
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(mockNetworks)
      mockParseStringPromise.mockResolvedValue({ network: { name: 'test-network' } })

      const result = await networkService.getAllNetworks()

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('test-network')
      expect(result[0].xml).toEqual({ name: 'test-network' })
      expect(mockConnection.listAllNetworks).toHaveBeenCalledWith(0)
    })

    it('should throw error when listing networks fails', async () => {
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(null)

      await expect(networkService.getAllNetworks())
        .rejects.toThrow('Failed to list networks')
    })
  })

  describe('getNetwork', () => {
    it('should return specific network by name', async () => {
      const mockNetworks = [mockNetwork]
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(mockNetworks)
      mockParseStringPromise.mockResolvedValue({ network: { name: 'test-network' } })

      const result = await networkService.getNetwork('test-network')

      expect(result.name).toBe('test-network')
      expect(result.xml).toEqual({ name: 'test-network' })
    })

    it('should throw error when network not found', async () => {
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue([])

      await expect(networkService.getNetwork('nonexistent-network'))
        .rejects.toThrow('Network nonexistent-network not found')
    })
  })

  describe('deleteNetwork', () => {
    it('should delete network when not in use', async () => {
      const mockNetworks = [mockNetwork]
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(mockNetworks)
      ;(mockConnection.listAllDomains as jest.Mock).mockResolvedValue([])
      
      mockParseStringPromise.mockResolvedValue({
        network: { bridge: [{ $: { name: 'test-bridge' } }] }
      })

      await networkService.deleteNetwork('test-network')

      expect(mockNetwork.isActive).toHaveBeenCalled()
      expect(mockNetwork.destroy).toHaveBeenCalled()
      expect(mockNetwork.undefine).toHaveBeenCalled()
    })

    it('should throw error when network is in use by VM', async () => {
      const mockDomain = {
        getName: () => 'test-vm',
        getXmlDesc: () => Promise.resolve('<domain><devices><interface type="network"><source network="test-network"/></interface></devices></domain>')
      }
      
      const mockNetworks = [mockNetwork]
      ;(mockConnection.listAllNetworks as jest.Mock).mockResolvedValue(mockNetworks)
      ;(mockConnection.listAllDomains as jest.Mock).mockResolvedValue([mockDomain as MockDomain])
      
      mockParseStringPromise
        .mockResolvedValueOnce({ network: { bridge: [{ $: { name: 'test-bridge' } }] } })
        .mockResolvedValueOnce({
          domain: {
            name: ['test-vm'],
            devices: [{
              interface: [{
                $: { type: 'network' },
                source: [{ $: { network: 'test-network' } }]
              }]
            }]
          }
        })

      await expect(networkService.deleteNetwork('test-network'))
        .rejects.toThrow('Cannot delete network test-network: it is in use by VM "test-vm"')
    })
  })
})