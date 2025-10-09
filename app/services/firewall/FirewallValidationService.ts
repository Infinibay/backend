import { FirewallRule } from '@prisma/client'
import { isIPv4, isIPv6 } from 'node:net'

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

// Protocols that do not support port specifications
const PORTLESS_PROTOCOLS = ['icmp', 'icmpv6', 'igmp', 'ah', 'esp', 'all']

// Valid port range
const MIN_PORT = 1
const MAX_PORT = 65535

// Valid priority range
const MIN_PRIORITY = 0
const MAX_PRIORITY = 1000

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

        // Only check overlaps for same protocol and compatible directions
        if (rule1.protocol !== rule2.protocol) {
          continue
        }

        if (!this.directionsOverlap(rule1.direction, rule2.direction)) {
          continue
        }

        const overlapDetails = this.getPortOverlapDetails(rule1, rule2)
        if (overlapDetails) {
          conflicts.push({
            type: 'PORT_OVERLAP',
            message: overlapDetails,
            affectedRules: [rule1, rule2]
          })
        }
      }
    }

    return conflicts
  }

  /**
   * Checks if two direction values overlap (e.g., INOUT overlaps with IN and OUT)
   */
  private directionsOverlap (dir1: string, dir2: string): boolean {
    if (dir1 === dir2) return true
    // INOUT overlaps with both IN and OUT
    if (dir1 === 'INOUT' || dir2 === 'INOUT') return true
    return false
  }

  /**
   * Checks if two rules have overlapping port ranges and returns detailed message
   */
  private getPortOverlapDetails (rule1: FirewallRule, rule2: FirewallRule): string | null {
    // If either rule doesn't specify ports, check if they both target "all ports"
    const rule1AllPorts = !rule1.dstPortStart
    const rule2AllPorts = !rule2.dstPortStart

    // If one targets all ports and the other specifies ports, there's an overlap
    if (rule1AllPorts && rule2AllPorts) {
      // Both target all ports
      return this.formatOverlapMessage(rule1, rule2, 'all ports', 'all ports', 'all ports')
    }

    if (rule1AllPorts || rule2AllPorts) {
      // One targets all ports, the other specifies a range
      const specificRule = rule1AllPorts ? rule2 : rule1
      const start = specificRule.dstPortStart
      if (!start) {
        return null // Should not happen, but guard against it
      }
      const end = specificRule.dstPortEnd || start
      const range = end === start ? `port ${start}` : `ports ${start}-${end}`

      return this.formatOverlapMessage(
        rule1,
        rule2,
        rule1AllPorts ? 'all ports' : range,
        rule2AllPorts ? 'all ports' : range,
        range
      )
    }

    // Both rules specify ports - check for range overlap
    const start1 = rule1.dstPortStart
    const start2 = rule2.dstPortStart
    if (!start1 || !start2) {
      return null // Should not happen, but guard against it
    }
    const end1 = rule1.dstPortEnd || start1
    const end2 = rule2.dstPortEnd || start2

    // Check if ranges overlap
    if (!(start1 <= end2 && start2 <= end1)) {
      return null
    }

    // Generate range descriptions
    const range1 = end1 === start1 ? `port ${start1}` : `ports ${start1}-${end1}`
    const range2 = end2 === start2 ? `port ${start2}` : `ports ${start2}-${end2}`

    // Calculate overlap range
    const overlapStart = Math.max(start1, start2)
    const overlapEnd = Math.min(end1, end2)
    const overlapRange = overlapEnd === overlapStart
      ? `port ${overlapStart}`
      : `ports ${overlapStart}-${overlapEnd}`

    return this.formatOverlapMessage(rule1, rule2, range1, range2, overlapRange)
  }

  /**
   * Formats the overlap message with helpful suggestions based on rule actions
   */
  private formatOverlapMessage (
    rule1: FirewallRule,
    rule2: FirewallRule,
    range1: string,
    range2: string,
    overlapRange: string
  ): string {
    const directionInfo = this.formatDirectionOverlap(rule1.direction, rule2.direction)
    let message = `Port overlap: "${rule1.name}" (${rule1.action} ${range1}) and "${rule2.name}" (${rule2.action} ${range2}) both target ${overlapRange} on ${rule1.protocol}${directionInfo}.`

    // Add suggestion based on whether actions differ
    if (rule1.action !== rule2.action) {
      message += ' Actions differ - use overridesDept=true on the VM rule to explicitly override the department rule, or adjust the port ranges to avoid overlap.'
    } else {
      message += ' Both rules have the same action - consider consolidating them into a single rule to simplify your firewall configuration.'
    }

    return message
  }

  /**
   * Formats direction information for overlap messages
   */
  private formatDirectionOverlap (dir1: string, dir2: string): string {
    if (dir1 === dir2) {
      return ` (${dir1})`
    }

    if (dir1 === 'INOUT' && dir2 !== 'INOUT') {
      return ` (${dir1} includes ${dir2})`
    }

    if (dir2 === 'INOUT' && dir1 !== 'INOUT') {
      return ` (${dir2} includes ${dir1})`
    }

    return ` (${dir1} and ${dir2})`
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
        const existingRule = seen.get(signature)
        if (existingRule) {
          conflicts.push({
            type: 'DUPLICATE',
            message: `Duplicate rule detected: "${rule.name}" is identical to "${existingRule.name}"`,
            affectedRules: [existingRule, rule]
          })
        }
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

  /**
   * Validates rule input data for correctness before creation/update
   * Checks port ranges, IP addresses, protocol compatibility, etc.
   */
  async validateRuleInput (rule: FirewallRule): Promise<ValidationResult> {
    const warnings: string[] = []

    // Validate priority range
    if (rule.priority < MIN_PRIORITY || rule.priority > MAX_PRIORITY) {
      warnings.push(`Priority ${rule.priority} is out of valid range (${MIN_PRIORITY}-${MAX_PRIORITY})`)
    }

    // Validate port specifications
    this.validatePortSpecifications(rule, warnings)

    // Validate IP addresses and masks
    this.validateIPAddresses(rule, warnings)

    // Validate protocol-specific constraints
    this.validateProtocolConstraints(rule, warnings)

    return {
      isValid: warnings.length === 0,
      conflicts: [],
      warnings
    }
  }

  /**
   * Validates port specifications (range, bounds, consistency)
   */
  private validatePortSpecifications (rule: FirewallRule, warnings: string[]): void {
    // Validate source ports
    if (rule.srcPortStart !== null && rule.srcPortStart !== undefined) {
      if (rule.srcPortStart < MIN_PORT || rule.srcPortStart > MAX_PORT) {
        warnings.push(`Source port ${rule.srcPortStart} is out of valid range (${MIN_PORT}-${MAX_PORT})`)
      }

      if (rule.srcPortEnd !== null && rule.srcPortEnd !== undefined) {
        if (rule.srcPortEnd < MIN_PORT || rule.srcPortEnd > MAX_PORT) {
          warnings.push(`Source port ${rule.srcPortEnd} is out of valid range (${MIN_PORT}-${MAX_PORT})`)
        }

        if (rule.srcPortStart > rule.srcPortEnd) {
          warnings.push(`Source port range is invalid: start port (${rule.srcPortStart}) is greater than end port (${rule.srcPortEnd})`)
        }
      }
    } else if (rule.srcPortEnd !== null && rule.srcPortEnd !== undefined) {
      warnings.push('Source port end specified without source port start')
    }

    // Validate destination ports
    if (rule.dstPortStart !== null && rule.dstPortStart !== undefined) {
      if (rule.dstPortStart < MIN_PORT || rule.dstPortStart > MAX_PORT) {
        warnings.push(`Destination port ${rule.dstPortStart} is out of valid range (${MIN_PORT}-${MAX_PORT})`)
      }

      if (rule.dstPortEnd !== null && rule.dstPortEnd !== undefined) {
        if (rule.dstPortEnd < MIN_PORT || rule.dstPortEnd > MAX_PORT) {
          warnings.push(`Destination port ${rule.dstPortEnd} is out of valid range (${MIN_PORT}-${MAX_PORT})`)
        }

        if (rule.dstPortStart > rule.dstPortEnd) {
          warnings.push(`Destination port range is invalid: start port (${rule.dstPortStart}) is greater than end port (${rule.dstPortEnd})`)
        }
      }
    } else if (rule.dstPortEnd !== null && rule.dstPortEnd !== undefined) {
      warnings.push('Destination port end specified without destination port start')
    }
  }

  /**
   * Validates IP addresses and CIDR masks
   */
  private validateIPAddresses (rule: FirewallRule, warnings: string[]): void {
    // Validate source IP
    if (rule.srcIpAddr) {
      if (!this.isValidIPAddress(rule.srcIpAddr)) {
        warnings.push(`Source IP address "${rule.srcIpAddr}" is not a valid IPv4 or IPv6 address`)
      }

      // Validate source mask if IP is provided
      if (rule.srcIpMask) {
        const isIPv4Addr = isIPv4(rule.srcIpAddr)
        if (!this.isValidCIDRMask(rule.srcIpMask, isIPv4Addr)) {
          warnings.push(`Source IP mask "${rule.srcIpMask}" is not valid. Use CIDR notation (0-32 for IPv4, 0-128 for IPv6)`)
        }
      }
    } else if (rule.srcIpMask) {
      warnings.push('Source IP mask specified without source IP address')
    }

    // Validate destination IP
    if (rule.dstIpAddr) {
      if (!this.isValidIPAddress(rule.dstIpAddr)) {
        warnings.push(`Destination IP address "${rule.dstIpAddr}" is not a valid IPv4 or IPv6 address`)
      }

      // Validate destination mask if IP is provided
      if (rule.dstIpMask) {
        const isIPv4Addr = isIPv4(rule.dstIpAddr)
        if (!this.isValidCIDRMask(rule.dstIpMask, isIPv4Addr)) {
          warnings.push(`Destination IP mask "${rule.dstIpMask}" is not valid. Use CIDR notation (0-32 for IPv4, 0-128 for IPv6)`)
        }
      }
    } else if (rule.dstIpMask) {
      warnings.push('Destination IP mask specified without destination IP address')
    }
  }

  /**
   * Validates protocol-specific constraints (e.g., ICMP doesn't use ports)
   */
  private validateProtocolConstraints (rule: FirewallRule, warnings: string[]): void {
    const protocol = rule.protocol?.toLowerCase() || 'all'

    if (PORTLESS_PROTOCOLS.includes(protocol)) {
      // Check if ports are specified for protocols that don't support them
      const hasSrcPorts = rule.srcPortStart !== null && rule.srcPortStart !== undefined
      const hasDstPorts = rule.dstPortStart !== null && rule.dstPortStart !== undefined

      if (hasSrcPorts || hasDstPorts) {
        warnings.push(`Protocol "${protocol}" does not support port specifications. Remove port fields.`)
      }
    }
  }

  /**
   * Checks if an IP address is valid (IPv4 or IPv6)
   */
  private isValidIPAddress (ip: string): boolean {
    return isIPv4(ip) || isIPv6(ip)
  }

  /**
   * Validates CIDR mask notation
   */
  private isValidCIDRMask (mask: string, isIPv4Addr: boolean): boolean {
    const maskNum = parseInt(mask, 10)

    if (isNaN(maskNum)) {
      return false
    }

    const maxMask = isIPv4Addr ? 32 : 128

    return maskNum >= 0 && maskNum <= maxMask
  }
}
