import { FirewallRule, PrismaClient } from '@prisma/client'

import { type FirewallApplyResult } from '@infinibay/infinivirt'
import { Debugger } from '@utils/debug'

import { FirewallRuleService } from './FirewallRuleService'
import { FirewallValidationService } from './FirewallValidationService'
import { InfinivirtFirewallService } from './InfinivirtFirewallService'

const debug = new Debugger('infinibay:service:firewall:orchestration')

export interface ApplyRulesResult {
  rulesApplied: number;
  rulesFailed: number;
  success: boolean;
  chainName: string;
}

export interface SyncResult {
  errors: string[];
  success: boolean;
  vmsProcessed: number;
  vmsSkipped: number;
  vmsUpdated: number;
}

/**
 * Orchestration service for firewall rule management operations.
 *
 * This service coordinates validation, rule conversion, and nftables operations
 * for applying and syncing firewall rules to EXISTING VMs and departments.
 *
 * **Relationship with FirewallManager:**
 * - FirewallManager: Used during VM CREATION to ensure rulesets exist
 * - FirewallOrchestrationService: Used for RULE MANAGEMENT on existing VMs/departments
 *
 * **Primary Use Cases:**
 * - Apply updated rules to existing VMs (applyVMRules)
 * - Apply updated department rules to all VMs (applyDepartmentRules)
 * - Get effective rules for display (getEffectiveRules)
 * - Sync all firewall state to nftables (syncAllToNftables)
 * - Validate rule conflicts (validateVMRuleAgainstDepartment)
 *
 * **Used By:**
 * - GraphQL resolver: /home/andres/infinibay/backend/app/graphql/resolvers/firewall/resolver.ts
 * - Mutations: createDepartmentFirewallRule, createVMFirewallRule, updateFirewallRule,
 *   deleteFirewallRule, flushFirewallRules, syncFirewallToNftables
 * - Queries: getEffectiveFirewallRules
 *
 * **Design Pattern:** Service Layer with Dependency Injection
 * Coordinates between: FirewallRuleService, FirewallValidationService,
 * InfinivirtFirewallService (nftables-based)
 */
export class FirewallOrchestrationService {
  constructor (
    private prisma: PrismaClient,
    private ruleService: FirewallRuleService,
    private validationService: FirewallValidationService,
    private infinivirtService: InfinivirtFirewallService
  ) { }

  /**
   * Calculates effective rules for a VM by merging department and VM rules.
   * NOTE: This method is only used for preview/display purposes.
   * Actual firewall enforcement applies rules directly via nftables.
   */
  async getEffectiveRules (vmId: string): Promise<FirewallRule[]> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: {
          include: {
            firewallRuleSet: {
              include: {
                rules: true
              }
            }
          }
        },
        firewallRuleSet: {
          include: {
            rules: true
          }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM not found: ${vmId}`)
    }

    const deptRules = vm.department?.firewallRuleSet?.rules || []
    const vmRules = vm.firewallRuleSet?.rules || []

    // Filter out department rules that are overridden by VM rules
    const effectiveDeptRules = deptRules.filter(
      dr => !vmRules.some(vr => vr.overridesDept && this.rulesTargetSameTraffic(dr, vr))
    )

    // Combine rules and sort by priority (lower number = higher priority)
    const effectiveRules = [...effectiveDeptRules, ...vmRules]
    effectiveRules.sort((a, b) => a.priority - b.priority)

    debug.log(
      'info',
      `Effective rules for VM ${vmId}: ${effectiveRules.length} (${deptRules.length} dept + ${vmRules.length} vm - ${deptRules.length - effectiveDeptRules.length} overridden)`
    )

    return effectiveRules
  }

  /**
   * Applies firewall rules to a VM via nftables.
   * Department and VM-specific rules are merged and applied directly to the TAP device.
   *
   * NOTE: This method applies rules directly via nftables to the VM's TAP device.
   * The VM must have a TAP device configured (typically happens when the VM is running).
   */
  async applyVMRules (vmId: string): Promise<ApplyRulesResult> {
    debug.log('info', `Applying VM rules for ${vmId}`)

    // Get VM details
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: {
          include: {
            firewallRuleSet: {
              include: { rules: true }
            }
          }
        },
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM not found: ${vmId}`)
    }

    if (!vm.department) {
      throw new Error(`VM ${vmId} has no department assigned`)
    }

    // Get rules from both department and VM
    const deptRules = vm.department.firewallRuleSet?.rules || []
    const vmRules = vm.firewallRuleSet?.rules || []

    // Validate VM rules for conflicts
    const validation = await this.validationService.validateRuleConflicts(vmRules)
    if (!validation.isValid) {
      const errorMsg = `VM rule conflicts: ${validation.conflicts.map(c => c.message).join(', ')}`
      debug.log('error', errorMsg)
      throw new Error(errorMsg)
    }

    // Convert Prisma rules to nftables input format
    const deptRulesInput = this.infinivirtService.convertPrismaRulesToInput(deptRules)
    const vmRulesInput = this.infinivirtService.convertPrismaRulesToInput(vmRules)

    // Apply rules via nftables
    const result: FirewallApplyResult = await this.infinivirtService.applyVMRules(
      vmId,
      deptRulesInput,
      vmRulesInput
    )

    // Update rule set sync status (timestamp only)
    if (vm.firewallRuleSet?.id) {
      await this.ruleService.updateRuleSetSyncTimestamp(vm.firewallRuleSet.id)
    }

    debug.log(
      'info',
      `Successfully applied firewall rules to VM ${vmId}: ${result.appliedRules}/${result.totalRules} rules (${deptRules.length} dept + ${vmRules.length} vm)`
    )

    return {
      success: result.failedRules === 0,
      rulesApplied: result.appliedRules,
      rulesFailed: result.failedRules,
      chainName: result.chainName
    }
  }

  /**
   * Applies department rules to all VMs in the department via nftables.
   * Each VM receives both department and its own VM-specific rules.
   * This is O(N) where N = number of VMs in the department.
   */
  async applyDepartmentRules (deptId: string): Promise<SyncResult> {
    debug.log('info', `Applying department rules for ${deptId}`)

    const department = await this.prisma.department.findUnique({
      where: { id: deptId },
      include: {
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!department) {
      throw new Error(`Department not found: ${deptId}`)
    }

    const deptRules = department.firewallRuleSet?.rules || []

    // Validate department rules for conflicts
    const validation = await this.validationService.validateRuleConflicts(deptRules)
    if (!validation.isValid) {
      const errorMsg = `Department rule conflicts: ${validation.conflicts.map(c => c.message).join(', ')}`
      debug.log('error', errorMsg)
      throw new Error(errorMsg)
    }

    // Convert department rules to nftables input format
    const deptRulesInput = this.infinivirtService.convertPrismaRulesToInput(deptRules)

    // Apply rules to all VMs in the department via InfinivirtFirewallService
    const { totalVms, vmsUpdated, errors } = await this.infinivirtService.applyDepartmentRules(
      deptId,
      deptRulesInput
    )

    // Update rule set sync status (timestamp only)
    if (department.firewallRuleSet?.id) {
      await this.ruleService.updateRuleSetSyncTimestamp(department.firewallRuleSet.id)
    }

    debug.log(
      'info',
      `Department rules applied: ${vmsUpdated} VMs updated, ${errors.length} errors`
    )

    // Consider success if the only errors are VMs without TAP devices (same semantics as syncAllToNftables)
    const criticalErrors = errors.filter(e => !e.includes('no TAP device'))

    return {
      success: criticalErrors.length === 0,
      vmsProcessed: totalVms,
      vmsSkipped: errors.filter(e => e.includes('no TAP device')).length,
      vmsUpdated,
      errors
    }
  }

  /**
   * Syncs all firewall configurations to nftables for all active VMs.
   * Iterates over all VMs with TAP devices configured and applies their firewall rules.
   */
  async syncAllToNftables (): Promise<SyncResult> {
    debug.log('info', 'Starting full firewall sync to nftables')

    // Get all VMs with their departments and rules
    const machines = await this.prisma.machine.findMany({
      include: {
        configuration: true,
        department: {
          include: {
            firewallRuleSet: {
              include: { rules: true }
            }
          }
        },
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    const errors: string[] = []
    let vmsProcessed = 0
    let vmsSkipped = 0
    let vmsUpdated = 0

    for (const machine of machines) {
      vmsProcessed++

      // Skip VMs without TAP device configured
      if (!machine.configuration?.tapDeviceName) {
        const msg = `VM ${machine.id} (${machine.name}) has no TAP device configured, skipping`
        debug.log('warn', msg)
        errors.push(msg)
        vmsSkipped++
        continue
      }

      try {
        // Get rules from both department and VM
        const deptRules = machine.department?.firewallRuleSet?.rules || []
        const vmRules = machine.firewallRuleSet?.rules || []

        // Convert Prisma rules to nftables input format
        const deptRulesInput = this.infinivirtService.convertPrismaRulesToInput(deptRules)
        const vmRulesInput = this.infinivirtService.convertPrismaRulesToInput(vmRules)

        // Apply rules via nftables
        const result = await this.infinivirtService.applyVMRules(
          machine.id,
          deptRulesInput,
          vmRulesInput
        )

        // Update sync timestamps
        if (machine.firewallRuleSet?.id) {
          await this.ruleService.updateRuleSetSyncTimestamp(machine.firewallRuleSet.id)
        }
        if (machine.department?.firewallRuleSet?.id) {
          await this.ruleService.updateRuleSetSyncTimestamp(machine.department.firewallRuleSet.id)
        }

        vmsUpdated++

        if (result.failedRules > 0) {
          const msg = `VM ${machine.id} (${machine.name}): ${result.failedRules}/${result.totalRules} rules failed`
          debug.log('warn', msg)
          errors.push(msg)
        }
      } catch (err) {
        const errorMsg = `Failed to sync VM ${machine.id} (${machine.name}): ${err}`
        debug.log('error', errorMsg)
        errors.push(errorMsg)
      }
    }

    debug.log('info', `Sync complete: ${vmsUpdated} VMs updated, ${vmsSkipped} skipped, ${errors.length} errors`)

    return {
      success: errors.filter(e => !e.includes('no TAP device')).length === 0,
      vmsProcessed,
      vmsSkipped,
      vmsUpdated,
      errors
    }
  }

  /**
   * Validates that a new VM rule doesn't conflict with department rules
   * unless it explicitly overrides them
   */
  async validateVMRuleAgainstDepartment (
    vmId: string,
    newRule: Partial<FirewallRule>
  ): Promise<{ isValid: boolean; conflicts: string[] }> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: {
          include: {
            firewallRuleSet: {
              include: { rules: true }
            }
          }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM not found: ${vmId}`)
    }

    const deptRules = vm.department?.firewallRuleSet?.rules || []
    const conflicts: string[] = []

    // If rule explicitly overrides department rules, no conflict check needed
    if (newRule.overridesDept) {
      return { isValid: true, conflicts: [] }
    }

    // Check if new rule conflicts with any department rule
    for (const deptRule of deptRules) {
      // Check if rules target the same traffic
      if (this.rulesTargetSameTraffic(deptRule, newRule as FirewallRule)) {
        // Check if actions differ (conflict)
        if (deptRule.action !== newRule.action) {
          const portInfo = newRule.dstPortStart
            ? `port ${newRule.dstPortStart}${newRule.dstPortEnd && newRule.dstPortEnd !== newRule.dstPortStart ? `-${newRule.dstPortEnd}` : ''}`
            : 'all ports'
          conflicts.push(
            `VM rule "${newRule.name}" (${newRule.action}) conflicts with department rule "${deptRule.name}" (${deptRule.action}) for ${newRule.protocol} ${portInfo}. ` +
            'Set overridesDept=true to explicitly override the department rule.'
          )
        }
      }
    }

    return {
      isValid: conflicts.length === 0,
      conflicts
    }
  }

  /**
   * Checks if two rules target the same traffic pattern
   */
  private rulesTargetSameTraffic (rule1: FirewallRule, rule2: Partial<FirewallRule>): boolean {
    // Handle direction matching for INOUT
    const directionsMatch = (dir1: string | undefined, dir2: string | undefined): boolean => {
      if (!dir1 || !dir2) return false
      if (dir1 === dir2) return true
      // INOUT matches both IN and OUT
      if (dir1 === 'INOUT' || dir2 === 'INOUT') return true
      return false
    }

    const protocolMatch = rule1.protocol === rule2.protocol
    const dirMatch = directionsMatch(rule1.direction, rule2.direction)
    const portMatch = rule1.dstPortStart === rule2.dstPortStart && rule1.dstPortEnd === rule2.dstPortEnd
    // Treat null and undefined as equivalent (both mean "not specified")
    const srcIpMatch = (rule1.srcIpAddr || null) === (rule2.srcIpAddr || null)
    const dstIpMatch = (rule1.dstIpAddr || null) === (rule2.dstIpAddr || null)

    return protocolMatch && dirMatch && portMatch && srcIpMatch && dstIpMatch
  }
}
