import { FirewallRuleService } from '@services/firewall/FirewallRuleService'
import { PrismaClient, RuleSetType, RuleAction, RuleDirection } from '@prisma/client'

// Mock PrismaClient
const mockPrisma = {
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
} as unknown as PrismaClient

describe('FirewallRuleService', () => {
  let service: FirewallRuleService

  beforeEach(() => {
    service = new FirewallRuleService(mockPrisma)
    jest.clearAllMocks()
  })

  describe('createRuleSet', () => {
    it('should create a department rule set', async () => {
      const mockRuleSet = {
        id: 'ruleset-123',
        name: 'Engineering Department Firewall',
        internalName: 'ibay-dept-abc123',
        entityType: RuleSetType.DEPARTMENT,
        entityId: 'dept-abc123',
        priority: 500,
        isActive: true,
        rules: []
      };

      (mockPrisma.firewallRuleSet.create as jest.Mock).mockResolvedValue(mockRuleSet)

      const result = await service.createRuleSet(
        RuleSetType.DEPARTMENT,
        'dept-abc123',
        'Engineering Department Firewall',
        'ibay-dept-abc123'
      )

      expect(result).toEqual(mockRuleSet)
      expect(mockPrisma.firewallRuleSet.create).toHaveBeenCalledWith({
        data: {
          name: 'Engineering Department Firewall',
          internalName: 'ibay-dept-abc123',
          entityType: RuleSetType.DEPARTMENT,
          entityId: 'dept-abc123',
          priority: 500,
          isActive: true
        },
        include: { rules: true }
      })
    })

    it('should create a VM rule set with custom priority', async () => {
      const mockRuleSet = {
        id: 'ruleset-456',
        name: 'Web Server VM Firewall',
        internalName: 'ibay-vm-def456',
        entityType: RuleSetType.VM,
        entityId: 'vm-def456',
        priority: 100,
        isActive: true,
        rules: []
      };

      (mockPrisma.firewallRuleSet.create as jest.Mock).mockResolvedValue(mockRuleSet)

      const result = await service.createRuleSet(
        RuleSetType.VM,
        'vm-def456',
        'Web Server VM Firewall',
        'ibay-vm-def456',
        100
      )

      expect(result.priority).toBe(100)
    })
  })

  describe('createRule', () => {
    it('should create a firewall rule', async () => {
      const mockRule = {
        id: 'rule-123',
        ruleSetId: 'ruleset-123',
        name: 'Allow HTTPS',
        description: 'Allow incoming HTTPS traffic',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        priority: 100,
        protocol: 'tcp',
        dstPortStart: 443,
        dstPortEnd: 443,
        overridesDept: false
      };

      (mockPrisma.firewallRule.create as jest.Mock).mockResolvedValue(mockRule)

      const result = await service.createRule('ruleset-123', {
        name: 'Allow HTTPS',
        description: 'Allow incoming HTTPS traffic',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        priority: 100,
        protocol: 'tcp',
        dstPortStart: 443,
        dstPortEnd: 443
      })

      expect(result).toEqual(mockRule)
    })
  })

  describe('getRulesByEntity', () => {
    it('should get all rules for a department', async () => {
      const mockRuleSet = {
        id: 'ruleset-123',
        entityType: RuleSetType.DEPARTMENT,
        entityId: 'dept-123',
        rules: [
          { id: 'rule-1', name: 'Allow HTTP' },
          { id: 'rule-2', name: 'Allow HTTPS' }
        ]
      };

      (mockPrisma.firewallRuleSet.findMany as jest.Mock).mockResolvedValue([mockRuleSet])

      const result = await service.getRulesByEntity(RuleSetType.DEPARTMENT, 'dept-123')

      expect(result).toHaveLength(2)
      expect(mockPrisma.firewallRuleSet.findMany).toHaveBeenCalledWith({
        where: {
          entityType: RuleSetType.DEPARTMENT,
          entityId: 'dept-123'
        },
        include: { rules: true }
      })
    })

    it('should return empty array when no rules exist', async () => {
      (mockPrisma.firewallRuleSet.findMany as jest.Mock).mockResolvedValue([])

      const result = await service.getRulesByEntity(RuleSetType.VM, 'vm-nonexistent')

      expect(result).toEqual([])
    })
  })

  describe('updateRule', () => {
    it('should update a firewall rule', async () => {
      const mockUpdatedRule = {
        id: 'rule-123',
        name: 'Allow HTTPS (Updated)',
        priority: 50,
        action: RuleAction.ACCEPT
      };

      (mockPrisma.firewallRule.update as jest.Mock).mockResolvedValue(mockUpdatedRule)

      const result = await service.updateRule('rule-123', {
        name: 'Allow HTTPS (Updated)',
        priority: 50
      })

      expect(result).toEqual(mockUpdatedRule)
      expect(mockPrisma.firewallRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-123' },
        data: {
          name: 'Allow HTTPS (Updated)',
          priority: 50
        }
      })
    })
  })

  describe('deleteRule', () => {
    it('should delete a firewall rule', async () => {
      (mockPrisma.firewallRule.delete as jest.Mock).mockResolvedValue({ id: 'rule-123' })

      await service.deleteRule('rule-123')

      expect(mockPrisma.firewallRule.delete).toHaveBeenCalledWith({
        where: { id: 'rule-123' }
      })
    })
  })

  describe('getRuleSetByEntity', () => {
    it('should get rule set for a specific entity', async () => {
      const mockRuleSet = {
        id: 'ruleset-123',
        entityType: RuleSetType.VM,
        entityId: 'vm-123',
        rules: []
      };

      (mockPrisma.firewallRuleSet.findMany as jest.Mock).mockResolvedValue([mockRuleSet])

      const result = await service.getRuleSetByEntity(RuleSetType.VM, 'vm-123')

      expect(result).toEqual(mockRuleSet)
    })

    it('should return null when rule set does not exist', async () => {
      (mockPrisma.firewallRuleSet.findMany as jest.Mock).mockResolvedValue([])

      const result = await service.getRuleSetByEntity(RuleSetType.VM, 'vm-nonexistent')

      expect(result).toBeNull()
    })
  })
})
