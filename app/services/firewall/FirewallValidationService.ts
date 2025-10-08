import { FirewallRule, RuleAction, RuleDirection } from '@prisma/client'

export type ConflictType = 'DUPLICATE' | 'CONTRADICTORY' | 'PORT_OVERLAP' | 'PRIORITY_CONFLICT';

export interface RuleConflict {
  type: ConflictType;
  message: string;
  affectedRules: FirewallRule[];
}

export interface ValidationResult {
  isValid: boolean;
  conflicts: RuleConflict[];
  warnings: string[];
}

/**
 * Service responsible for validating firewall rules before they are applied.
 * Detects conflicts, overlaps, and other rule issues that could cause problems.
 */
export class FirewallValidationService {
  /**
   * Validates a set of firewall rules for conflicts and issues
   */
  async validateRuleConflicts (rules: FirewallRule[]): Promise<ValidationResult> {
    const conflicts: RuleConflict[] = []
    const warnings: string[] = []

    // Detect contradictory rules (same traffic, different actions)
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if (this.rulesConflict(rules[i], rules[j])) {
          conflicts.push({
            type: 'CONTRADICTORY',
            message: `Rules "${rules[i].name}" and "${rules[j].name}" conflict: same traffic pattern with different actions`,
            affectedRules: [rules[i], rules[j]]
          })
        }
      }
    }

    // Detect port overlaps
    const portOverlaps = this.detectPortOverlaps(rules)
    conflicts.push(...portOverlaps)

    // Detect duplicate rules
    const duplicates = this.detectDuplicateRules(rules)
    conflicts.push(...duplicates)

    return {
      isValid: conflicts.length === 0,
      conflicts,
      warnings
    }
  }

  /**
   * Validates that an override rule actually targets a department rule
   */
  async validateOverride (vmRule: FirewallRule, deptRules: FirewallRule[]): Promise<ValidationResult> {
    const warnings: string[] = []
    const conflicts: RuleConflict[] = []

    if (!vmRule.overridesDept) {
      return { isValid: true, conflicts: [], warnings: [] }
    }

    // Check if there's actually a department rule that matches this override
    const matchingDeptRule = deptRules.find(dr => this.rulesTargetSameTraffic(vmRule, dr))

    if (!matchingDeptRule) {
      warnings.push('Override flag set but no matching department rule found')
      return { isValid: false, conflicts: [], warnings }
    }

    return { isValid: true, conflicts: [], warnings: [] }
  }

  /**
   * Validates priority order to ensure higher priority rules come first
   */
  async validatePriorityOrder (rules: FirewallRule[]): Promise<ValidationResult> {
    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority)
    const conflicts: RuleConflict[] = []

    // Check for priority conflicts (rules with same priority but conflicting actions)
    for (let i = 0; i < sortedRules.length - 1; i++) {
      const current = sortedRules[i]
      const next = sortedRules[i + 1]

      if (current.priority === next.priority && this.rulesConflict(current, next)) {
        conflicts.push({
          type: 'PRIORITY_CONFLICT',
          message: `Rules "${current.name}" and "${next.name}" have same priority ${current.priority} but conflict`,
          affectedRules: [current, next]
        })
      }
    }

    return {
      isValid: conflicts.length === 0,
      conflicts,
      warnings: []
    }
  }

  /**
   * Detects if two rules conflict (same traffic, different actions)
   */
  private rulesConflict (rule1: FirewallRule, rule2: FirewallRule): boolean {
    // Must target same traffic
    if (!this.rulesTargetSameTraffic(rule1, rule2)) {
      return false
    }

    // Must have different actions
    return rule1.action !== rule2.action
  }

  /**
   * Checks if two rules target the same traffic pattern
   */
  private rulesTargetSameTraffic (rule1: FirewallRule, rule2: FirewallRule): boolean {
    return (
      rule1.protocol === rule2.protocol &&
      rule1.direction === rule2.direction &&
      rule1.dstPortStart === rule2.dstPortStart &&
      rule1.dstPortEnd === rule2.dstPortEnd &&
      rule1.srcIpAddr === rule2.srcIpAddr &&
      rule1.dstIpAddr === rule2.dstIpAddr
    )
  }

  /**
   * Detects port range overlaps between rules
   */
  private detectPortOverlaps (rules: FirewallRule[]): RuleConflict[] {
    const conflicts: RuleConflict[] = []

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const rule1 = rules[i]
        const rule2 = rules[j]

        // Only check overlaps for same protocol and direction
        if (rule1.protocol !== rule2.protocol || rule1.direction !== rule2.direction) {
          continue
        }

        if (this.portRangesOverlap(rule1, rule2)) {
          conflicts.push({
            type: 'PORT_OVERLAP',
            message: `Port overlap between "${rule1.name}" and "${rule2.name}" on ${rule1.protocol}`,
            affectedRules: [rule1, rule2]
          })
        }
      }
    }

    return conflicts
  }

  /**
   * Checks if two rules have overlapping port ranges
   */
  private portRangesOverlap (rule1: FirewallRule, rule2: FirewallRule): boolean {
    // If either rule doesn't specify ports, no overlap
    if (!rule1.dstPortStart || !rule2.dstPortStart) {
      return false
    }

    const start1 = rule1.dstPortStart
    const end1 = rule1.dstPortEnd || start1
    const start2 = rule2.dstPortStart
    const end2 = rule2.dstPortEnd || start2

    // Check if ranges overlap
    return start1 <= end2 && start2 <= end1
  }

  /**
   * Detects duplicate rules (identical configuration)
   */
  private detectDuplicateRules (rules: FirewallRule[]): RuleConflict[] {
    const conflicts: RuleConflict[] = []
    const seen = new Map<string, FirewallRule>()

    for (const rule of rules) {
      const signature = this.getRuleSignature(rule)

      if (seen.has(signature)) {
        const existingRule = seen.get(signature)!
        conflicts.push({
          type: 'DUPLICATE',
          message: `Duplicate rule detected: "${rule.name}" is identical to "${existingRule.name}"`,
          affectedRules: [existingRule, rule]
        })
      } else {
        seen.set(signature, rule)
      }
    }

    return conflicts
  }

  /**
   * Generates a unique signature for a rule based on its configuration
   */
  private getRuleSignature (rule: FirewallRule): string {
    return JSON.stringify({
      action: rule.action,
      direction: rule.direction,
      protocol: rule.protocol,
      srcPortStart: rule.srcPortStart,
      srcPortEnd: rule.srcPortEnd,
      dstPortStart: rule.dstPortStart,
      dstPortEnd: rule.dstPortEnd,
      srcIpAddr: rule.srcIpAddr,
      srcIpMask: rule.srcIpMask,
      dstIpAddr: rule.dstIpAddr,
      dstIpMask: rule.dstIpMask
    })
  }
}
