import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NetworkFilterService } from '../../../app/services/networkFilterService';
import { mockPrisma } from '../../setup/jest.setup';
import { createMockNWFilter, createMockFWRule } from '../../setup/mock-factories';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Mock libvirt-node
jest.mock('libvirt-node', () => ({
  Connection: { open: jest.fn(), close: jest.fn() },
  NwFilter: { lookupByName: jest.fn(), defineXml: jest.fn() }
}));

import { Connection, NwFilter } from 'libvirt-node';

// Mock xml2js
const mockBuilder = {
  buildObject: jest.fn()
};
const mockParser = {
  parseString: jest.fn()
};

jest.mock('xml2js', () => ({
  Builder: jest.fn(() => mockBuilder),
  Parser: jest.fn(() => mockParser)
}));

// Mock crypto
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn()
}));

describe('NetworkFilterService', () => {
  let networkFilterService: NetworkFilterService;
  const mockCrypto = crypto as jest.Mocked<typeof crypto>;
  const mockUuid = uuidv4 as jest.MockedFunction<typeof uuidv4>;

  beforeEach(() => {
    jest.clearAllMocks();
    networkFilterService = new NetworkFilterService(mockPrisma);

    // Setup default mocks
    mockCrypto.randomBytes.mockReturnValue(Buffer.from('testbytes'));
    mockUuid.mockReturnValue('test-uuid-1234');
    mockBuilder.buildObject.mockReturnValue('<xml>test</xml>');
    (Connection.open as jest.Mock).mockResolvedValue({});
    (NwFilter.lookupByName as jest.Mock).mockResolvedValue(null);
    (NwFilter.defineXml as jest.Mock).mockResolvedValue({});
  });

  describe('createFilter', () => {
    it('should create filter with all parameters', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);

      const result = await networkFilterService.createFilter(
        'test-filter',
        'Test description',
        'INPUT',
        'generic'
      );

      expect(mockPrisma.nWFilter.create).toHaveBeenCalledWith({
        data: {
          uuid: 'test-uuid-1234',
          name: 'test-filter',
          description: 'Test description',
          internalName: expect.stringMatching(/^ibay-[0-9a-f]{16}$/),
          chain: 'INPUT',
          type: 'generic'
        }
      });
      expect(result).toEqual(mockFilter);
    });

    it('should generate unique internalName using crypto', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);
      mockCrypto.randomBytes.mockReturnValue(Buffer.from('uniquebytes'));

      await networkFilterService.createFilter('test', 'desc', 'INPUT', 'generic');

      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(8);
      expect(mockPrisma.nWFilter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          internalName: expect.stringMatching(/^ibay-[0-9a-f]{16}$/)
        })
      });
    });

    it('should generate UUID for the filter', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);
      mockUuid.mockReturnValue('custom-uuid-5678');

      await networkFilterService.createFilter('test', 'desc', 'INPUT', 'generic');

      expect(mockUuid).toHaveBeenCalled();
      expect(mockPrisma.nWFilter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          uuid: 'custom-uuid-5678'
        })
      });
    });

    it('should handle different filter types', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);

      await networkFilterService.createFilter('test', 'desc', 'INPUT', 'department');

      expect(mockPrisma.nWFilter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'department'
        })
      });
    });

    it('should handle null chain parameter', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);

      await networkFilterService.createFilter('test', 'desc', null, 'generic');

      expect(mockPrisma.nWFilter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chain: null
        })
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      mockPrisma.nWFilter.create.mockRejectedValue(error);

      await expect(
        networkFilterService.createFilter('test', 'desc', 'INPUT', 'generic')
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateFilter', () => {
    it('should update filter with provided data', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.update.mockResolvedValue(mockFilter);

      const result = await networkFilterService.updateFilter('filter-id', {
        name: 'updated-name',
        description: 'updated description'
      });

      expect(mockPrisma.nWFilter.update).toHaveBeenCalledWith({
        where: { id: 'filter-id' },
        data: {
          name: 'updated-name',
          description: 'updated description'
        }
      });
      expect(result).toEqual(mockFilter);
    });

    it('should handle partial updates', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.update.mockResolvedValue(mockFilter);

      await networkFilterService.updateFilter('filter-id', {
        name: 'only-name'
      });

      expect(mockPrisma.nWFilter.update).toHaveBeenCalledWith({
        where: { id: 'filter-id' },
        data: {
          name: 'only-name'
        }
      });
    });

    it('should handle updating type and chain', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.update.mockResolvedValue(mockFilter);

      await networkFilterService.updateFilter('filter-id', {
        type: 'vm',
        chain: 'OUTPUT'
      });

      expect(mockPrisma.nWFilter.update).toHaveBeenCalledWith({
        where: { id: 'filter-id' },
        data: {
          type: 'vm',
          chain: 'OUTPUT'
        }
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Filter not found');
      mockPrisma.nWFilter.update.mockRejectedValue(error);

      await expect(
        networkFilterService.updateFilter('invalid-id', { name: 'test' })
      ).rejects.toThrow('Filter not found');
    });
  });

  describe('deleteFilter', () => {
    it('should delete filter by ID', async () => {
      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.delete.mockResolvedValue(mockFilter);

      const result = await networkFilterService.deleteFilter('filter-id');

      expect(mockPrisma.nWFilter.delete).toHaveBeenCalledWith({
        where: { id: 'filter-id' }
      });
      expect(result).toEqual(mockFilter);
    });

    it('should propagate Prisma errors when filter not found', async () => {
      const error = new Error('Filter not found');
      mockPrisma.nWFilter.delete.mockRejectedValue(error);

      await expect(
        networkFilterService.deleteFilter('invalid-id')
      ).rejects.toThrow('Filter not found');
    });
  });

  describe('createRule', () => {
    it('should create rule with all required parameters', async () => {
      const mockRule = createMockFWRule();
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockResolvedValue(mockRule);

      const result = await networkFilterService.createRule(
        'filter-id',
        'accept',
        'in',
        'all',
        undefined,
        {}
      );

      expect(mockPrisma.fWRule.findFirst).toHaveBeenCalledWith({
        where: {
          nwFilterId: 'filter-id',
          action: 'accept',
          direction: 'in',
          protocol: 'all',
          srcPortStart: null,
          srcPortEnd: null,
          dstPortStart: null,
          dstPortEnd: null,
          srcIpAddr: null,
          dstIpAddr: null,
          comment: null
        }
      });

      expect(mockPrisma.fWRule.create).toHaveBeenCalledWith({
        data: {
          nwFilterId: 'filter-id',
          action: 'accept',
          direction: 'in',
          protocol: 'all',
          srcPortStart: null,
          srcPortEnd: null,
          dstPortStart: null,
          dstPortEnd: null,
          srcIpAddr: null,
          dstIpAddr: null,
          comment: null,
          state: null,
          ipVersion: null
        }
      });
      expect(result).toEqual(mockRule);
    });

    it('should handle optional parameters', async () => {
      const mockRule = createMockFWRule();
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockResolvedValue(mockRule);

      await networkFilterService.createRule(
        'filter-id',
        'drop',
        'out',
        'tcp',
        undefined,
        {
          srcPortStart: 80,
          srcPortEnd: 443,
          dstPortStart: 8080,
          dstPortEnd: 8090,
          srcIpAddr: '192.168.1.0/24',
          dstIpAddr: '10.0.0.1',
          comment: 'Test rule',
          state: { established: true },
          ipVersion: 'ipv4'
        }
      );

      expect(mockPrisma.fWRule.create).toHaveBeenCalledWith({
        data: {
          nwFilterId: 'filter-id',
          action: 'drop',
          direction: 'out',
          protocol: 'tcp',
          srcPortStart: 80,
          srcPortEnd: 443,
          dstPortStart: 8080,
          dstPortEnd: 8090,
          srcIpAddr: '192.168.1.0/24',
          dstIpAddr: '10.0.0.1',
          comment: 'Test rule',
          state: { established: true },
          ipVersion: 'ipv4'
        }
      });
    });

    it('should detect and return existing identical rules', async () => {
      const existingRule = createMockFWRule();
      mockPrisma.fWRule.findFirst.mockResolvedValue(existingRule);

      const result = await networkFilterService.createRule(
        'filter-id',
        'accept',
        'in',
        1
      );

      expect(mockPrisma.fWRule.create).not.toHaveBeenCalled();
      expect(result).toEqual(existingRule);
    });

    it('should handle different protocols', async () => {
      const mockRule = createMockFWRule();
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockResolvedValue(mockRule);

      await networkFilterService.createRule(
        'filter-id',
        'accept',
        'in',
        'udp',
        undefined,
        {}
      );

      expect(mockPrisma.fWRule.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          protocol: 'udp'
        })
      });
    });

    it('should use default protocol "all" when not specified', async () => {
      const mockRule = createMockFWRule();
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockResolvedValue(mockRule);

      await networkFilterService.createRule('filter-id', 'accept', 'in', 'all', undefined, {});

      expect(mockPrisma.fWRule.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          protocol: 'all'
        })
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      mockPrisma.fWRule.findFirst.mockRejectedValue(error);

      await expect(
        networkFilterService.createRule('filter-id', 'accept', 'in', 'all', undefined, {})
      ).rejects.toThrow('Database error');
    });
  });

  describe('deleteRule', () => {
    it('should delete rule by ID', async () => {
      const mockRule = createMockFWRule();
      mockPrisma.fWRule.delete.mockResolvedValue(mockRule);

      const result = await networkFilterService.deleteRule('rule-id');

      expect(mockPrisma.fWRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-id' }
      });
      expect(result).toEqual(mockRule);
    });

    it('should propagate Prisma errors when rule not found', async () => {
      const error = new Error('Rule not found');
      mockPrisma.fWRule.delete.mockRejectedValue(error);

      await expect(
        networkFilterService.deleteRule('invalid-id')
      ).rejects.toThrow('Rule not found');
    });
  });

  describe('flushNWFilter', () => {
    const mockFilterWithRules = {
      ...createMockNWFilter(),
      internalName: 'ibay-test',
      rules: [createMockFWRule()],
      referencedBy: []
    };

    beforeEach(() => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRules);
      mockPrisma.nWFilter.update.mockResolvedValue(mockFilterWithRules);
    });

    it('should connect to hypervisor using Connection.open', async () => {
      await networkFilterService.flushNWFilter('filter-id', false);

      expect(Connection.open).toHaveBeenCalledWith('qemu:///system');
    });

    it('should lookup existing filter by internalName', async () => {
      await networkFilterService.flushNWFilter('filter-id', false);

      expect(NwFilter.lookupByName).toHaveBeenCalledWith(expect.any(Object), 'ibay-test');
    });

    it('should handle redefine parameter - undefine existing filter when true', async () => {
      const existingFilter = { undefine: jest.fn() };
      (NwFilter.lookupByName as jest.Mock).mockResolvedValue(existingFilter);

      await networkFilterService.flushNWFilter('filter-id', true);

      expect(existingFilter.undefine).toHaveBeenCalled();
    });

    it('should ignore "nwfilter is in use" errors during undefine', async () => {
      const existingFilter = {
        undefine: jest.fn().mockRejectedValue(new Error('nwfilter is in use'))
      };
      (NwFilter.lookupByName as jest.Mock).mockResolvedValue(existingFilter);

      const result = await networkFilterService.flushNWFilter('filter-id', true);

      expect(result).toBe(true);
    });

    it('should build XML from filter and rules data', async () => {
      await networkFilterService.flushNWFilter('filter-id', false);

      expect(mockBuilder.buildObject).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            $: expect.objectContaining({
              name: 'ibay-test'
            })
          })
        })
      );
    });

    it('should handle different rule protocols in XML generation', async () => {
      const tcpRule = { ...createMockFWRule(), protocol: 'tcp', dstPortStart: 80 };
      const udpRule = { ...createMockFWRule(), protocol: 'udp', srcPortStart: 53 };
      const icmpRule = { ...createMockFWRule(), protocol: 'icmp' };
      const macRule = { ...createMockFWRule(), protocol: 'mac' };

      mockPrisma.nWFilter.findUnique.mockResolvedValue({
        ...mockFilterWithRules,
        rules: [tcpRule, udpRule, icmpRule, macRule]
      });

      await networkFilterService.flushNWFilter('filter-id', false);

      expect(mockBuilder.buildObject).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            rule: expect.arrayContaining([
              expect.objectContaining({
                $: expect.objectContaining({ action: tcpRule.action }),
                tcp: expect.any(Object)
              }),
              expect.objectContaining({
                $: expect.objectContaining({ action: udpRule.action }),
                udp: expect.any(Object)
              }),
              expect.objectContaining({
                $: expect.objectContaining({ action: icmpRule.action }),
                icmp: expect.any(Object)
              }),
              expect.objectContaining({
                $: expect.objectContaining({ action: macRule.action }),
                mac: expect.any(Object)
              })
            ])
          })
        })
      );
    });

    it('should include referenced filters in XML', async () => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue({
        ...mockFilterWithRules,
        referencedBy: [
          { targetFilter: { internalName: 'ref-filter-1', priority: 500 } },
          { targetFilter: { internalName: 'ref-filter-2', priority: 300 } }
        ]
      });

      await networkFilterService.flushNWFilter('filter-id', false);

      expect(mockBuilder.buildObject).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            filterref: [
              { $: { filter: 'ref-filter-1', priority: '500' } },
              { $: { filter: 'ref-filter-2', priority: '300' } }
            ]
          })
        })
      );
    });

    it('should define filter using NwFilter.defineXml', async () => {
      await networkFilterService.flushNWFilter('filter-id', false);

      expect(NwFilter.defineXml).toHaveBeenCalledWith(expect.any(Object), '<xml>test</xml>');
    });

    it('should update filter flushedAt timestamp', async () => {
      await networkFilterService.flushNWFilter('filter-id', false);

      expect(mockPrisma.nWFilter.update).toHaveBeenCalledWith({
        where: { id: mockFilterWithRules.id },
        data: { flushedAt: expect.any(Date) }
      });
    });

    it('should return false when filter not found', async () => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(null);

      const result = await networkFilterService.flushNWFilter('invalid-id', false);

      expect(result).toBe(false);
    });

    it('should return false on connection errors', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle XML definition errors', async () => {
      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('XML error'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle missing referenced filter dependency error', async () => {
      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('referenced filter xyz is missing'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should return true when redefine is false and filter already exists', async () => {
      const existingFilter = { undefine: jest.fn() };
      (NwFilter.lookupByName as jest.Mock).mockResolvedValue(existingFilter);

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(true);
      expect(NwFilter.defineXml).not.toHaveBeenCalled();
      expect(existingFilter.undefine).not.toHaveBeenCalled();
    });
  });

  describe('deduplicateRules', () => {
    it('should find and remove duplicate rules based on key attributes', async () => {
      const rule1 = { ...createMockFWRule(), id: '1', createdAt: new Date('2023-01-01') };
      const rule2 = { ...createMockFWRule(), id: '2', createdAt: new Date('2023-01-02') };
      const rule3 = { ...createMockFWRule(), id: '3', createdAt: new Date('2023-01-03') };

      // rule1 and rule2 are duplicates, rule3 is unique
      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2, rule3]);
      mockPrisma.fWRule.delete.mockResolvedValue(rule1); // Delete older duplicate
      mockPrisma.nWFilter.update.mockResolvedValue(createMockNWFilter());

      const result = await networkFilterService.deduplicateRules('filter-id');

      expect(mockPrisma.fWRule.delete).toHaveBeenCalledWith({
        where: { id: '1' }
      });
      expect(result).toBe(1);
    });

    it('should keep the most recently created rule from each duplicate group', async () => {
      const olderRule = {
        ...createMockFWRule(),
        id: 'older',
        createdAt: new Date('2023-01-01'),
        action: 'accept',
        direction: 'in',
        protocol: 'tcp'
      };
      const newerRule = {
        ...createMockFWRule(),
        id: 'newer',
        createdAt: new Date('2023-01-02'),
        action: 'accept',
        direction: 'in',
        protocol: 'tcp'
      };

      mockPrisma.fWRule.findMany.mockResolvedValue([olderRule, newerRule]);
      mockPrisma.fWRule.delete.mockResolvedValue(olderRule);
      mockPrisma.nWFilter.update.mockResolvedValue(createMockNWFilter());

      await networkFilterService.deduplicateRules('filter-id');

      expect(mockPrisma.fWRule.delete).toHaveBeenCalledWith({
        where: { id: 'older' }
      });
    });

    it('should group rules by action, direction, protocol, ports, IPs, and comment', async () => {
      const rule1 = {
        ...createMockFWRule(),
        id: '1',
        action: 'accept',
        direction: 'in',
        protocol: 'tcp',
        srcPortStart: 80,
        comment: 'web traffic'
      };
      const rule2 = {
        ...createMockFWRule(),
        id: '2',
        action: 'accept',
        direction: 'in',
        protocol: 'tcp',
        srcPortStart: 80,
        comment: 'web traffic'
      };
      const rule3 = {
        ...createMockFWRule(),
        id: '3',
        action: 'accept',
        direction: 'in',
        protocol: 'tcp',
        srcPortStart: 443, // Different port
        comment: 'web traffic'
      };

      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2, rule3]);
      mockPrisma.fWRule.delete.mockResolvedValue(rule1);
      mockPrisma.nWFilter.update.mockResolvedValue(createMockNWFilter());

      const result = await networkFilterService.deduplicateRules('filter-id');

      // Only rule1 and rule2 are duplicates, rule3 should remain
      expect(result).toBe(1);
    });

    it('should exclude state field from duplicate detection', async () => {
      const rule1 = {
        ...createMockFWRule(),
        id: '1',
        state: { established: true }
      };
      const rule2 = {
        ...createMockFWRule(),
        id: '2',
        state: { new: true }
      };

      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2]);
      mockPrisma.fWRule.delete.mockResolvedValue(rule1);
      mockPrisma.nWFilter.update.mockResolvedValue(createMockNWFilter());

      const result = await networkFilterService.deduplicateRules('filter-id');

      // Should be considered duplicates despite different state
      expect(result).toBe(1);
    });

    it('should update filter updatedAt timestamp when duplicates removed', async () => {
      const rule1 = createMockFWRule();
      const rule2 = createMockFWRule();

      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2]);
      mockPrisma.fWRule.delete.mockResolvedValue(rule1);
      mockPrisma.nWFilter.update.mockResolvedValue(createMockNWFilter());

      await networkFilterService.deduplicateRules('filter-id');

      expect(mockPrisma.nWFilter.update).toHaveBeenCalledWith({
        where: { id: 'filter-id' },
        data: { updatedAt: expect.any(Date) }
      });
    });

    it('should handle empty rule sets', async () => {
      mockPrisma.fWRule.findMany.mockResolvedValue([]);

      const result = await networkFilterService.deduplicateRules('filter-id');

      expect(mockPrisma.fWRule.delete).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('should handle no duplicates found', async () => {
      const rule1 = { ...createMockFWRule(), id: '1', protocol: 'tcp' };
      const rule2 = { ...createMockFWRule(), id: '2', protocol: 'udp' };

      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2]);

      const result = await networkFilterService.deduplicateRules('filter-id');

      expect(mockPrisma.fWRule.delete).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      mockPrisma.fWRule.findMany.mockRejectedValue(error);

      await expect(
        networkFilterService.deduplicateRules('filter-id')
      ).rejects.toThrow('Database error');
    });
  });

  describe('Error Handling - Connection and Infrastructure', () => {
    it('should handle Connection.open() failures', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Hypervisor unavailable'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle connection timeout scenarios', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle permission denied errors', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle connection pool exhaustion', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Too many connections'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling - XML Processing', () => {
    const mockFilterWithRules = {
      ...createMockNWFilter(),
      internalName: 'ibay-test',
      rules: [createMockFWRule()],
      referencedBy: []
    };

    beforeEach(() => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRules);
    });

    it('should handle xmlBuilder.buildObject() XML syntax errors', async () => {
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('XML syntax error: Invalid character');
      });

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle malformed XML generation from corrupted filter data', async () => {
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('Cannot convert null to XML element');
      });

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle oversized XML documents', async () => {
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('XML document too large');
      });

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle XML encoding issues', async () => {
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('Invalid UTF-8 sequence');
      });

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling - Database Mid-Operation Failures', () => {
    it('should handle Prisma.fWRule.delete() failure during deduplication', async () => {
      const rule1 = { ...createMockFWRule(), id: '1', createdAt: new Date('2023-01-01') };
      const rule2 = { ...createMockFWRule(), id: '2', createdAt: new Date('2023-01-02') };

      mockPrisma.fWRule.findMany.mockResolvedValue([rule1, rule2]);
      mockPrisma.fWRule.delete.mockRejectedValue(new Error('Foreign key constraint violation'));

      await expect(
        networkFilterService.deduplicateRules('filter-id')
      ).rejects.toThrow('Foreign key constraint violation');
    });

    it('should handle database connection loss during long operations', async () => {
      mockPrisma.fWRule.findMany.mockRejectedValue(new Error('Connection lost'));

      await expect(
        networkFilterService.deduplicateRules('filter-id')
      ).rejects.toThrow('Connection lost');
    });

    it('should handle concurrent modification during rule creation', async () => {
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockRejectedValue(new Error('Unique constraint violation'));

      await expect(
        networkFilterService.createRule('filter-id', 'accept', 'in', 'all', undefined, {})
      ).rejects.toThrow('Unique constraint violation');
    });

    it('should handle findFirst success but create failure scenario', async () => {
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockRejectedValue(new Error('Constraint violation'));

      await expect(
        networkFilterService.createRule('filter-id', 'accept', 'in', 'all', undefined, {})
      ).rejects.toThrow('Constraint violation');
    });
  });

  describe('Error Handling - Libvirt Operation Failures', () => {
    const mockFilterWithRules = {
      ...createMockNWFilter(),
      internalName: 'ibay-test',
      rules: [createMockFWRule()],
      referencedBy: []
    };

    beforeEach(() => {
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRules);
      mockPrisma.nWFilter.update.mockResolvedValue(mockFilterWithRules);
    });

    it('should handle NwFilter.lookupByName() permission errors', async () => {
      (NwFilter.lookupByName as jest.Mock).mockRejectedValue(new Error('Permission denied accessing filter'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle NwFilter.defineXml() invalid filter definition errors', async () => {
      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('invalid nwfilter definition'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle filter dependency resolution failures beyond missing filters', async () => {
      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('circular filter dependency detected'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle filter undefine failures during redefine', async () => {
      const existingFilter = {
        undefine: jest.fn().mockRejectedValue(new Error('Cannot undefine filter: permission denied'))
      };
      (NwFilter.lookupByName as jest.Mock).mockResolvedValue(existingFilter);

      const result = await networkFilterService.flushNWFilter('filter-id', true);

      expect(result).toBe(false);
    });

    it('should handle libvirt daemon restart scenarios', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('libvirt daemon not running'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling - Data Corruption and Validation', () => {
    it('should handle invalid UUID generation', async () => {
      mockUuid.mockReturnValue('invalid-uuid-format');
      mockPrisma.nWFilter.create.mockRejectedValue(new Error('Invalid UUID format'));

      await expect(
        networkFilterService.createFilter('test', 'desc', 'INPUT', 'generic')
      ).rejects.toThrow('Invalid UUID format');
    });

    it('should handle crypto.randomBytes failure', async () => {
      mockCrypto.randomBytes.mockImplementation(() => {
        throw new Error('Insufficient entropy');
      });

      await expect(
        networkFilterService.createFilter('test', 'desc', 'INPUT', 'generic')
      ).rejects.toThrow('Insufficient entropy');
    });

    it('should handle malformed internal names that break libvirt conventions', async () => {
      mockCrypto.randomBytes.mockReturnValue(Buffer.from('invalid!@#'));

      const mockFilter = createMockNWFilter();
      mockPrisma.nWFilter.create.mockResolvedValue(mockFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue({
        ...mockFilter,
        internalName: 'ibay-invalid!@#',
        rules: [],
        referencedBy: []
      });

      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('Invalid filter name format'));

      const result = await networkFilterService.flushNWFilter(mockFilter.id, false);

      expect(result).toBe(false);
    });

    it('should handle out-of-range port numbers during rule creation', async () => {
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);
      mockPrisma.fWRule.create.mockRejectedValue(new Error('Port number out of range'));

      await expect(
        networkFilterService.createRule('filter-id', 'accept', 'in', 'tcp', undefined, {
          srcPortStart: 70000
        })
      ).rejects.toThrow('Port number out of range');
    });

    it('should handle corrupted filter references', async () => {
      const corruptedFilterData = {
        ...createMockNWFilter(),
        internalName: 'ibay-test',
        rules: [createMockFWRule()],
        referencedBy: [
          { targetFilter: { internalName: null, priority: 500 } }
        ]
      };

      mockPrisma.nWFilter.findUnique.mockResolvedValue(corruptedFilterData);
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('Cannot process null filter reference');
      });

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling - Resource Exhaustion', () => {
    it('should handle libvirt maximum filter limits', async () => {
      (NwFilter.defineXml as jest.Mock).mockRejectedValue(new Error('Maximum number of filters reached'));

      const mockFilterWithRules = {
        ...createMockNWFilter(),
        internalName: 'ibay-test',
        rules: [createMockFWRule()],
        referencedBy: []
      };
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRules);

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle memory exhaustion during large rule set processing', async () => {
      const manyRules = Array.from({ length: 10000 }, (_, i) => ({
        ...createMockFWRule(),
        id: `rule-${i}`,
        createdAt: new Date()
      }));

      mockPrisma.fWRule.findMany.mockRejectedValue(new Error('Out of memory'));

      await expect(
        networkFilterService.deduplicateRules('filter-id')
      ).rejects.toThrow('Out of memory');
    });

    it('should handle disk space issues during XML operations', async () => {
      mockBuilder.buildObject.mockImplementation(() => {
        throw new Error('No space left on device');
      });

      const mockFilterWithRules = {
        ...createMockNWFilter(),
        internalName: 'ibay-test',
        rules: [createMockFWRule()],
        referencedBy: []
      };
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockFilterWithRules);

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });

    it('should handle network timeouts during hypervisor communication', async () => {
      (Connection.open as jest.Mock).mockRejectedValue(new Error('Network timeout'));

      const result = await networkFilterService.flushNWFilter('filter-id', false);

      expect(result).toBe(false);
    });
  });
});