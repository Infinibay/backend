/**
 * @deprecated These tests are for legacy libvirt-based firewall services.
 * See FirewallManagerV2.test.ts and InfinivirtFirewallService tests for current implementation.
 */
import { LibvirtNWFilterService } from '@services/firewall/LibvirtNWFilterService'

// Mock the libvirt-node module
jest.mock('@infinibay/libvirt-node', () => {
  class MockNWFilter {
    static defineXml = jest.fn()
    static lookupByName = jest.fn()
    getName = jest.fn()
    getUuidString = jest.fn()
    getXmlDesc = jest.fn()
    undefine = jest.fn()
  }

  class MockMachine {
    static defineXml = jest.fn()
    static lookupByName = jest.fn()
    getName = jest.fn()
    getXmlDesc = jest.fn()
  }

  return {
    __esModule: true,
    Connection: jest.fn(),
    NWFilter: MockNWFilter,
    Machine: MockMachine
  }
})

describe('LibvirtNWFilterService', () => {
  let service: LibvirtNWFilterService
  let mockConnection: any
  let mockFilter: any

  beforeEach(() => {
    // Create mock instances
    mockFilter = {
      getName: jest.fn(),
      getUuidString: jest.fn(),
      getXmlDesc: jest.fn(),
      undefine: jest.fn()
    }

    mockConnection = {
      lookupByName: jest.fn(),
      defineXML: jest.fn(),
      listAllNwFilters: jest.fn()
    }

    service = new LibvirtNWFilterService(mockConnection)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('defineFilter', () => {
    it('should define a new nwfilter and return its UUID', async () => {
      const testXML = '<filter name="ibay-test-123"><uuid>test-uuid-456</uuid></filter>'

      // Get the mocked NWFilter from the mocked module
      const { NWFilter } = require('@infinibay/libvirt-node')

      mockFilter.getUuidString.mockReturnValue('test-uuid-456');
      (NWFilter.defineXml as jest.Mock).mockReturnValue(mockFilter)

      const uuid = await service.defineFilter(testXML)

      expect(NWFilter.defineXml).toHaveBeenCalledWith(mockConnection, testXML)
      expect(uuid).toBe('test-uuid-456')
    })

    it('should throw error when filter definition fails', async () => {
      const testXML = '<filter name="ibay-invalid"></filter>'

      const { NWFilter } = require('@infinibay/libvirt-node');
      (NWFilter.defineXml as jest.Mock).mockReturnValue(null)

      await expect(service.defineFilter(testXML)).rejects.toThrow('Failed to define nwfilter in libvirt')
    })
  })

  describe('undefineFilter', () => {
    it('should remove an existing filter', async () => {
      const filterName = 'ibay-test-123'

      const { NWFilter } = require('@infinibay/libvirt-node');
      (NWFilter.lookupByName as jest.Mock).mockReturnValue(mockFilter)
      mockFilter.undefine.mockReturnValue(0)

      await service.undefineFilter(filterName)

      expect(NWFilter.lookupByName).toHaveBeenCalledWith(mockConnection, filterName)
      expect(mockFilter.undefine).toHaveBeenCalled()
    })

    it('should not throw when filter does not exist', async () => {
      const filterName = 'ibay-nonexistent'

      const { NWFilter } = require('@infinibay/libvirt-node');
      (NWFilter.lookupByName as jest.Mock).mockReturnValue(null)

      await expect(service.undefineFilter(filterName)).resolves.not.toThrow()
    })
  })

  describe('listAllInfinibayFilters', () => {
    it('should list all filters with ibay- prefix', async () => {
      const mockFilters = [
        { getName: () => 'ibay-dept-abc123' },
        { getName: () => 'clean-traffic' },
        { getName: () => 'ibay-vm-def456' },
        { getName: () => 'no-spoofing' }
      ] as any[]

      mockConnection.listAllNwFilters.mockResolvedValue(mockFilters)

      const result = await service.listAllInfinibayFilters()

      expect(result).toEqual(['ibay-dept-abc123', 'ibay-vm-def456'])
    })

    it('should return empty array when no infinibay filters exist', async () => {
      const mockFilters = [
        { getName: () => 'clean-traffic' },
        { getName: () => 'no-spoofing' }
      ] as any[]

      mockConnection.listAllNwFilters.mockResolvedValue(mockFilters)

      const result = await service.listAllInfinibayFilters()

      expect(result).toEqual([])
    })
  })

  describe('cleanupAllInfinibayFilters', () => {
    it('should remove all infinibay filters', async () => {
      const mockFilters = [
        { getName: () => 'ibay-dept-abc123' },
        { getName: () => 'ibay-vm-def456' },
        { getName: () => 'ibay-vm-ghi789' }
      ] as any[]

      const { NWFilter } = require('@infinibay/libvirt-node')

      mockConnection.listAllNwFilters.mockResolvedValue(mockFilters);
      (NWFilter.lookupByName as jest.Mock).mockReturnValue(mockFilter)
      mockFilter.undefine.mockReturnValue(0)

      const result = await service.cleanupAllInfinibayFilters()

      expect(result.removed).toEqual(['ibay-dept-abc123', 'ibay-vm-def456', 'ibay-vm-ghi789'])
      expect(mockFilter.undefine).toHaveBeenCalledTimes(3)
    })

    it('should continue cleanup even when filter does not exist', async () => {
      // When a filter doesn't exist, undefineFilter doesn't throw an error,
      // so it's still counted as successfully processed
      const mockFilters = [
        { getName: () => 'ibay-dept-abc123' },
        { getName: () => 'ibay-vm-def456' }
      ] as any[]

      const { NWFilter } = require('@infinibay/libvirt-node')

      mockConnection.listAllNwFilters.mockResolvedValue(mockFilters);
      (NWFilter.lookupByName as jest.Mock)
        .mockReturnValueOnce(mockFilter)
        .mockReturnValueOnce(null) // Second filter doesn't exist
      mockFilter.undefine.mockReturnValue(0)

      const result = await service.cleanupAllInfinibayFilters()

      // Both are in the removed list because undefineFilter doesn't throw when filter doesn't exist
      expect(result.removed).toEqual(['ibay-dept-abc123', 'ibay-vm-def456'])
    })
  })
})
