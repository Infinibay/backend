import { FirewallOrchestrationService } from '@services/firewall/FirewallOrchestrationService'
import { FirewallRuleService } from '@services/firewall/FirewallRuleService'
import { FirewallValidationService } from '@services/firewall/FirewallValidationService'
import { InfinizationFirewallService } from '@services/firewall/InfinizationFirewallService'
import { PrismaClient, RuleSetType, RuleAction, RuleDirection } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

const mockPrisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>()

describe('FirewallOrchestrationService', () => {
  let service: FirewallOrchestrationService
  let mockRuleService: DeepMockProxy<FirewallRuleService>
  let mockValidationService: DeepMockProxy<FirewallValidationService>
  let mockInfinizationService: DeepMockProxy<InfinizationFirewallService>

  beforeEach(() => {
    mockRuleService = mockDeep<FirewallRuleService>()
    mockValidationService = mockDeep<FirewallValidationService>()
    mockInfinizationService = mockDeep<InfinizationFirewallService>()

    service = new FirewallOrchestrationService(
      mockPrisma,
      mockRuleService,
      mockValidationService,
      mockInfinizationService
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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

      const result = await service.getEffectiveRules('vm-123')

      expect(result[0].priority).toBe(100)
      expect(result[1].priority).toBe(500)
    })
  })

  describe('applyVMRules', () => {
    it('should validate and apply rules via nftables', async () => {
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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any);
      mockValidationService.validateRuleConflicts.mockResolvedValue({
        isValid: true,
        conflicts: [],
        warnings: []
      } as any);
      mockInfinizationService.convertPrismaRulesToInput.mockReturnValue([]);
      mockInfinizationService.applyVMRules.mockResolvedValue({
        appliedRules: 1,
        totalRules: 1,
        failedRules: 0,
        failures: [],
        chainName: 'vm_abc12345'
      } as any);
      mockRuleService.updateRuleSetSyncTimestamp.mockResolvedValue(undefined)

      const result = await service.applyVMRules('vm-123')

      expect(result.success).toBe(true)
      expect(result.rulesApplied).toBe(1)
      expect(result.chainName).toBe('vm_abc12345')
      expect(mockValidationService.validateRuleConflicts).toHaveBeenCalled()
      expect(mockInfinizationService.applyVMRules).toHaveBeenCalled()
    })

    it('should throw error when validation fails', async () => {
      const mockVM = {
        id: 'vm-123',
        internalName: 'vm-websrv-01',
        department: { firewallRuleSet: { rules: [] } },
        firewallRuleSet: { rules: [] }
      };

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any);
      mockValidationService.validateRuleConflicts.mockResolvedValue({
        isValid: false,
        conflicts: [{ type: 'CONTRADICTORY', message: 'Rules conflict' }],
        warnings: []
      } as any)

      await expect(service.applyVMRules('vm-123')).rejects.toThrow('rule conflicts')
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

      mockValidationService.validateRuleConflicts.mockResolvedValue({
        isValid: true,
        conflicts: [],
        warnings: []
      } as any);
      mockInfinizationService.convertPrismaRulesToInput.mockReturnValue([]);
      mockInfinizationService.applyDepartmentRules.mockResolvedValue({
        totalVms: 2,
        vmsUpdated: 2,
        vmsSkippedNoTap: 0,
        vmsFailed: 0,
        errors: []
      } as any);
      mockRuleService.updateRuleSetSyncTimestamp.mockResolvedValue(undefined)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

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
