/**
 * FirewallManagerV2 - VM firewall management using nftables via infinivirt.
 *
 * This service replaces the libvirt nwfilter-based FirewallManager with
 * nftables, providing modern, performant firewall management.
 *
 * Key differences from V1:
 * - Uses nftables (bridge family) instead of libvirt nwfilters
 * - Per-VM chains instead of per-VM nwfilter XML
 * - No libvirt dependency for firewall operations
 * - Firewall rules applied at bridge level using TAP device names
 *
 * Database operations remain the same:
 * - FirewallRuleSet management
 * - Rule storage and retrieval
 * - Department/VM inheritance model
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import { NftablesService, FirewallRuleInput } from '@infinibay/infinivirt'

import { Debugger } from '@utils/debug'
import { getInfinivirt } from '@services/InfinivirtService'

const debug = new Debugger('firewall-manager-v2')

/**
 * Result of firewall setup operation.
 */
export interface FirewallSetupResult {
  departmentRuleSetCreated: boolean
  vmRuleSetCreated: boolean
  chainName: string
  departmentRulesApplied: number
  vmRulesApplied: number
  success: boolean
}

/**
 * Result of firewall resync operation.
 */
export interface FirewallResyncResult {
  ruleSetCreated: boolean
  departmentRulesInherited: number
  vmRulesApplied: number
  chainApplied: boolean
  success: boolean
}

export class FirewallManagerV2 {
  private readonly prisma: PrismaClient

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    debug.log('info', 'FirewallManagerV2 initialized')
  }

  /**
   * Gets the NftablesService instance from infinivirt.
   */
  private async getNftables (): Promise<NftablesService> {
    const infinivirt = await getInfinivirt()
    return infinivirt.getNftablesService()
  }

  /**
   * Ensures firewall infrastructure exists for an entity.
   *
   * Creates FirewallRuleSet in database if it doesn't exist.
   * Note: nftables chains are created during VM startup, not here.
   *
   * @param entityType - DEPARTMENT or VM
   * @param entityId - Entity UUID
   * @param description - Description for the ruleset
   */
  async ensureFirewallInfrastructure (
    entityType: RuleSetType,
    entityId: string,
    description: string
  ): Promise<{ ruleSetCreated: boolean }> {
    debug.log('info', `Ensuring firewall infrastructure for ${entityType} ${entityId}`)

    const result = { ruleSetCreated: false }

    try {
      // Check if ruleset already exists
      const existingRuleSet = await this.prisma.firewallRuleSet.findFirst({
        where: { entityType, entityId }
      })

      if (!existingRuleSet) {
        debug.log('info', `Creating ${entityType} ruleset for ${entityId}`)

        const internalName = this.generateInternalName(entityType, entityId)
        const priority = entityType === RuleSetType.DEPARTMENT ? 1000 : 500

        const ruleSet = await this.prisma.firewallRuleSet.create({
          data: {
            name: description,
            internalName,
            entityType,
            entityId,
            priority,
            isActive: true
          }
        })

        result.ruleSetCreated = true

        // Link ruleset to entity
        if (entityType === RuleSetType.DEPARTMENT) {
          await this.prisma.department.update({
            where: { id: entityId },
            data: { firewallRuleSetId: ruleSet.id }
          }).catch(e => {
            debug.log('warn', `Failed to link ruleset to department: ${e.message}`)
          })
        } else if (entityType === RuleSetType.VM) {
          await this.prisma.machine.update({
            where: { id: entityId },
            data: { firewallRuleSetId: ruleSet.id }
          }).catch(e => {
            debug.log('warn', `Failed to link ruleset to VM: ${e.message}`)
          })
        }

        debug.log('info', `Created ruleset ${ruleSet.id} for ${entityType} ${entityId}`)
      } else {
        debug.log('info', `${entityType} ruleset already exists for ${entityId}`)

        // Self-heal broken FK links
        await this.repairRuleSetLink(entityType, entityId, existingRuleSet.id)
      }

      return result
    } catch (error) {
      debug.log('error', `Failed to ensure firewall infrastructure: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Ensures complete firewall setup for a VM.
   *
   * This method:
   * 1. Ensures department and VM rulesets exist in database
   * 2. Creates nftables chain for the VM
   * 3. Applies merged rules (department + VM specific)
   *
   * @param vmId - VM UUID
   * @param departmentId - Department UUID
   * @param tapDeviceName - TAP device name for this VM
   */
  async ensureFirewallForVM (
    vmId: string,
    departmentId: string,
    tapDeviceName: string
  ): Promise<FirewallSetupResult> {
    debug.log('info', `Ensuring firewall for VM ${vmId} (TAP: ${tapDeviceName})`)

    const result: FirewallSetupResult = {
      departmentRuleSetCreated: false,
      vmRuleSetCreated: false,
      chainName: '',
      departmentRulesApplied: 0,
      vmRulesApplied: 0,
      success: false
    }

    try {
      // Step 1: Fetch VM with relations
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          department: {
            include: {
              firewallRuleSet: { include: { rules: true } }
            }
          },
          firewallRuleSet: { include: { rules: true } }
        }
      })

      if (!vm) {
        throw new Error(`VM not found: ${vmId}`)
      }

      if (!vm.department || vm.department.id !== departmentId) {
        throw new Error(`Department mismatch for VM ${vmId}`)
      }

      // Step 2: Ensure department ruleset
      if (!vm.department.firewallRuleSet) {
        const deptResult = await this.ensureFirewallInfrastructure(
          RuleSetType.DEPARTMENT,
          departmentId,
          `Department Firewall: ${vm.department.name}`
        )
        result.departmentRuleSetCreated = deptResult.ruleSetCreated
      }

      // Step 3: Ensure VM ruleset
      if (!vm.firewallRuleSet) {
        const vmResult = await this.ensureFirewallInfrastructure(
          RuleSetType.VM,
          vmId,
          `VM Firewall: ${vm.name}`
        )
        result.vmRuleSetCreated = vmResult.ruleSetCreated
      }

      // Step 4: Get nftables service and create chain
      const nftables = await this.getNftables()
      result.chainName = await nftables.createVMChain(vmId, tapDeviceName)

      // Step 5: Fetch fresh rules (in case they were just created)
      const [deptRules, vmRules] = await this.fetchRules(vmId, departmentId)

      // Step 6: Apply rules via nftables
      const applyResult = await nftables.applyRules(
        vmId,
        tapDeviceName,
        deptRules,
        vmRules
      )

      result.departmentRulesApplied = deptRules.length
      result.vmRulesApplied = vmRules.length
      result.success = applyResult.failedRules === 0

      debug.log('info', `Firewall setup complete for VM ${vmId}: ${applyResult.appliedRules} rules applied`)

      return result
    } catch (error) {
      debug.log('error', `Failed to ensure firewall for VM ${vmId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Re-synchronizes firewall rules for a VM.
   *
   * Useful for:
   * - Applying updated rules after changes
   * - Repairing inconsistent state
   * - Manual troubleshooting
   *
   * @param vmId - VM UUID
   * @param tapDeviceName - TAP device name
   */
  async resyncVMFirewall (
    vmId: string,
    tapDeviceName: string
  ): Promise<FirewallResyncResult> {
    debug.log('info', `Re-syncing firewall for VM ${vmId}`)

    const result: FirewallResyncResult = {
      ruleSetCreated: false,
      departmentRulesInherited: 0,
      vmRulesApplied: 0,
      chainApplied: false,
      success: false
    }

    try {
      // Fetch VM with relations
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          department: {
            include: {
              firewallRuleSet: { include: { rules: true } }
            }
          },
          firewallRuleSet: { include: { rules: true } }
        }
      })

      if (!vm || !vm.department) {
        throw new Error(`VM ${vmId} not found or has no department`)
      }

      // Ensure VM ruleset exists
      if (!vm.firewallRuleSet) {
        const infraResult = await this.ensureFirewallInfrastructure(
          RuleSetType.VM,
          vmId,
          `VM Firewall: ${vm.name}`
        )
        result.ruleSetCreated = infraResult.ruleSetCreated
      }

      // Fetch rules
      const [deptRules, vmRules] = await this.fetchRules(vmId, vm.department.id)
      result.departmentRulesInherited = deptRules.length

      // Apply via nftables (flush existing and re-apply)
      const nftables = await this.getNftables()
      const applyResult = await nftables.applyRules(
        vmId,
        tapDeviceName,
        deptRules,
        vmRules
      )

      result.vmRulesApplied = applyResult.appliedRules
      result.chainApplied = applyResult.failedRules === 0
      result.success = true

      debug.log('info', `Firewall resync complete for VM ${vmId}`)
      return result
    } catch (error) {
      debug.log('error', `Failed to resync firewall for VM ${vmId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Removes firewall chain for a VM.
   *
   * Called during VM deletion to clean up nftables resources.
   *
   * @param vmId - VM UUID
   */
  async removeVMFirewall (vmId: string): Promise<void> {
    debug.log('info', `Removing firewall for VM ${vmId}`)

    try {
      const nftables = await this.getNftables()
      await nftables.removeVMChain(vmId)
      debug.log('info', `Firewall removed for VM ${vmId}`)
    } catch (error) {
      debug.log('warn', `Failed to remove firewall for VM ${vmId}: ${(error as Error).message}`)
      // Don't throw - cleanup should be best-effort
    }
  }

  /**
   * Flushes all rules from a VM's firewall chain.
   *
   * Useful for temporarily disabling firewall rules.
   *
   * @param vmId - VM UUID
   */
  async flushVMRules (vmId: string): Promise<void> {
    debug.log('info', `Flushing firewall rules for VM ${vmId}`)

    try {
      const nftables = await this.getNftables()
      await nftables.flushVMRules(vmId)
      debug.log('info', `Firewall rules flushed for VM ${vmId}`)
    } catch (error) {
      debug.log('warn', `Failed to flush firewall rules for VM ${vmId}: ${(error as Error).message}`)
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Generates internal name for a ruleset.
   */
  private generateInternalName (entityType: RuleSetType, entityId: string): string {
    const prefix = entityType === RuleSetType.DEPARTMENT ? 'dept' : 'vm'
    const shortId = entityId.replace(/-/g, '').substring(0, 8)
    return `ibay-${prefix}-${shortId}`
  }

  /**
   * Repairs broken FK links between ruleset and entity.
   */
  private async repairRuleSetLink (
    entityType: RuleSetType,
    entityId: string,
    ruleSetId: string
  ): Promise<void> {
    try {
      if (entityType === RuleSetType.DEPARTMENT) {
        const dept = await this.prisma.department.findUnique({
          where: { id: entityId },
          select: { firewallRuleSetId: true }
        })
        if (dept && !dept.firewallRuleSetId) {
          await this.prisma.department.update({
            where: { id: entityId },
            data: { firewallRuleSetId: ruleSetId }
          })
          debug.log('info', `Self-healed: linked ruleset to department ${entityId}`)
        }
      } else if (entityType === RuleSetType.VM) {
        const machine = await this.prisma.machine.findUnique({
          where: { id: entityId },
          select: { firewallRuleSetId: true }
        })
        if (machine && !machine.firewallRuleSetId) {
          await this.prisma.machine.update({
            where: { id: entityId },
            data: { firewallRuleSetId: ruleSetId }
          })
          debug.log('info', `Self-healed: linked ruleset to VM ${entityId}`)
        }
      }
    } catch (error) {
      debug.log('warn', `Failed to repair ruleset link: ${(error as Error).message}`)
    }
  }

  /**
   * Fetches department and VM rules, converting to FirewallRuleInput format.
   */
  private async fetchRules (
    vmId: string,
    departmentId: string
  ): Promise<[FirewallRuleInput[], FirewallRuleInput[]]> {
    // Fetch department rules
    const deptRuleSet = await this.prisma.firewallRuleSet.findFirst({
      where: { entityType: RuleSetType.DEPARTMENT, entityId: departmentId },
      include: { rules: true }
    })

    // Fetch VM rules
    const vmRuleSet = await this.prisma.firewallRuleSet.findFirst({
      where: { entityType: RuleSetType.VM, entityId: vmId },
      include: { rules: true }
    })

    // Convert to FirewallRuleInput format
    const convertRule = (rule: any): FirewallRuleInput => ({
      id: rule.id,
      name: rule.name,
      action: rule.action,
      direction: rule.direction,
      priority: rule.priority,
      protocol: rule.protocol,
      srcPortStart: rule.srcPortStart ?? undefined,
      srcPortEnd: rule.srcPortEnd ?? undefined,
      dstPortStart: rule.dstPortStart ?? undefined,
      dstPortEnd: rule.dstPortEnd ?? undefined,
      srcIpAddr: rule.srcIpAddr ?? undefined,
      srcIpMask: rule.srcIpMask ?? undefined,
      dstIpAddr: rule.dstIpAddr ?? undefined,
      dstIpMask: rule.dstIpMask ?? undefined,
      connectionState: rule.connectionState ?? undefined,
      overridesDept: rule.overridesDept ?? false
    })

    const deptRules = (deptRuleSet?.rules ?? []).map(convertRule)
    const vmRules = (vmRuleSet?.rules ?? []).map(convertRule)

    return [deptRules, vmRules]
  }
}
