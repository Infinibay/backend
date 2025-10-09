import { FirewallOrchestrationService } from '@services/firewall/FirewallOrchestrationService'
import { FirewallRuleService } from '@services/firewall/FirewallRuleService'
import { FirewallValidationService } from '@services/firewall/FirewallValidationService'
import { NWFilterXMLGeneratorService } from '@services/firewall/NWFilterXMLGeneratorService'
import { LibvirtNWFilterService } from '@services/firewall/LibvirtNWFilterService'
import { PrismaClient, RuleSetType, RuleAction, RuleDirection } from '@prisma/client'

// Mock all dependencies
jest.mock('@services/firewall/FirewallRuleService')
jest.mock('@services/firewall/FirewallValidationService')
jest.mock('@services/firewall/NWFilterXMLGeneratorService')
jest.mock('@services/firewall/LibvirtNWFilterService')

const mockPrisma = {
  machine: {
    findUnique: jest.fn()
  }
} as unknown as PrismaClient

describe('FirewallOrchestrationService', () => {
  let service: FirewallOrchestrationService
  let mockRuleService: jest.Mocked<FirewallRuleService>
  let mockValidationService: jest.Mocked<FirewallValidationService>
  let mockXmlGenerator: jest.Mocked<NWFilterXMLGeneratorService>
  let mockLibvirtService: jest.Mocked<LibvirtNWFilterService>

  beforeEach(() => {
    mockRuleService = new FirewallRuleService(mockPrisma) as jest.Mocked<FirewallRuleService>
    mockValidationService = new FirewallValidationService() as jest.Mocked<FirewallValidationService>
    mockXmlGenerator = new NWFilterXMLGeneratorService() as jest.Mocked<NWFilterXMLGeneratorService>
    mockLibvirtService = new LibvirtNWFilterService({} as any) as jest.Mocked<LibvirtNWFilterService>

    service = new FirewallOrchestrationService(
      mockPrisma,
      mockRuleService,
      mockValidationService,
      mockXmlGenerator,
      mockLibvirtService
    )

    jest.clearAllMocks()
  })

  describe('getEffectiveRules', () => {
    it('should merge department and VM rules', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Dept: Allow HTTP',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        },
        firewallRuleSet: {
          rules: [
            {
              id: 'vm-rule-1',
              name: 'VM: Allow HTTPS',
              action: RuleAction.ACCEPT,
              direction: RuleDirection.IN,
              protocol: 'tcp',
              dstPortStart: 443,
              dstPortEnd: 443,
              priority: 200,
              overridesDept: false
            }
          ]
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const result = await service.getEffectiveRules('vm-123')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('dept-rule-1')
      expect(result[1].id).toBe('vm-rule-1')
    })

    it('should filter out department rules overridden by VM', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Dept: Allow SSH',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        },
        firewallRuleSet: {
          rules: [
            {
              id: 'vm-rule-1',
              name: 'VM: Block SSH',
              action: RuleAction.DROP,
              direction: RuleDirection.IN,
              protocol: 'tcp',
              dstPortStart: 22,
              dstPortEnd: 22,
              priority: 50,
              overridesDept: true // This overrides the department rule
            }
          ]
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const result = await service.getEffectiveRules('vm-123')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('vm-rule-1')
    })

    it('should sort rules by priority', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                priority: 500,
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 80,
                dstPortEnd: 80,
                overridesDept: false
              }
            ]
          }
        },
        firewallRuleSet: {
          rules: [
            {
              id: 'vm-rule-1',
              priority: 100,
              action: RuleAction.ACCEPT,
              direction: RuleDirection.IN,
              protocol: 'tcp',
              dstPortStart: 443,
              dstPortEnd: 443,
              overridesDept: false
            }
          ]
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const result = await service.getEffectiveRules('vm-123')

      expect(result[0].priority).toBe(100)
      expect(result[1].priority).toBe(500)
    })
  })

  describe('applyVMRules', () => {
    it('should validate, generate XML, and apply rules', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-websrv-01',
        department: {
          firewallRuleSet: { rules: [] }
        },
        firewallRuleSet: {
          id: 'ruleset-123',
          rules: [
            {
              id: 'rule-1',
              name: 'Allow HTTP',
              action: RuleAction.ACCEPT,
              direction: RuleDirection.IN,
              protocol: 'tcp',
              dstPortStart: 80,
              dstPortEnd: 80,
              priority: 100,
              overridesDept: false
            }
          ]
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM);
      (mockValidationService.validateRuleConflicts as jest.Mock).mockResolvedValue({
        isValid: true,
        conflicts: [],
        warnings: []
      });
      (mockXmlGenerator.generateFilterName as jest.Mock).mockReturnValue('ibay-vm-abc123');
      (mockXmlGenerator.generateFilterXML as jest.Mock).mockResolvedValue('<filter>...</filter>');
      (mockLibvirtService.defineFilter as jest.Mock).mockResolvedValue('uuid-123');
      (mockLibvirtService.applyFilterToVM as jest.Mock).mockResolvedValue(undefined);
      (mockRuleService.updateRuleSetSyncStatus as jest.Mock).mockResolvedValue(undefined)

      const result = await service.applyVMRules('vm-123')

      expect(result.success).toBe(true)
      expect(result.filterName).toBe('ibay-vm-abc123')
      expect(result.rulesApplied).toBe(1)
      expect(mockValidationService.validateRuleConflicts).toHaveBeenCalled()
      expect(mockLibvirtService.defineFilter).toHaveBeenCalled()
    })

    it('should throw error when validation fails', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-websrv-01',
        department: { firewallRuleSet: { rules: [] } },
        firewallRuleSet: { rules: [] }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM);
      (mockValidationService.validateRuleConflicts as jest.Mock).mockResolvedValue({
        isValid: false,
        conflicts: [{ type: 'CONTRADICTORY', message: 'Rules conflict' }],
        warnings: []
      })

      await expect(service.applyVMRules('vm-123')).rejects.toThrow('Rule conflicts')
    })
  })

  describe('applyDepartmentRules', () => {
    it('should apply department rules to all VMs in department', async () => {
      const mockDepartment = {
        id: 'dept-123',
        firewallRuleSet: {
          id: 'ruleset-dept',
          rules: [
            {
              id: 'dept-rule-1',
              name: 'Dept: Allow HTTP',
              action: RuleAction.ACCEPT,
              direction: RuleDirection.IN,
              protocol: 'tcp',
              dstPortStart: 80,
              dstPortEnd: 80,
              priority: 100
            }
          ]
        },
        machines: [{ id: 'vm-1', internalName: 'vm-1' }, { id: 'vm-2', internalName: 'vm-2' }]
      };

      // Mock the department lookup
      (mockPrisma as any).department = {
        findUnique: jest.fn().mockResolvedValue(mockDepartment)
      };

      // Mock VM lookups for applyVMRules
      (mockPrisma.machine.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockDepartment.machines[0],
          department: mockDepartment,
          firewallRuleSet: { rules: [] }
        })
        .mockResolvedValueOnce({
          ...mockDepartment.machines[1],
          department: mockDepartment,
          firewallRuleSet: { rules: [] }
        });

      (mockValidationService.validateRuleConflicts as jest.Mock).mockResolvedValue({
        isValid: true,
        conflicts: [],
        warnings: []
      });
      (mockXmlGenerator.generateFilterName as jest.Mock).mockReturnValue('ibay-vm-abc');
      (mockXmlGenerator.generateFilterXML as jest.Mock).mockResolvedValue('<filter>...</filter>');
      (mockLibvirtService.defineFilter as jest.Mock).mockResolvedValue('uuid-123');
      (mockLibvirtService.applyFilterToVM as jest.Mock).mockResolvedValue(undefined);
      (mockRuleService.updateRuleSetSyncStatus as jest.Mock).mockResolvedValue(undefined)

      const result = await service.applyDepartmentRules('dept-123')

      expect(result.success).toBe(true)
      expect(result.vmsUpdated).toBe(2)
    })
  })

  describe('validateVMRuleAgainstDepartment', () => {
    it('should detect conflict when VM rule blocks traffic allowed by department', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'DNS - DNS queries (TCP)',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.INOUT,
                protocol: 'tcp',
                dstPortStart: 53,
                dstPortEnd: 53,
                srcIpAddr: null,
                dstIpAddr: null,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const newRule = {
        name: 'Block 53',
        action: RuleAction.DROP,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 53,
        dstPortEnd: 53,
        overridesDept: false
      }

      const result = await service.validateVMRuleAgainstDepartment('vm-123', newRule)

      expect(result.isValid).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toContain('conflicts with department rule')
      expect(result.conflicts[0]).toContain('overridesDept=true')
    })

    it('should allow rule when overridesDept is true', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Allow SSH',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                srcIpAddr: null,
                dstIpAddr: null,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const newRule = {
        name: 'Block SSH',
        action: RuleAction.DROP,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 22,
        dstPortEnd: 22,
        overridesDept: true
      }

      const result = await service.validateVMRuleAgainstDepartment('vm-123', newRule)

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should handle INOUT direction matching both IN and OUT', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Allow DNS Both Directions',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.INOUT,
                protocol: 'udp',
                dstPortStart: 53,
                dstPortEnd: 53,
                srcIpAddr: null,
                dstIpAddr: null,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const newRule = {
        name: 'Block DNS Incoming',
        action: RuleAction.DROP,
        direction: RuleDirection.IN,
        protocol: 'udp',
        dstPortStart: 53,
        dstPortEnd: 53,
        overridesDept: false
      }

      const result = await service.validateVMRuleAgainstDepartment('vm-123', newRule)

      expect(result.isValid).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toContain('conflicts with department rule')
    })

    it('should allow non-conflicting rules', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Allow HTTP',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 80,
                dstPortEnd: 80,
                srcIpAddr: null,
                dstIpAddr: null,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const newRule = {
        name: 'Allow HTTPS',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 443,
        dstPortEnd: 443,
        overridesDept: false
      }

      const result = await service.validateVMRuleAgainstDepartment('vm-123', newRule)

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should allow same action rules (no conflict)', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-123',
        department: {
          id: 'dept-123',
          firewallRuleSet: {
            rules: [
              {
                id: 'dept-rule-1',
                name: 'Allow SSH',
                action: RuleAction.ACCEPT,
                direction: RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                srcIpAddr: null,
                dstIpAddr: null,
                priority: 100,
                overridesDept: false
              }
            ]
          }
        }
      };

      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const newRule = {
        name: 'Also Allow SSH',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 22,
        dstPortEnd: 22,
        overridesDept: false
      }

      const result = await service.validateVMRuleAgainstDepartment('vm-123', newRule)

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })
  })
})
