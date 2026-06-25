import { PrismaClient, FirewallPolicy, RuleAction, RuleDirection, RuleSetType } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { FirewallPolicyService } from '../../../../app/services/firewall/FirewallPolicyService'
import { FirewallRuleService } from '../../../../app/services/firewall/FirewallRuleService'

describe('FirewallPolicyService', () => {
  let service: FirewallPolicyService
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockRuleService: DeepMockProxy<FirewallRuleService>

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()
    mockRuleService = mockDeep<FirewallRuleService>()

    service = new FirewallPolicyService(mockPrisma, mockRuleService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('generateDefaultRules', () => {
    describe('BLOCK_ALL policy', () => {
      it('should generate rules for allow_internet preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.BLOCK_ALL, 'allow_internet')

        expect(rules).toHaveLength(6) // 1 established + 5 outbound rules
        expect(rules[0].name).toBe('Allow Established Connections (System)')
        expect(rules[0].priority).toBe(50)
        expect(rules[0].isSystemGenerated).toBe(true)

        // Check DNS rules (UDP and TCP on port 53)
        expect(rules.filter(r => r.name.includes('DNS'))).toHaveLength(2)

        // Check HTTP and HTTPS
        expect(rules.find(r => r.name.includes('HTTP'))).toBeTruthy()
        expect(rules.find(r => r.name.includes('HTTPS'))).toBeTruthy()

        // Check NTP
        expect(rules.find(r => r.name.includes('NTP'))).toBeTruthy()

        // All rules should be marked as system-generated
        rules.forEach(rule => expect(rule.isSystemGenerated).toBe(true))
      })

      it('should generate rules for allow_outbound preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.BLOCK_ALL, 'allow_outbound')

        expect(rules).toHaveLength(2) // 1 established + 1 allow all outbound
        expect(rules[1].name).toBe('Allow All Outbound (System)')
        expect(rules[1].action).toBe(RuleAction.ACCEPT)
        expect(rules[1].direction).toBe(RuleDirection.OUT)
        expect(rules[1].protocol).toBe('all')
      })

      it('should generate no rules for block_all preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.BLOCK_ALL, 'block_all')

        expect(rules).toHaveLength(1) // Only the established connection rule
        expect(rules[0].name).toBe('Allow Established Connections (System)')
      })

      it('should FAIL CLOSED for an unknown BLOCK_ALL config (no permissive rules)', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.BLOCK_ALL, 'unknown_config' as any)

        // Only the system established/related rule — NO auto "allow all outbound".
        // An unknown preset must not silently open traffic (M11).
        expect(rules).toHaveLength(1)
        expect(rules[0].name).toBe('Allow Established Connections (System)')
        expect(rules.some(r => r.name === 'Allow All Outbound (System)')).toBe(false)
      })
    })

    describe('ALLOW_ALL policy', () => {
      it('should generate blocking rules for block_ssh preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.ALLOW_ALL, 'block_ssh')

        expect(rules).toHaveLength(3) // 1 established + 2 blocking rules
        
        const blockingRules = rules.filter(r => r.action === RuleAction.DROP)
        expect(blockingRules).toHaveLength(2)
        expect(blockingRules[0].name).toBe('Block SSH (System)')
        expect(blockingRules[1].name).toBe('Block FTP (System)')
      })

      it('should generate blocking rules for block_smb preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.ALLOW_ALL, 'block_smb')

        expect(rules).toHaveLength(4) // 1 established + SMB + NetBIOS TCP + NetBIOS UDP

        const blockingRules = rules.filter(r => r.action === RuleAction.DROP)
        expect(blockingRules).toHaveLength(3)
        expect(blockingRules[0].name).toBe('Block SMB (System)')
        expect(blockingRules[1].name).toBe('Block NetBIOS TCP (System)')
        expect(blockingRules[2].name).toBe('Block NetBIOS UDP (System)')
      })

      it('should generate blocking rules for block_databases preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.ALLOW_ALL, 'block_databases')

        expect(rules).toHaveLength(6) // 1 established + 5 database ports
        
        const blockingRules = rules.filter(r => r.action === RuleAction.DROP)
        expect(blockingRules).toHaveLength(5)
        expect(blockingRules.map(r => r.name)).toEqual(
          expect.arrayContaining([
            'Block MySQL (System)',
            'Block PostgreSQL (System)',
            'Block MongoDB (System)',
            'Block Redis (System)',
            'Block Elasticsearch (System)'
          ])
        )
      })

      it('should generate no blocking rules for none preset', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.ALLOW_ALL, 'none')

        expect(rules).toHaveLength(1) // Only the established connection rule
      })

      it('should handle unknown ALLOW_ALL configs gracefully', () => {
        const rules = service.generateDefaultRules(FirewallPolicy.ALLOW_ALL, 'unknown_config' as any)

        expect(rules).toHaveLength(1) // Only the established connection rule
      })
    })

    it('should always include established connections rule', () => {
      const rules = service.generateDefaultRules(FirewallPolicy.BLOCK_ALL, 'allow_internet')

      expect(rules[0].name).toBe('Allow Established Connections (System)')
      expect(rules[0].priority).toBe(50)
      // Canonical boolean shape read by the nftables translator (the old
      // { states: [...] } shape produced ZERO ct-state tokens — fail-open).
      expect(rules[0].connectionState).toEqual({ established: true, related: true })
    })
  })

  describe('applyPolicyToRuleSet', () => {
    it('should delete existing system-generated rules and create new ones in one transaction', async () => {
      const ruleSetId = 'ruleset-123'

      // applyPolicyToRuleSet now does delete + create atomically inside $transaction;
      // run the callback against mockPrisma so we can assert the tx operations.
      ;(mockPrisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockPrisma))
      ;(mockPrisma.firewallRule.deleteMany as any).mockResolvedValue({ count: 2 })
      ;(mockPrisma.firewallRule.createMany as any).mockResolvedValue({ count: 5 })

      await service.applyPolicyToRuleSet(ruleSetId, FirewallPolicy.BLOCK_ALL, 'allow_internet')

      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId, isSystemGenerated: true }
      })
      expect(mockPrisma.firewallRule.createMany).toHaveBeenCalled()
    })

    it('should work with empty rule set', async () => {
      const ruleSetId = 'ruleset-456'
      ;(mockPrisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockPrisma))
      ;(mockPrisma.firewallRule.deleteMany as any).mockResolvedValue({ count: 0 })
      ;(mockPrisma.firewallRule.createMany as any).mockResolvedValue({ count: 3 })

      await service.applyPolicyToRuleSet(ruleSetId, FirewallPolicy.ALLOW_ALL, 'block_ssh')

      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId, isSystemGenerated: true }
      })
    })
  })

  describe('ensureAndApplyDepartmentPolicy', () => {
    it('should create rule set if one does not exist', async () => {
      const mockDepartment = {
        id: 'dept-123',
        name: 'Engineering',
        firewallRuleSetId: null,
        firewallRuleSet: null
      }

      const mockRuleSet = {
        id: 'ruleset-new',
        internalName: 'ibay-dept-abc123'
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)
      mockRuleService.createRuleSet.mockResolvedValue(mockRuleSet as any)
      mockPrisma.department.update.mockResolvedValue({} as any)

      const result = await service.ensureAndApplyDepartmentPolicy(
        'dept-123',
        FirewallPolicy.BLOCK_ALL,
        'allow_internet'
      )

      expect(result).toBe('ruleset-new')
      expect(mockRuleService.createRuleSet).toHaveBeenCalledWith(
        RuleSetType.DEPARTMENT,
        'dept-123',
        'Engineering Firewall',
        expect.stringContaining('ibay-dept-')
      )
      expect(mockPrisma.department.update).toHaveBeenCalledWith({
        where: { id: 'dept-123' },
        data: { firewallRuleSetId: 'ruleset-new' }
      })
    })

    it('should use existing rule set if one exists', async () => {
      const mockDepartment = {
        id: 'dept-123',
        name: 'Engineering',
        firewallRuleSetId: 'existing-ruleset',
        firewallRuleSet: { id: 'existing-ruleset' }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      await service.ensureAndApplyDepartmentPolicy(
        'dept-123',
        FirewallPolicy.BLOCK_ALL,
        'allow_internet'
      )

      expect(mockRuleService.createRuleSet).not.toHaveBeenCalled()
      expect(mockPrisma.department.update).not.toHaveBeenCalled()
    })

    it('should throw error if department not found', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        service.ensureAndApplyDepartmentPolicy('nonexistent', FirewallPolicy.BLOCK_ALL, 'allow_internet')
      ).rejects.toThrow('Department nonexistent not found')
    })
  })

  describe('getPolicyPresetDescription', () => {
    describe('BLOCK_ALL policies', () => {
      it('should return description for allow_internet', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.BLOCK_ALL, 'allow_internet')
        expect(description).toContain('Blocks all traffic by default')
        expect(description).toContain('HTTP, HTTPS, DNS, and NTP')
      })

      it('should return description for allow_outbound', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.BLOCK_ALL, 'allow_outbound')
        expect(description).toContain('Blocks all inbound traffic')
        expect(description).toContain('allows all outbound')
      })

      it('should return description for block_all', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.BLOCK_ALL, 'block_all')
        expect(description).toContain('Complete network isolation')
        expect(description).toContain('Warning')
      })

      it('should return unknown message for unknown config', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.BLOCK_ALL, 'unknown' as any)
        expect(description).toBe('Unknown configuration')
      })
    })

    describe('ALLOW_ALL policies', () => {
      it('should return description for block_ssh', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.ALLOW_ALL, 'block_ssh')
        expect(description).toContain('Allows all traffic except SSH')
      })

      it('should return description for block_smb', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.ALLOW_ALL, 'block_smb')
        expect(description).toContain('SMB file sharing')
      })

      it('should return description for block_databases', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.ALLOW_ALL, 'block_databases')
        expect(description).toContain('database ports')
        expect(description).toContain('MySQL, PostgreSQL, MongoDB, Redis, Elasticsearch')
      })

      it('should return description for none', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.ALLOW_ALL, 'none')
        expect(description).toContain('Allows all traffic')
      })

      it('should return unknown message for unknown config', () => {
        const description = service.getPolicyPresetDescription(FirewallPolicy.ALLOW_ALL, 'unknown' as any)
        expect(description).toBe('Unknown configuration')
      })
    })
  })
})
