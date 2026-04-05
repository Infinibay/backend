import { PrismaClient, RuleAction, RuleDirection, RuleSetType } from '@prisma/client'

import { FirewallResolver } from '@main/graphql/resolvers/firewall/resolver'
import { CreateFirewallRuleInput } from '@main/graphql/resolvers/firewall/inputs'
import type { InfinibayContext } from '@main/utils/context'

// Mock the services that make system calls
jest.mock('@services/firewall/FirewallOrchestrationService', () => ({
  FirewallOrchestrationService: jest.fn().mockImplementation(() => ({
    getEffectiveRules: jest.fn().mockResolvedValue([]),
    applyDepartmentRules: jest.fn().mockResolvedValue({ success: true, rulesApplied: 0, chainName: '', vmsUpdated: 0, errors: [] }),
    applyVMRules: jest.fn().mockResolvedValue({ success: true, rulesApplied: 0, chainName: '', vmsUpdated: 0, errors: [] }),
    syncAllToNftables: jest.fn().mockResolvedValue({ success: true, vmsUpdated: 0, errors: [] })
  }))
}))

// Mock FirewallRuleService with proper method mocks
const mockFirewallRuleService = {
  getRuleSetByEntity: jest.fn(),
  createRuleSet: jest.fn(),
  createRule: jest.fn(),
  updateRule: jest.fn(),
  deleteRule: jest.fn()
}

jest.mock('@services/firewall/FirewallRuleService', () => ({
  FirewallRuleService: jest.fn().mockImplementation(() => mockFirewallRuleService)
}))

jest.mock('@services/firewall/FirewallValidationService', () => ({
  FirewallValidationService: jest.fn().mockImplementation(() => ({
    validateRuleInput: jest.fn().mockResolvedValue({ isValid: true, warnings: [], conflicts: [] }),
    validateRuleConflicts: jest.fn().mockResolvedValue({ isValid: true, warnings: [], conflicts: [] }),
    validateOverride: jest.fn().mockResolvedValue({ isValid: true, message: '' })
  }))
}))

jest.mock('@services/firewall/InfinizationFirewallService', () => ({
  InfinizationFirewallService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    listVMChains: jest.fn().mockResolvedValue([]),
    removeVMFirewall: jest.fn().mockResolvedValue({ success: true })
  }))
}))

// Mock PrismaClient - properly typed as Jest mocks
const mockPrisma: any = {
  machine: {
    findUnique: jest.fn(),
    update: jest.fn()
  },
  department: {
    findUnique: jest.fn(),
    update: jest.fn()
  },
  firewallRuleSet: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  },
  firewallRule: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  }
}

const mockContext = {
  prisma: mockPrisma as PrismaClient,
  user: {
    id: 'test-user-id',
    email: 'test@example.com',
    role: 'ADMIN'
  },
  req: {} as any,
  res: {} as any,
  setupMode: false
} as InfinibayContext

describe('FirewallResolver', () => {
  let resolver: FirewallResolver

  beforeEach(() => {
    resolver = new FirewallResolver()
    jest.clearAllMocks()
  })

  describe('Queries', () => {
    describe('getDepartmentFirewallRules', () => {
      it('should return null when department has no firewall rules', async () => {
        mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(null)

        const result = await resolver.getDepartmentFirewallRules('dept-123', mockContext)

        expect(result).toBeNull()
        expect(mockFirewallRuleService.getRuleSetByEntity).toHaveBeenCalledWith(
          RuleSetType.DEPARTMENT,
          'dept-123'
        )
      })

      it('should return firewall rule set for department', async () => {
        const mockRuleSet = {
          id: 'ruleset-123',
          name: 'Department Rules',
          internalName: 'ibay-department-abc123',
          entityType: RuleSetType.DEPARTMENT,
          entityId: 'dept-123',
          priority: 500,
          isActive: true,
          libvirtUuid: null,
          xmlContent: null,
          lastSyncedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          rules: []
        }

        mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(mockRuleSet)

        const result = await resolver.getDepartmentFirewallRules('dept-123', mockContext)

        expect(result).toBeDefined()
        expect(result?.id).toBe('ruleset-123')
        expect(result?.entityType).toBe(RuleSetType.DEPARTMENT)
      })
    })

    describe('getVMFirewallRules', () => {
      it('should return null when VM has no firewall rules', async () => {
        mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(null)

        const result = await resolver.getVMFirewallRules('vm-123', mockContext)

        expect(result).toBeNull()
        expect(mockFirewallRuleService.getRuleSetByEntity).toHaveBeenCalledWith(
          RuleSetType.VM,
          'vm-123'
        )
      })
    })

    describe('getEffectiveFirewallRules', () => {
      it('should throw error when VM not found', async () => {
        mockPrisma.machine.findUnique.mockResolvedValue(null)

        await expect(
          resolver.getEffectiveFirewallRules('vm-123', mockContext)
        ).rejects.toThrow('VM not found')
      })

      it('should merge department and VM rules correctly', async () => {
        const mockVM = {
          id: 'vm-123',
          name: 'Test VM',
          department: {
            id: 'dept-123',
            firewallRuleSet: {
              id: 'dept-ruleset',
              rules: [
                {
                  id: 'dept-rule-1',
                  ruleSetId: 'dept-ruleset',
                  name: 'Allow HTTPS',
                  description: 'Department rule',
                  action: RuleAction.ACCEPT,
                  direction: RuleDirection.IN,
                  priority: 100,
                  protocol: 'tcp',
                  dstPortStart: 443,
                  dstPortEnd: 443,
                  srcPortStart: null,
                  srcPortEnd: null,
                  srcIpAddr: null,
                  srcIpMask: null,
                  dstIpAddr: null,
                  dstIpMask: null,
                  connectionState: null,
                  overridesDept: false,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              ]
            }
          },
          firewallRuleSet: {
            id: 'vm-ruleset',
            rules: []
          }
        }

        mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

        const result = await resolver.getEffectiveFirewallRules('vm-123', mockContext)

        expect(result).toBeDefined()
        expect(result.vmId).toBe('vm-123')
        expect(result.departmentRules).toHaveLength(1)
        expect(result.vmRules).toHaveLength(0)
        // effectiveRules comes from orchestrationService.getEffectiveRules which is mocked to return []
        // The resolver combines this with validation, so the length depends on the mock
        expect(result.effectiveRules).toBeDefined()
      })
    })

    describe('validateFirewallRule', () => {
      it('should validate a simple rule without conflicts', async () => {
        const input: CreateFirewallRuleInput = {
          name: 'Allow SSH',
          description: 'Allow SSH access',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          priority: 100,
          protocol: 'tcp',
          dstPortStart: 22,
          dstPortEnd: 22
        }

        const result = await resolver.validateFirewallRule(input, mockContext)

        expect(result).toBeDefined()
        expect(result.isValid).toBe(true)
        expect(result.conflicts).toHaveLength(0)
      })
    })
  })

  describe('Mutations', () => {
    describe('createDepartmentFirewallRule', () => {
      it('should throw error when department not found', async () => {
        mockPrisma.department.findUnique.mockResolvedValue(null)

        const input: CreateFirewallRuleInput = {
          name: 'Test Rule',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          priority: 100,
          protocol: 'tcp'
        }

        await expect(
          resolver.createDepartmentFirewallRule('dept-123', input, mockContext)
        ).rejects.toThrow('Department not found')
      })

      it('should throw error when overridesDept is set for department rule', async () => {
        const mockDepartment = {
          id: 'dept-123',
          name: 'Test Department',
          firewallRuleSet: {
            id: 'ruleset-123',
            rules: []
          }
        }

        mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

        const input: CreateFirewallRuleInput = {
          name: 'Test Rule',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          priority: 100,
          protocol: 'tcp',
          overridesDept: true // This should fail
        }

        await expect(
          resolver.createDepartmentFirewallRule('dept-123', input, mockContext)
        ).rejects.toThrow('overridesDept can only be used for VM rules')
      })
    })

    describe('createVMFirewallRule', () => {
      it('should throw error when VM not found', async () => {
        mockPrisma.machine.findUnique.mockResolvedValue(null)

        const input: CreateFirewallRuleInput = {
          name: 'Test Rule',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          priority: 100,
          protocol: 'tcp'
        }

        await expect(
          resolver.createVMFirewallRule('vm-123', input, mockContext)
        ).rejects.toThrow('VM not found')
      })
    })

    describe('updateFirewallRule', () => {
      it('should throw error when rule not found', async () => {
        mockPrisma.firewallRule.findUnique.mockResolvedValue(null)

        await expect(
          resolver.updateFirewallRule('rule-123', { name: 'Updated' }, mockContext)
        ).rejects.toThrow('Rule not found')
      })
    })

    describe('deleteFirewallRule', () => {
      it('should throw error when rule not found', async () => {
        mockPrisma.firewallRule.findUnique.mockResolvedValue(null)

        await expect(
          resolver.deleteFirewallRule('rule-123', mockContext)
        ).rejects.toThrow('Rule not found')
      })
    })
  })

  describe('Admin Operations', () => {
    describe('cleanupInfinibayFirewall', () => {
      it('should return cleanup results', async () => {
        const result = await resolver.cleanupInfinibayFirewall(mockContext)

        expect(result).toBeDefined()
        expect(result.success).toBe(true)
        expect(result.filtersRemoved).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.filterNames)).toBe(true)
      })
    })
  })
})
