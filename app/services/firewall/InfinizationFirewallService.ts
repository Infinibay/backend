import type { PrismaClient, FirewallRule as PrismaFirewallRule } from '@prisma/client'

import {
  NftablesService,
  type FirewallRuleInput,
  type FirewallApplyResult,
  type FirewallDefaultAction,
  type NftablesError,
  VM_CHAIN_PREFIX,
  generateVMChainName
} from '@infinibay/infinization'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'
import { prismaRulesToFirewallInput } from './firewallRuleConversion'
const debug = logger.child({ module: 'service:firewall:infinization' })

/**
 * Service that adapts infinization's NftablesService for use in the backend.
 * Acts as a bridge between the backend's firewall orchestration and infinization's
 * nftables-based firewall management.
 *
 * This service:
 * - Retrieves TAP device names from the database
 * - Converts Prisma FirewallRule models to FirewallRuleInput format
 * - Delegates actual nftables operations to NftablesService
 * - Provides error handling and logging
 *
 * @example
 * const service = new InfinizationFirewallService(prisma)
 * await service.initialize()
 * await service.applyVMRules(vmId, departmentRules, vmRules)
 */
export class InfinizationFirewallService {
  constructor (private prisma: PrismaClient) {}

  /**
   * Returns the SINGLE shared NftablesService (the same instance that drives the VM
   * lifecycle), rather than constructing a fresh one per call. Sharing one instance
   * is what makes the per-chain mutex and the rule-hash cache actually effective
   * across every firewall entrypoint (I1/I2) — separate instances cannot coordinate.
   */
  private async getNftables (): Promise<NftablesService> {
    return (await getInfinization()).getNftablesService()
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Initializes the nftables infrastructure.
   * Must be called before using any other methods.
   * Creates the infinization table and base forward chain if they don't exist.
   *
   * @throws Error if initialization fails
   */
  async initialize (): Promise<void> {
    debug.debug('Initializing InfinizationFirewallService')

    try {
      await (await this.getNftables()).initialize()
      debug.info('InfinizationFirewallService initialized successfully')
    } catch (error) {
      const nftError = error as NftablesError | Error | unknown
      const message = `Failed to initialize InfinizationFirewallService: ${nftError instanceof Error ? nftError.message : String(nftError)}`
      debug.error(message)

      // Log structured error details if available
      if (this.isNftablesError(nftError)) {
        debug.error(`NftablesError code: ${nftError.code}`)
        if (nftError.context) {
          debug.error(`Context: ${JSON.stringify(nftError.context)}`)
        }
      }

      // Rethrow the original error to preserve structured NftablesError
      throw nftError
    }
  }

  /**
   * Applies firewall rules to a specific VM.
   * Merges department rules with VM-specific rules and applies them via nftables.
   *
   * @param vmId - The VM identifier
   * @param departmentRules - Rules inherited from the department (already converted to FirewallRuleInput)
   * @param vmRules - Rules specific to this VM (already converted to FirewallRuleInput)
   * @returns Result containing count of applied/failed rules
   * @throws Error if VM not found, TAP device not configured, or nftables operation fails
   */
  async applyVMRules (
    vmId: string,
    departmentRules: FirewallRuleInput[],
    vmRules: FirewallRuleInput[],
    defaultAction: FirewallDefaultAction = 'drop'
  ): Promise<FirewallApplyResult> {
    if (!vmId) {
      throw new Error('VM ID is required')
    }

    const tapDeviceName = await this.getTapDeviceName(vmId)

    debug.debug(`Applying firewall rules for VM ${vmId} (TAP: ${tapDeviceName}, defaultAction: ${defaultAction})`)
    debug.debug(`Department rules: ${departmentRules.length}, VM rules: ${vmRules.length}`)

    try {
      const result = await (await this.getNftables()).applyRules(
        vmId,
        tapDeviceName,
        departmentRules,
        vmRules,
        defaultAction
      )

      debug.info(`Applied ${result.appliedRules}/${result.totalRules} rules to VM ${vmId}`)

      if (result.failures.length > 0) {
        for (const failure of result.failures) {
          debug.warn(`Failed to apply rule ${failure.ruleName}: ${failure.error}`)
        }
      }

      return result
    } catch (error) {
      const nftError = error as NftablesError | Error | unknown
      const message = `Failed to apply VM rules for ${vmId} (TAP: ${tapDeviceName}): ${nftError instanceof Error ? nftError.message : String(nftError)}`
      debug.error(message)

      // Log structured error details if available
      if (this.isNftablesError(nftError)) {
        debug.error(`NftablesError code: ${nftError.code}`)
        if (nftError.context) {
          debug.error(`Context: ${JSON.stringify(nftError.context)}`)
        }
      }

      // Rethrow the original error to preserve structured NftablesError
      throw nftError
    }
  }

  /**
   * Applies department rules to all VMs in a department.
   * Each VM's existing VM-specific rules are preserved and merged with the new department rules.
   *
   * @param departmentId - The department identifier
   * @param departmentRules - Rules to apply to all VMs in the department
   * @returns Structured per-category counts. `vmsSkippedNoTap` (VM not running / no TAP
   *   yet — a benign deferral, rules apply on next start) is reported SEPARATELY from
   *   `vmsFailed` (apply genuinely failed) so callers never have to string-match error
   *   messages to tell "skipped" from "broken". A VM with partial rule failures counts
   *   as failed, not updated.
   */
  async applyDepartmentRules (
    departmentId: string,
    departmentRules: FirewallRuleInput[],
    defaultAction: FirewallDefaultAction = 'drop'
  ): Promise<{ totalVms: number; vmsUpdated: number; vmsSkippedNoTap: number; vmsFailed: number; errors: string[] }> {
    if (!departmentId) {
      throw new Error('Department ID is required')
    }

    const machines = await this.prisma.machine.findMany({
      where: { departmentId },
      include: {
        configuration: true,
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    debug.debug(`Applying department rules to ${machines.length} VMs in department ${departmentId}`)

    let vmsUpdated = 0
    let vmsSkippedNoTap = 0
    let vmsFailed = 0
    const errors: string[] = []

    for (const machine of machines) {
      // A VM with no TAP device is not running (or its network isn't up yet). Its
      // rules will be applied when it starts — this is a deferral, not a failure.
      if (!machine.configuration?.tapDeviceName) {
        vmsSkippedNoTap++
        debug.warn(`VM ${machine.id} (${machine.name}) has no TAP device (not running), deferring firewall apply`)
        continue
      }

      try {
        // Get VM-specific rules
        const vmRules = machine.firewallRuleSet?.rules || []
        const vmRulesInput = this.convertPrismaRulesToInput(vmRules)

        // Apply rules via nftables
        const result = await (await this.getNftables()).applyRules(
          machine.id,
          machine.configuration.tapDeviceName,
          departmentRules,
          vmRulesInput,
          defaultAction
        )

        if (result.failedRules > 0) {
          // Partial apply is a FAILURE for this VM (its policy is incomplete).
          vmsFailed++
          debug.warn(`VM ${machine.id} (${machine.name}): ${result.failedRules}/${result.totalRules} rules failed to apply`)
          for (const failure of result.failures) {
            debug.warn(`  Rule "${failure.ruleName}": ${failure.error}`)
          }
          errors.push(`VM ${machine.id} (${machine.name}): ${result.failedRules}/${result.totalRules} rules failed (partial apply)`)
        } else {
          vmsUpdated++
        }
      } catch (error) {
        // Hard failure - the entire operation for this VM failed
        vmsFailed++
        const errorMsg = `Failed to apply rules to VM ${machine.id} (${machine.name}): ${error instanceof Error ? error.message : String(error)}`
        debug.error(errorMsg)
        errors.push(errorMsg)
      }
    }

    debug.info(`Department rules: ${vmsUpdated} applied, ${vmsSkippedNoTap} deferred (no TAP), ${vmsFailed} failed (of ${machines.length})`)

    return { totalVms: machines.length, vmsUpdated, vmsSkippedNoTap, vmsFailed, errors }
  }

  /**
   * Removes the firewall chain for a VM.
   * Also removes jump rules from the base forward chain.
   *
   * This is a best-effort operation that does not throw for missing or
   * already-removed chains. The underlying NftablesService.removeVMChain()
   * handles these cases gracefully.
   *
   * @param vmId - The VM identifier
   */
  async removeVMFirewall (vmId: string): Promise<void> {
    if (!vmId) {
      throw new Error('VM ID is required')
    }

    debug.debug(`Removing firewall for VM ${vmId}`)

    await (await this.getNftables()).removeVMChain(vmId)

    debug.info(`Firewall removed for VM ${vmId}`)
  }

  /**
   * Removes a VM firewall chain BY CHAIN NAME.
   *
   * Cleanup/reconciliation paths enumerate chains via listVMChains() and must remove
   * them by name — chain names are a non-invertible hash of the vmId, so re-deriving
   * the chain from a recovered "vmId" would target the WRONG chain.
   *
   * @param chainName - The nftables chain name to remove
   */
  async removeVMChainByName (chainName: string): Promise<void> {
    if (!chainName) {
      throw new Error('Chain name is required')
    }

    debug.debug(`Removing firewall chain by name: ${chainName}`)

    await (await this.getNftables()).removeVMChainByName(chainName)

    debug.info(`Firewall chain removed: ${chainName}`)
  }

  /**
   * Lists all VM firewall chains in the nftables table.
   * Useful for debugging and cleanup operations.
   *
   * @returns Array of objects containing chain name and extracted VM ID
   */
  async listVMChains (): Promise<Array<{ chainName: string; vmId?: string }>> {
    debug.debug('Listing VM firewall chains')

    try {
      const allChains = await (await this.getNftables()).listChains()
      const vmChainNames = allChains.filter(chain => chain.startsWith(VM_CHAIN_PREFIX))

      if (vmChainNames.length === 0) {
        return []
      }

      // Chain names are a non-invertible SHA-256 hash of the vmId, so we cannot parse
      // the vmId back out of the name. Instead, reverse-map via the DB: compute the
      // expected chain name for every machine and match. Chains with no matching
      // machine (vmId undefined) are orphans — safe to clean up.
      const machines = await this.prisma.machine.findMany({ select: { id: true } })
      const chainToVmId = new Map<string, string>()
      for (const machine of machines) {
        chainToVmId.set(generateVMChainName(machine.id), machine.id)
      }

      const vmChains = vmChainNames.map(chainName => ({
        chainName,
        vmId: chainToVmId.get(chainName)
      }))

      debug.info(`Found ${vmChains.length} VM firewall chains (${vmChains.filter(c => !c.vmId).length} orphaned)`)

      return vmChains
    } catch (error) {
      const message = `Failed to list VM chains: ${error instanceof Error ? error.message : String(error)}`
      debug.error(message)
      throw new Error(message)
    }
  }

  /**
   * Converts Prisma FirewallRule models to FirewallRuleInput format.
   * This is the format expected by NftablesService.
   *
   * Delegates to the shared converter (firewallRuleConversion) which is the single
   * source of truth — it normalizes the connectionState shape so the translator
   * actually emits `ct state` tokens (the old inline cast silently dropped them).
   *
   * @param rules - Array of Prisma FirewallRule objects
   * @returns Array of FirewallRuleInput objects
   */
  convertPrismaRulesToInput (rules: PrismaFirewallRule[]): FirewallRuleInput[] {
    return prismaRulesToFirewallInput(rules)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Type guard to check if an error is a structured NftablesError.
   *
   * @param error - The error to check
   * @returns true if the error has the NftablesError structure
   */
  private isNftablesError (error: unknown): error is NftablesError {
    return (
      error instanceof Error &&
      'code' in error &&
      typeof (error as NftablesError).code === 'string'
    )
  }

  /**
   * Retrieves the TAP device name for a VM from the database.
   *
   * @param vmId - The VM identifier
   * @returns The TAP device name
   * @throws Error if VM not found, configuration missing, or TAP device not configured
   */
  private async getTapDeviceName (vmId: string): Promise<string> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { configuration: true }
    })

    if (!machine) {
      throw new Error(`VM not found: ${vmId}`)
    }

    if (!machine.configuration) {
      throw new Error(`VM configuration not found for VM: ${vmId}`)
    }

    if (!machine.configuration.tapDeviceName) {
      throw new Error(`TAP device name not found for VM: ${vmId}. The VM may not be running or network is not configured.`)
    }

    // Defense-in-depth: this DB-sourced name is interpolated into nft rule tokens, so
    // validate it against the Linux interface-name charset/length before use (M1).
    const tapDeviceName = machine.configuration.tapDeviceName
    if (!/^[a-zA-Z0-9_-]{1,15}$/.test(tapDeviceName)) {
      throw new Error(`Invalid TAP device name for VM ${vmId}: "${tapDeviceName}"`)
    }

    debug.debug(`Retrieved TAP device name for VM ${vmId}: ${tapDeviceName}`)

    return tapDeviceName
  }
}
