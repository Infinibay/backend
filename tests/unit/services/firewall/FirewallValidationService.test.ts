import { FirewallValidationService } from '@services/firewall/FirewallValidationService'
import { FirewallRule, RuleAction, RuleDirection } from '@prisma/client'

describe('FirewallValidationService', () => {
  let service: FirewallValidationService

  beforeEach(() => {
    service = new FirewallValidationService()
  })

  describe('validateRuleConflicts', () => {
    it('should detect no conflicts when rules are compatible', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow HTTP',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 100
        },
        {
          id: '2',
          name: 'Allow HTTPS',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          priority: 100
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should detect contradictory rules (same traffic, different actions)', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow SSH',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 22,
          dstPortEnd: 22,
          priority: 100
        },
        {
          id: '2',
          name: 'Block SSH',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 22,
          dstPortEnd: 22,
          priority: 200
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(false)
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1)
      expect(result.conflicts.some(c => c.type === 'CONTRADICTORY')).toBe(true)
      const contradictoryConflict = result.conflicts.find(c => c.type === 'CONTRADICTORY')
      expect(contradictoryConflict?.affectedRules).toHaveLength(2)
    })

    it('should detect port overlaps', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow ports 100-200',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 100,
          dstPortEnd: 200,
          priority: 100
        },
        {
          id: '2',
          name: 'Allow ports 150-250',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 150,
          dstPortEnd: 250,
          priority: 200
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(false)
      expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true)
    })

    it('should not detect overlaps for different directions', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow inbound port 80',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 100
        },
        {
          id: '2',
          name: 'Allow outbound port 80',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 100
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should not detect overlaps for different protocols', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow TCP port 53',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 53,
          dstPortEnd: 53,
          priority: 100
        },
        {
          id: '2',
          name: 'Allow UDP port 53',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'udp',
          dstPortStart: 53,
          dstPortEnd: 53,
          priority: 100
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    it('should handle rules without port specifications', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow all ICMP',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'icmp',
          dstPortStart: null,
          dstPortEnd: null,
          priority: 100
        },
        {
          id: '2',
          name: 'Allow all traffic',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.INOUT,
          protocol: 'all',
          dstPortStart: null,
          dstPortEnd: null,
          priority: 200
        }
      ]

      const result = await service.validateRuleConflicts(rules as FirewallRule[])

      expect(result.isValid).toBe(true)
    })
  })

  describe('validateOverride', () => {
    it('should validate valid VM rule override', async () => {
      const deptRule: Partial<FirewallRule> = {
        id: '1',
        name: 'Dept: Allow SSH',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 22,
        dstPortEnd: 22,
        priority: 100
      }

      const vmRule: Partial<FirewallRule> = {
        id: '2',
        name: 'VM: Block SSH',
        action: RuleAction.DROP,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 22,
        dstPortEnd: 22,
        priority: 50,
        overridesDept: true
      }

      const result = await service.validateOverride(vmRule as FirewallRule, [deptRule as FirewallRule])

      expect(result.isValid).toBe(true)
    })

    it('should reject override when not targeting same traffic', async () => {
      const deptRule: Partial<FirewallRule> = {
        id: '1',
        name: 'Dept: Allow SSH',
        action: RuleAction.ACCEPT,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 22,
        dstPortEnd: 22,
        priority: 100
      }

      const vmRule: Partial<FirewallRule> = {
        id: '2',
        name: 'VM: Block HTTP (claiming override)',
        action: RuleAction.DROP,
        direction: RuleDirection.IN,
        protocol: 'tcp',
        dstPortStart: 80,
        dstPortEnd: 80,
        priority: 50,
        overridesDept: true
      }

      const result = await service.validateOverride(vmRule as FirewallRule, [deptRule as FirewallRule])

      expect(result.isValid).toBe(false)
      expect(result.warnings).toContain('Override flag set but no matching department rule found')
    })
  })
})
