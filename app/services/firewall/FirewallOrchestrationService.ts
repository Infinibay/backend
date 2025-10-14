import { FirewallRule, PrismaClient, RuleSetType } from '@prisma/client'

import { Debugger } from '@utils/debug'

import { FirewallRuleService } from './FirewallRuleService'
import { FirewallValidationService } from './FirewallValidationService'
import { LibvirtNWFilterService } from './LibvirtNWFilterService'
import { NWFilterXMLGeneratorService } from './NWFilterXMLGeneratorService'

const debug = new Debugger('infinibay:service:firewall:orchestration')

export interface ApplyRulesResult {
  filterName: string;
  rulesApplied: number;
  success: boolean;
}

export interface SyncResult {
  errors: string[];
  filtersCreated: number;
  filtersUpdated: number;
  success: boolean;
  vmsUpdated: number;
}

/**
 * Orchestration service for firewall rule management operations.
 *
 * This service coordinates validation, XML generation, and libvirt operations
 * for applying and syncing firewall rules to EXISTING VMs and departments.
 *
 * **Relationship with FirewallManager:**
 * - FirewallManager: Used during VM CREATION to ensure rulesets and filters exist
 * - FirewallOrchestrationService: Used for RULE MANAGEMENT on existing VMs/departments
 *
 * **Primary Use Cases:**
 * - Apply updated rules to existing VMs (applyVMRules)
 * - Apply updated department rules to all VMs (applyDepartmentRules)
 * - Get effective rules for display (getEffectiveRules)
 * - Sync all firewall state to libvirt (syncAllToLibvirt)
 * - Validate rule conflicts (validateVMRuleAgainstDepartment)
 *
 * **Used By:**
 * - GraphQL resolver: /home/andres/infinibay/backend/app/graphql/resolvers/firewall/resolver.ts
 * - Mutations: createDepartmentFirewallRule, createVMFirewallRule, updateFirewallRule,
 *   deleteFirewallRule, flushFirewallRules, syncFirewallToLibvirt
 * - Queries: getEffectiveFirewallRules
 *
 * **Design Pattern:** Service Layer with Dependency Injection
 * Coordinates between: FirewallRuleService, FirewallValidationService,
 * NWFilterXMLGeneratorService, LibvirtNWFilterService
 */
export class FirewallOrchestrationService {
  constructor (
    private prisma: PrismaClient,
    private ruleService: FirewallRuleService,
    private validationService: FirewallValidationService,
    private xmlGenerator: NWFilterXMLGeneratorService,
    private libvirtService: LibvirtNWFilterService
  ) { }

  /**
   * Calculates effective rules for a VM by merging department and VM rules
   * NOTE: This method is now only used for preview/display purposes.
   * Actual firewall enforcement uses filter inheritance in libvirt.
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
   * Applies firewall rules to a VM using filter inheritance.
   * VM filter inherits from department filter via <filterref>.
   * Only VM-specific rules are stored in the VM filter.
   *
   * NOTE: This method ONLY creates/updates the nwfilter in libvirt.
   * It does NOT modify the VM's XML - that must be done via XMLGenerator during VM creation/update.
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

    // Ensure department filter exists first
    if (vm.department.firewallRuleSet) {
      await this.applyDepartmentRules(vm.department.id)
    }

    // Get VM-specific rules only (not department rules - those are inherited)
    const vmRules = vm.firewallRuleSet?.rules || []

    // Validate VM rules for conflicts
    const validation = await this.validationService.validateRuleConflicts(vmRules)
    if (!validation.isValid) {
      const errorMsg = `VM rule conflicts: ${validation.conflicts.map(c => c.message).join(', ')}`
      debug.log('error', errorMsg)
      throw new Error(errorMsg)
    }

    // Generate filter names
    const vmFilterName = this.xmlGenerator.generateFilterName(RuleSetType.VM, vmId)
    const deptFilterName = this.xmlGenerator.generateFilterName(
      RuleSetType.DEPARTMENT,
      vm.department.id
    )

    // Get existing UUID if filter already exists (for redefinition)
    const existingUuid = await this.libvirtService.getFilterUuid(vmFilterName)

    // Generate VM filter XML with department filter reference
    const filterXML = await this.xmlGenerator.generateFilterXML(
      {
        name: vmFilterName,
        rules: vmRules
      },
      deptFilterName, // Inherit from department filter
      existingUuid || undefined // Use existing UUID if available
    )

    // Apply in libvirt (creates/updates the nwfilter definition)
    const libvirtUuid = await this.libvirtService.defineFilter(filterXML)

    // Update rule set sync status
    if (vm.firewallRuleSet?.id) {
      await this.ruleService.updateRuleSetSyncStatus(vm.firewallRuleSet.id, libvirtUuid, filterXML)
    }

    debug.log(
      'info',
      `Successfully created/updated VM nwfilter: ${vmRules.length} own rules + inherited from ${deptFilterName}`
    )

    return {
      success: true,
      filterName: vmFilterName,
      rulesApplied: vmRules.length
    }
  }

  /**
   * Applies department rules by updating ONLY the department filter.
   * All VMs automatically inherit changes via <filterref>.
   * This is O(1) instead of O(N) where N = number of VMs.
   */
  async applyDepartmentRules (deptId: string): Promise<SyncResult> {
    debug.log('info', `Applying department rules for ${deptId}`)

    const department = await this.prisma.department.findUnique({
      where: { id: deptId },
      include: {
        machines: true,
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

    // Generate department filter name
    const deptFilterName = this.xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, deptId)

    // Get existing UUID if filter already exists (for redefinition)
    const existingUuid = await this.libvirtService.getFilterUuid(deptFilterName)

    // Generate department filter XML (no parent - this is the base filter)
    const filterXML = await this.xmlGenerator.generateFilterXML({
      name: deptFilterName,
      rules: deptRules
    }, undefined, existingUuid || undefined)

    debug.log('debug', `Generated department filter XML with ${existingUuid ? 'existing' : 'new'} UUID`)

    // Apply in libvirt - this is the ONLY update needed
    const libvirtUuid = await this.libvirtService.defineFilter(filterXML)

    // Update rule set sync status
    if (department.firewallRuleSet?.id) {
      await this.ruleService.updateRuleSetSyncStatus(
        department.firewallRuleSet.id,
        libvirtUuid,
        filterXML
      )
    }

    debug.log(
      'info',
      `Successfully updated department filter ${deptFilterName} with ${deptRules.length} rules. ${department.machines.length} VMs inherit automatically.`
    )

    // Note: VMs don't need individual updates - they inherit via <filterref>
    const errors: string[] = []
    const vmsUpdated = department.machines.length

    return {
      success: errors.length === 0,
      filtersCreated: 0,
      filtersUpdated: vmsUpdated,
      vmsUpdated,
      errors
    }
  }

  /**
   * Syncs all firewall configurations to libvirt
   */
  async syncAllToLibvirt (): Promise<SyncResult> {
    debug.log('info', 'Starting full firewall sync to libvirt')

    const ruleSets = await this.ruleService.getAllActiveRuleSets()
    const errors: string[] = []
    let filtersCreated = 0
    let filtersUpdated = 0

    for (const ruleSet of ruleSets) {
      try {
        const filterName = this.xmlGenerator.generateFilterName(ruleSet.entityType, ruleSet.entityId)

        // Check if filter already exists and get its UUID
        const exists = await this.libvirtService.filterExists(filterName)
        const existingUuid = exists ? await this.libvirtService.getFilterUuid(filterName) : null

        const filterXML = await this.xmlGenerator.generateFilterXML({
          name: filterName,
          rules: ruleSet.rules
        }, undefined, existingUuid || undefined)

        // Define/update filter
        const libvirtUuid = await this.libvirtService.defineFilter(filterXML)

        // Update sync status
        await this.ruleService.updateRuleSetSyncStatus(ruleSet.id, libvirtUuid, filterXML)

        if (exists) {
          filtersUpdated++
        } else {
          filtersCreated++
        }
      } catch (err) {
        const errorMsg = `Failed to sync rule set ${ruleSet.id}: ${err}`
        debug.log('error', errorMsg)
        errors.push(errorMsg)
      }
    }

    debug.log('info', `Sync complete: ${filtersCreated} created, ${filtersUpdated} updated`)

    return {
      success: errors.length === 0,
      filtersCreated,
      filtersUpdated,
      vmsUpdated: 0,
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
