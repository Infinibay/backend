import { DepartmentFirewallService } from '../../../app/services/departmentFirewallService';
import { NetworkFilterService } from '../../../app/services/networkFilterService';
import { NotFoundError, CircularDependencyError } from '../../../app/utils/errors';
import { mockPrisma } from '../../setup/jest.setup';
import {
  createMockDepartment,
  createMockNWFilter,
  createMockFWRule,
  createMockMachine,
  createMockFilterReference
} from '../../setup/mock-factories';

jest.mock('../../../app/services/networkFilterService');
jest.mock('debug', () => () => jest.fn());

describe('DepartmentFirewallService', () => {
  let service: DepartmentFirewallService;
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock NetworkFilterService following FirewallService.test.ts pattern
    mockNetworkFilterService = {
      flushNWFilter: jest.fn().mockResolvedValue(true),
      createRule: jest.fn().mockResolvedValue(createMockFWRule())
    } as unknown as jest.Mocked<NetworkFilterService>;

    const NetworkFilterServiceMock = (jest.requireMock('../../../app/services/networkFilterService') as { NetworkFilterService: jest.Mock }).NetworkFilterService;
    NetworkFilterServiceMock.mockImplementation(() => mockNetworkFilterService);

    service = new DepartmentFirewallService(mockPrisma, mockNetworkFilterService);
  });

  describe('getDepartmentFirewallState', () => {
    it('should return complete firewall state when department and filter exist', async () => {
      const mockDepartment = createMockDepartment();
      const mockFilter = createMockNWFilter({ type: 'department' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template', name: 'web-server' });
      const mockRule = createMockFWRule({ nWFilterId: mockFilter.id });
      const mockMachine = createMockMachine({ departmentId: mockDepartment.id });

      mockPrisma.department.findUnique.mockResolvedValue({
        ...mockDepartment,
        machines: [mockMachine]
      });

      // Mock helper methods to return proper data
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockFilter);
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([mockTemplateFilter]);
      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([mockRule]);
      jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue([mockRule]);

      const result = await service.getDepartmentFirewallState(mockDepartment.id);

      expect(result).toEqual({
        departmentId: mockDepartment.id,
        appliedTemplates: [mockTemplateFilter.id],
        customRules: [mockRule],
        effectiveRules: [mockRule],
        vmCount: 1,
        lastSync: expect.any(Date)
      });
    });

    it('should return empty state when department exists but no filter', async () => {
      const mockDepartment = createMockDepartment();

      mockPrisma.department.findUnique.mockResolvedValue({
        ...mockDepartment,
        machines: []
      });
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      const result = await service.getDepartmentFirewallState(mockDepartment.id);

      expect(result).toEqual({
        departmentId: mockDepartment.id,
        appliedTemplates: [],
        customRules: [],
        effectiveRules: [],
        vmCount: 0,
        lastSync: expect.any(Date)
      });
    });

    it('should throw NotFoundError when department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null);

      await expect(service.getDepartmentFirewallState('non-existent'))
        .rejects.toThrow(NotFoundError);
    });

    it('should handle departments with no machines', async () => {
      const mockDepartment = createMockDepartment();
      const mockFilter = createMockNWFilter({ type: 'department' });

      mockPrisma.department.findUnique.mockResolvedValue({
        ...mockDepartment,
        machines: []
      });
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockFilter);
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([]);
      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([]);
      jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue([]);

      const result = await service.getDepartmentFirewallState(mockDepartment.id);

      expect(result.vmCount).toBe(0);
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.department.findUnique.mockRejectedValue(error);

      await expect(service.getDepartmentFirewallState('test-id'))
        .rejects.toThrow(error);
    });
  });

  describe('applyTemplateToDepartment', () => {
    it('should successfully apply template to department', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template' });
      const mockReference = createMockFilterReference({
        sourceFilterId: mockDeptFilter.id,
        targetFilterId: mockTemplateFilter.id
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([]);
      mockPrisma.filterReference.create.mockResolvedValue(mockReference);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.applyTemplateToDepartment('dept-id', 'template-id');

      expect(result).toBe(true);
      expect(mockPrisma.filterReference.create).toHaveBeenCalledWith({
        data: {
          sourceFilterId: mockDeptFilter.id,
          targetFilterId: mockTemplateFilter.id
        }
      });
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
    });

    it('should return true if template already applied (idempotent)', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template' });
      const existingReference = createMockFilterReference({
        sourceFilterId: mockDeptFilter.id,
        targetFilterId: mockTemplateFilter.id
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(existingReference);

      const result = await service.applyTemplateToDepartment('dept-id', 'template-id');

      expect(result).toBe(true);
      expect(mockPrisma.filterReference.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when department filter not found', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      await expect(service.applyTemplateToDepartment('dept-id', 'template-id'))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when template filter not found', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(null);

      await expect(service.applyTemplateToDepartment('dept-id', 'template-id'))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw CircularDependencyError when circular reference detected', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department', id: 'dept-filter' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template', id: 'template-filter' });
      const circularReference = createMockFilterReference({
        sourceFilterId: 'template-filter',
        targetFilterId: 'dept-filter'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([circularReference]);

      await expect(service.applyTemplateToDepartment('dept-id', 'template-id'))
        .rejects.toThrow(CircularDependencyError);
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(error);

      await expect(service.applyTemplateToDepartment('dept-id', 'template-id'))
        .rejects.toThrow(error);
    });
  });

  describe('removeTemplateFromDepartment', () => {
    it('should successfully remove template from department', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockReference = createMockFilterReference({
        sourceFilterId: mockDeptFilter.id,
        targetFilterId: 'template-id'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(mockReference);
      mockPrisma.filterReference.delete.mockResolvedValue(mockReference);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.removeTemplateFromDepartment('dept-id', 'template-id');

      expect(result).toBe(true);
      expect(mockPrisma.filterReference.delete).toHaveBeenCalledWith({
        where: { id: mockReference.id }
      });
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
    });

    it('should return false when template reference not found', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);

      const result = await service.removeTemplateFromDepartment('dept-id', 'template-id');

      expect(result).toBe(false);
      expect(mockPrisma.filterReference.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when department filter not found', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      await expect(service.removeTemplateFromDepartment('dept-id', 'template-id'))
        .rejects.toThrow(NotFoundError);
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(error);

      await expect(service.removeTemplateFromDepartment('dept-id', 'template-id'))
        .rejects.toThrow(error);
    });
  });

  describe('addDepartmentRule', () => {
    it('should create rule with all required parameters', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockRule = createMockFWRule({ nWFilterId: mockDeptFilter.id });
      const ruleData = {
        action: 'accept' as const,
        direction: 'inout' as const,
        priority: 600,
        protocol: 'tcp',
        dstPortStart: 80,
        dstPortEnd: 80
      };

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockResolvedValue(mockRule);

      const result = await service.addDepartmentRule('dept-id', ruleData);

      expect(result).toEqual(mockRule);
      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        mockDeptFilter.id,
        'accept',
        'inout',
        600,
        'tcp',
        undefined,
        {
          dstPortStart: 80,
          dstPortEnd: 80
        }
      );
    });

    it('should use default values for optional parameters', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockRule = createMockFWRule({ nWFilterId: mockDeptFilter.id });
      const ruleData = {};

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockResolvedValue(mockRule);

      const result = await service.addDepartmentRule('dept-id', ruleData);

      expect(result).toEqual(mockRule);
      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        mockDeptFilter.id,
        'accept',
        'inout',
        500,
        'all',
        undefined,
        {}
      );
    });

    it('should handle all optional parameters', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockRule = createMockFWRule({ nWFilterId: mockDeptFilter.id });
      const ruleData = {
        action: 'drop' as const,
        direction: 'in' as const,
        priority: 300,
        protocol: 'udp',
        srcPortStart: 1024,
        srcPortEnd: 65535,
        dstPortStart: 53,
        dstPortEnd: 53,
        comment: 'Block DNS',
        ipVersion: 'ipv4' as const,
        state: 'NEW,ESTABLISHED'
      };

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockResolvedValue(mockRule);

      const result = await service.addDepartmentRule('dept-id', ruleData);

      expect(result).toEqual(mockRule);
      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        mockDeptFilter.id,
        'drop',
        'in',
        300,
        'udp',
        undefined,
        {
          srcPortStart: 1024,
          srcPortEnd: 65535,
          dstPortStart: 53,
          dstPortEnd: 53,
          comment: 'Block DNS',
          ipVersion: 'ipv4',
          state: 'NEW,ESTABLISHED'
        }
      );
    });

    it('should throw NotFoundError when department filter not found', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      await expect(service.addDepartmentRule('dept-id', {}))
        .rejects.toThrow(NotFoundError);
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(error);

      await expect(service.addDepartmentRule('dept-id', {}))
        .rejects.toThrow(error);
    });
  });

  describe('removeDepartmentRule', () => {
    it('should successfully remove rule from department', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockRule = createMockFWRule({ nWFilterId: mockDeptFilter.id });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.fWRule.findFirst.mockResolvedValue(mockRule);
      mockPrisma.fWRule.delete.mockResolvedValue(mockRule);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.removeDepartmentRule('dept-id', 'rule-id');

      expect(result).toBe(true);
      expect(mockPrisma.fWRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-id' }
      });
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
    });

    it('should return false when rule not found in department filter', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.fWRule.findFirst.mockResolvedValue(null);

      const result = await service.removeDepartmentRule('dept-id', 'rule-id');

      expect(result).toBe(false);
      expect(mockPrisma.fWRule.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when department filter not found', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      await expect(service.removeDepartmentRule('dept-id', 'rule-id'))
        .rejects.toThrow(NotFoundError);
    });

    it('should verify rule belongs to department filter before deletion', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockRule = createMockFWRule({ nWFilterId: mockDeptFilter.id });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.fWRule.findFirst.mockResolvedValue(mockRule);
      mockPrisma.fWRule.delete.mockResolvedValue(mockRule);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      await service.removeDepartmentRule('dept-id', 'rule-id');

      expect(mockPrisma.fWRule.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'rule-id',
          nwFilterId: mockDeptFilter.id
        }
      });
    });

    it('should propagate Prisma errors', async () => {
      const error = new Error('Database error');
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(error);

      await expect(service.removeDepartmentRule('dept-id', 'rule-id'))
        .rejects.toThrow(error);
    });
  });

  describe('flushDepartmentToAllVMs', () => {
    it('should flush department filter and all VM filters in department', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockVMFilter = createMockNWFilter({ type: 'vm' });
      const mockMachine = createMockMachine({
        departmentId: 'dept-id',
        nwFilters: [{ id: mockVMFilter.id }]
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine]);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.flushDepartmentToAllVMs('dept-id');

      expect(result).toBe(true);
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockVMFilter.id);
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledTimes(2);
    });

    it('should return false when department filter not found', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      const result = await service.flushDepartmentToAllVMs('dept-id');

      expect(result).toBe(false);
      expect(mockNetworkFilterService.flushNWFilter).not.toHaveBeenCalled();
    });

    it('should handle departments with no VMs', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'refreshAllVMFilters').mockResolvedValue(true);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.flushDepartmentToAllVMs('dept-id');

      expect(result).toBe(true);
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
    });

    it('should handle VMs with no filters', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockMachine = createMockMachine({
        departmentId: 'dept-id',
        nwFilters: []
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine]);
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.flushDepartmentToAllVMs('dept-id');

      expect(result).toBe(true);
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockDeptFilter.id);
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect direct circular reference', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });
      const referenceBA = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-a'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([referenceBA]);

      await expect(service.applyTemplateToDepartment('dept-id', 'filter-b'))
        .rejects.toThrow(CircularDependencyError);
    });

    it('should detect indirect circular reference', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      const referenceBtoC = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-c'
      });
      const referenceCtoA = createMockFilterReference({
        sourceFilterId: 'filter-c',
        targetFilterId: 'filter-a'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([referenceBtoC])
        .mockResolvedValueOnce([referenceCtoA]);

      await expect(service.applyTemplateToDepartment('dept-id', 'filter-b'))
        .rejects.toThrow(CircularDependencyError);
    });

    it('should allow valid non-circular references', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      const referenceBtoC = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-c'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([referenceBtoC])
        .mockResolvedValueOnce([]);
      mockPrisma.filterReference.create.mockResolvedValue(createMockFilterReference());
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.applyTemplateToDepartment('dept-id', 'filter-b');

      expect(result).toBe(true);
    });

    it('should handle empty reference chains', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([]);
      mockPrisma.filterReference.create.mockResolvedValue(createMockFilterReference());
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

      const result = await service.applyTemplateToDepartment('dept-id', 'filter-b');

      expect(result).toBe(true);
    });

    it('should handle self-references', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterA);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);

      await expect(service.applyTemplateToDepartment('dept-id', 'filter-a'))
        .rejects.toThrow(CircularDependencyError);
    });
  });

  describe('Helper Methods', () => {
    describe('getDepartmentFilter', () => {
      it('should return department filter when found', async () => {
        const mockFilter = createMockNWFilter({ type: 'department' });

        mockPrisma.nWFilter.findFirst.mockResolvedValue(mockFilter);

        const result = await service['getDepartmentFilter']('dept-id');

        expect(result).toEqual(mockFilter);
        expect(mockPrisma.nWFilter.findFirst).toHaveBeenCalledWith({
          where: {
            type: 'department',
            departments: {
              some: {
                id: 'dept-id'
              }
            }
          },
          include: {
            rules: true,
            references: true
          }
        });
      });

      it('should return null when no filter exists for department', async () => {
        mockPrisma.nWFilter.findFirst.mockResolvedValue(null);

        const result = await service['getDepartmentFilter']('dept-id');

        expect(result).toBeNull();
      });
    });

    describe('getVMsInDepartment', () => {
      it('should return all VMs in department with their filters', async () => {
        const mockVMFilter = createMockNWFilter({ type: 'vm' });
        const mockMachine = createMockMachine({
          departmentId: 'dept-id',
          nwFilters: [{ id: mockVMFilter.id }]
        });

        mockPrisma.machine.findMany.mockResolvedValue([mockMachine]);

        const result = await service['getVMsInDepartment']('dept-id');

        expect(result).toEqual([mockMachine]);
        expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
          where: { departmentId: 'dept-id' },
          include: {
            nwFilters: {
              where: {
                nwFilter: {
                  type: 'vm'
                }
              }
            }
          }
        });
      });

      it('should return empty array when no VMs in department', async () => {
        mockPrisma.machine.findMany.mockResolvedValue([]);

        const result = await service['getVMsInDepartment']('dept-id');

        expect(result).toEqual([]);
      });
    });

    describe('getAppliedTemplates', () => {
      it('should return all template filters referenced by department', async () => {
        const mockTemplateFilter = createMockNWFilter({ type: 'template' });
        const mockReference = createMockFilterReference({
          sourceFilterId: 'dept-filter-id',
          targetFilterId: mockTemplateFilter.id,
          targetFilter: mockTemplateFilter
        });

        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(createMockNWFilter({ id: 'dept-filter-id' }));
        mockPrisma.filterReference.findMany.mockResolvedValue([mockReference]);

        const result = await service['getAppliedTemplates']('dept-id');

        expect(result).toEqual([mockTemplateFilter]);
      });

      it('should return empty array when no templates applied', async () => {
        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(createMockNWFilter());
        mockPrisma.filterReference.findMany.mockResolvedValue([]);

        const result = await service['getAppliedTemplates']('dept-id');

        expect(result).toEqual([]);
      });

      it('should return empty array when department filter not found', async () => {
        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

        const result = await service['getAppliedTemplates']('dept-id');

        expect(result).toEqual([]);
      });
    });

    describe('getDepartmentCustomRules', () => {
      it('should return all rules directly on department filter', async () => {
        const mockFilter = createMockNWFilter({ type: 'department' });
        const mockRule = createMockFWRule({ nWFilterId: mockFilter.id });

        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockFilter);
        mockPrisma.fWRule.findMany.mockResolvedValue([mockRule]);

        const result = await service['getDepartmentCustomRules']('dept-id');

        expect(result).toEqual([mockRule]);
      });

      it('should return empty array when no custom rules', async () => {
        const mockFilter = createMockNWFilter({ type: 'department' });

        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockFilter);
        mockPrisma.fWRule.findMany.mockResolvedValue([]);

        const result = await service['getDepartmentCustomRules']('dept-id');

        expect(result).toEqual([]);
      });

      it('should return empty array when department filter not found', async () => {
        jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

        const result = await service['getDepartmentCustomRules']('dept-id');

        expect(result).toEqual([]);
      });
    });

    describe('getEffectiveRules', () => {
      it('should combine template rules and custom rules', async () => {
        const templateRule = createMockFWRule({ priority: 100, action: 'accept' });
        const customRule = createMockFWRule({ priority: 200, action: 'drop' });

        jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([customRule]);
        jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([createMockNWFilter()]);
        mockPrisma.fWRule.findMany.mockResolvedValue([templateRule]);

        const result = await service['getEffectiveRules']('dept-id');

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(templateRule);
        expect(result[1]).toEqual(customRule);
      });

      it('should sort rules by priority', async () => {
        const rule1 = createMockFWRule({ priority: 300 });
        const rule2 = createMockFWRule({ priority: 100 });
        const rule3 = createMockFWRule({ priority: 200 });

        jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([rule1, rule2, rule3]);
        jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([]);

        const result = await service['getEffectiveRules']('dept-id');

        expect(result[0].priority).toBe(100);
        expect(result[1].priority).toBe(200);
        expect(result[2].priority).toBe(300);
      });

      it('should return empty array when no rules', async () => {
        jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([]);
        jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([]);

        const result = await service['getEffectiveRules']('dept-id');

        expect(result).toEqual([]);
      });
    });

    describe('refreshAllVMFilters', () => {
      it('should flush all VM filters in department', async () => {
        const mockVMFilter1 = createMockNWFilter({ type: 'vm', id: 'vm-filter-1' });
        const mockVMFilter2 = createMockNWFilter({ type: 'vm', id: 'vm-filter-2' });
        const mockMachine1 = createMockMachine({ nwFilters: [{ id: mockVMFilter1.id }] });
        const mockMachine2 = createMockMachine({ nwFilters: [{ id: mockVMFilter2.id }] });

        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine1, mockMachine2]);
        mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

        const result = await service['refreshAllVMFilters']('dept-id');

        expect(result).toBe(true);
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith('vm-filter-1');
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith('vm-filter-2');
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledTimes(2);
      });

      it('should handle VMs with multiple filters', async () => {
        const mockVMFilter1 = createMockNWFilter({ type: 'vm', id: 'vm-filter-1' });
        const mockVMFilter2 = createMockNWFilter({ type: 'vm', id: 'vm-filter-2' });
        const mockMachine = createMockMachine({ nwFilters: [{ id: mockVMFilter1.id }, { id: mockVMFilter2.id }] });

        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine]);
        mockNetworkFilterService.flushNWFilter.mockResolvedValue(true);

        const result = await service['refreshAllVMFilters']('dept-id');

        expect(result).toBe(true);
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith('vm-filter-1');
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith('vm-filter-2');
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledTimes(2);
      });

      it('should return true on completion', async () => {
        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([]);

        const result = await service['refreshAllVMFilters']('dept-id');

        expect(result).toBe(true);
      });
    });
  });

  describe('Validation Methods', () => {
    describe('validateRulePriority', () => {
      it('should return true for valid priorities (100-1000)', () => {
        expect(service['validateRulePriority']({ priority: 100 })).toBe(true);
        expect(service['validateRulePriority']({ priority: 500 })).toBe(true);
        expect(service['validateRulePriority']({ priority: 1000 })).toBe(true);
      });

      it('should return true for undefined priority', () => {
        expect(service['validateRulePriority']({ priority: undefined })).toBe(true);
        expect(service['validateRulePriority']({})).toBe(true);
      });

      it('should return false for priorities below 100', () => {
        expect(service['validateRulePriority']({ priority: 99 })).toBe(false);
        expect(service['validateRulePriority']({ priority: 0 })).toBe(false);
        expect(service['validateRulePriority']({ priority: -1 })).toBe(false);
      });

      it('should return false for priorities above 1000', () => {
        expect(service['validateRulePriority']({ priority: 1001 })).toBe(false);
        expect(service['validateRulePriority']({ priority: 9999 })).toBe(false);
      });
    });

    describe('calculateInheritanceImpact', () => {
      it('should calculate affected VMs count', async () => {
        const mockMachine1 = createMockMachine({ departmentId: 'dept-id' });
        const mockMachine2 = createMockMachine({ departmentId: 'dept-id' });
        const mockRules = [createMockFWRule(), createMockFWRule(), createMockFWRule(), createMockFWRule(), createMockFWRule()];

        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine1, mockMachine2]);
        jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue(mockRules);

        const result = await service['calculateInheritanceImpact']('dept-id');

        expect(result.affectedVMs).toBe(2);
        expect(result.totalRules).toBe(5);
        expect(result.estimatedApplyTime).toBe(4); // 2 VMs * 2 seconds
      });

      it('should handle departments with no VMs', async () => {
        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([]);
        jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue([]);

        const result = await service['calculateInheritanceImpact']('dept-id');

        expect(result.affectedVMs).toBe(0);
        expect(result.totalRules).toBe(0);
        expect(result.estimatedApplyTime).toBe(0);
      });

      it('should handle departments with no rules', async () => {
        const mockMachine = createMockMachine({ departmentId: 'dept-id' });

        jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine]);
        jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue([]);

        const result = await service['calculateInheritanceImpact']('dept-id');

        expect(result.affectedVMs).toBe(1);
        expect(result.totalRules).toBe(0);
        expect(result.estimatedApplyTime).toBe(2); // 1 VM * 2 seconds
      });
    });
  });

  describe('Error Handling - NetworkFilterService Operation Failures', () => {
    it('should handle NetworkFilterService.createRule() validation errors', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Invalid port range'));

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in', protocol: 'tcp' })
      ).rejects.toThrow('Invalid port range');
    });

    it('should handle NetworkFilterService.flushNWFilter() failures during department flush', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'refreshAllVMFilters').mockResolvedValue(true);
      mockNetworkFilterService.flushNWFilter.mockRejectedValue(new Error('Libvirt connection failed'));

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Libvirt connection failed');
    });

    it('should handle partial VM filter flush failures during refreshAllVMFilters', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockVMFilter1 = createMockNWFilter({ type: 'vm', id: 'vm-filter-1' });
      const mockVMFilter2 = createMockNWFilter({ type: 'vm', id: 'vm-filter-2' });
      const mockMachine1 = createMockMachine({ nwFilters: [{ id: mockVMFilter1.id }] });
      const mockMachine2 = createMockMachine({ nwFilters: [{ id: mockVMFilter2.id }] });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([mockMachine1, mockMachine2]);
      mockNetworkFilterService.flushNWFilter
        .mockResolvedValueOnce(true)  // Department filter succeeds
        .mockResolvedValueOnce(true)  // First VM filter succeeds
        .mockRejectedValueOnce(new Error('VM filter 2 flush failed'));  // Second VM filter fails

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('VM filter 2 flush failed');
    });

    it('should handle NetworkFilterService operation timeouts', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Operation timeout'));

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Operation timeout');
    });
  });

  describe('Error Handling - Complex Circular Dependency Scenarios', () => {
    it('should detect circular dependencies with corrupted filter reference data', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });
      const corruptedReference = {
        sourceFilterId: null,  // Corrupted data
        targetFilterId: 'filter-a'
      };

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([corruptedReference]);

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow();
    });

    it('should handle deep circular dependency chains (A→B→C→D→A)', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      const referenceBtoC = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-c'
      });
      const referenceCtoD = createMockFilterReference({
        sourceFilterId: 'filter-c',
        targetFilterId: 'filter-d'
      });
      const referenceDtoA = createMockFilterReference({
        sourceFilterId: 'filter-d',
        targetFilterId: 'filter-a'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([referenceBtoC])        // B→C
        .mockResolvedValueOnce([referenceCtoD])        // C→D
        .mockResolvedValueOnce([referenceDtoA]);       // D→A (circular!)

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow(CircularDependencyError);
    });

    it('should handle circular dependencies with multiple entry points', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      // Multiple paths: B→C, B→D, both leading back to A
      const referenceBtoC = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-c'
      });
      const referenceBtoD = createMockFilterReference({
        sourceFilterId: 'filter-b',
        targetFilterId: 'filter-d'
      });
      const referenceCtoA = createMockFilterReference({
        sourceFilterId: 'filter-c',
        targetFilterId: 'filter-a'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([referenceBtoC, referenceBtoD])  // B has multiple references
        .mockResolvedValueOnce([referenceCtoA])                 // C→A (circular!)
        .mockResolvedValueOnce([]);                             // D has no references

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow(CircularDependencyError);
    });

    it('should handle circular dependency detection during concurrent operations', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' });
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockRejectedValue(new Error('Database lock timeout'));

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow('Database lock timeout');
    });
  });

  describe('Error Handling - Database Consistency and Transaction Failures', () => {
    it('should handle filter reference creation failure after validation passes', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([]);
      mockPrisma.filterReference.create.mockRejectedValue(new Error('Foreign key constraint failed'));

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Foreign key constraint failed');
    });

    it('should handle concurrent template application attempts on same department', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockTemplateFilter = createMockNWFilter({ type: 'template' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);
      mockPrisma.filterReference.findMany.mockResolvedValue([]);
      mockPrisma.filterReference.create.mockRejectedValue(new Error('Unique constraint violation'));

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Unique constraint violation');
    });

    it('should handle department deletion during active firewall operations', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(new Error('Department not found'));

      await expect(
        service.addDepartmentRule('deleted-dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Department not found');
    });

    it('should handle filter reference orphaning scenarios', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(null);  // Reference not found
      mockPrisma.filterReference.delete.mockRejectedValue(new Error('Reference already deleted'));

      const result = await service.removeTemplateFromDepartment('dept-id', 'template-id');

      expect(result).toBe(false);
    });
  });

  describe('Error Handling - Rule Validation and Conflict Errors', () => {
    it('should handle invalid priority ranges during rule creation', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'validateRulePriority').mockReturnValue(false);

      await expect(
        service.addDepartmentRule('dept-id', { priority: 2000 })  // Invalid priority
      ).rejects.toThrow();
    });

    it('should handle rule conflicts during business logic validation', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Rule conflicts with existing rule'));

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in', protocol: 'tcp' })
      ).rejects.toThrow('Rule conflicts with existing rule');
    });

    it('should handle port range validation failures', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Invalid port range: start > end'));

      await expect(
        service.addDepartmentRule('dept-id', {
          action: 'accept',
          direction: 'in',
          protocol: 'tcp',
          dstPortStart: 8080,
          dstPortEnd: 80  // Invalid: start > end
        })
      ).rejects.toThrow('Invalid port range: start > end');
    });

    it('should handle protocol validation errors', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Unsupported protocol: invalid'));

      await expect(
        service.addDepartmentRule('dept-id', {
          action: 'accept',
          direction: 'in',
          protocol: 'invalid'  // Invalid protocol
        })
      ).rejects.toThrow('Unsupported protocol: invalid');
    });

    it('should handle IP address format validation failures', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Invalid IP address format'));

      await expect(
        service.addDepartmentRule('dept-id', {
          action: 'accept',
          direction: 'in',
          srcIpAddr: '256.256.256.256'  // Invalid IP
        })
      ).rejects.toThrow('Invalid IP address format');
    });
  });

  describe('Error Handling - Template and Filter State Inconsistencies', () => {
    it('should handle template application when template filter is corrupted', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const corruptedTemplateFilter = { ...createMockNWFilter({ type: 'template' }), internalName: null };

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.nWFilter.findUnique.mockResolvedValue(corruptedTemplateFilter);

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow();
    });

    it('should handle removal of templates that have been modified externally', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const mockReference = createMockFilterReference({
        sourceFilterId: mockDeptFilter.id,
        targetFilterId: 'template-id'
      });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockPrisma.filterReference.findFirst.mockResolvedValue(mockReference);
      mockPrisma.filterReference.delete.mockRejectedValue(new Error('Record not found'));

      await expect(
        service.removeTemplateFromDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Record not found');
    });

    it('should handle department filter corruption scenarios', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null);

      await expect(
        service.getDepartmentFirewallState('dept-id')
      ).rejects.toThrow(NotFoundError);
    });

    it('should handle missing filter dependencies during effective rule calculation', async () => {
      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([]);
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([createMockNWFilter()]);
      mockPrisma.fWRule.findMany.mockRejectedValue(new Error('Template filter not found'));

      await expect(
        service['getEffectiveRules']('dept-id')
      ).rejects.toThrow('Template filter not found');
    });
  });

  describe('Error Handling - Bulk Operation Failures', () => {
    it('should handle flushDepartmentToAllVMs with large numbers of VMs where some operations fail', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });
      const manyVMs = Array.from({ length: 100 }, (_, i) =>
        createMockMachine({
          nwFilters: [{ id: `vm-filter-${i}` }]
        })
      );

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue(manyVMs);

      // Department filter succeeds, but VM filter operations fail intermittently
      mockNetworkFilterService.flushNWFilter
        .mockResolvedValueOnce(true)  // Department filter
        .mockImplementation((filterId) => {
          if (filterId.includes('50')) {
            return Promise.reject(new Error(`Failed to flush ${filterId}`));
          }
          return Promise.resolve(true);
        });

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Failed to flush vm-filter-50');
    });

    it('should handle getEffectiveRules when template rule fetching fails for some templates', async () => {
      const templateFilter1 = createMockNWFilter({ id: 'template-1' });
      const templateFilter2 = createMockNWFilter({ id: 'template-2' });

      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([]);
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([templateFilter1, templateFilter2]);

      mockPrisma.fWRule.findMany
        .mockResolvedValueOnce([createMockFWRule()])  // First template succeeds
        .mockRejectedValueOnce(new Error('Template 2 rules not accessible'));  // Second template fails

      await expect(
        service['getEffectiveRules']('dept-id')
      ).rejects.toThrow('Template 2 rules not accessible');
    });

    it('should handle inheritance impact calculation with corrupted VM data', async () => {
      const corruptedVMs = [
        { ...createMockMachine(), departmentId: null },  // Corrupted data
        createMockMachine()
      ];

      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue(corruptedVMs);
      jest.spyOn(service as any, 'getEffectiveRules').mockResolvedValue([]);

      await expect(
        service['calculateInheritanceImpact']('dept-id')
      ).rejects.toThrow();
    });
  });

  describe('Error Handling - Resource and Permission Errors', () => {
    it('should handle operations when user lacks permissions for certain departments', async () => {
      mockPrisma.department.findUnique.mockRejectedValue(new Error('Access denied'));

      await expect(
        service.getDepartmentFirewallState('restricted-dept-id')
      ).rejects.toThrow('Access denied');
    });

    it('should handle filter operations when libvirt resources are exhausted', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      mockNetworkFilterService.flushNWFilter.mockRejectedValue(new Error('Resource exhausted: too many filters'));

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Resource exhausted: too many filters');
    });

    it('should handle scenarios where department has too many VMs for efficient processing', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'getVMsInDepartment').mockRejectedValue(new Error('Query timeout: too many results'));

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Query timeout: too many results');
    });

    it('should handle timeout scenarios during long-running operations', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' });

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter);
      jest.spyOn(service as any, 'refreshAllVMFilters').mockRejectedValue(new Error('Operation timeout'));

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Operation timeout');
    });
  });
});