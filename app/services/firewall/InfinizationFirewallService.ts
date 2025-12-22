import type { PrismaClient, FirewallRule as PrismaFirewallRule } from '@prisma/client'

import {
  NftablesService,
  type FirewallRuleInput,
  type FirewallApplyResult,
  type ConnectionStateConfig,
  type NftablesError,
  VM_CHAIN_PREFIX
} from '@infinibay/infinization'
import { Debugger } from '@utils/debug'

const debug = new Debugger('service:firewall:infinization')

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
  private nftablesService: NftablesService

  constructor (private prisma: PrismaClient) {
    this.nftablesService = new NftablesService()
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
    debug.log('Initializing InfinizationFirewallService')

    try {
      await this.nftablesService.initialize()
      debug.log('info', 'InfinizationFirewallService initialized successfully')
    } catch (error) {
      const nftError = error as NftablesError | Error | unknown
      const message = `Failed to initialize InfinizationFirewallService: ${nftError instanceof Error ? nftError.message : String(nftError)}`
      debug.log('error', message)

      // Log structured error details if available
      if (this.isNftablesError(nftError)) {
        debug.log('error', `NftablesError code: ${nftError.code}`)
        if (nftError.context) {
          debug.log('error', `Context: ${JSON.stringify(nftError.context)}`)
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
    vmRules: FirewallRuleInput[]
  ): Promise<FirewallApplyResult> {
    if (!vmId) {
      throw new Error('VM ID is required')
    }

    const tapDeviceName = await this.getTapDeviceName(vmId)

    debug.log(`Applying firewall rules for VM ${vmId} (TAP: ${tapDeviceName})`)
    debug.log(`Department rules: ${departmentRules.length}, VM rules: ${vmRules.length}`)

    try {
      const result = await this.nftablesService.applyRules(
        vmId,
        tapDeviceName,
        departmentRules,
        vmRules
      )

      debug.log('info', `Applied ${result.appliedRules}/${result.totalRules} rules to VM ${vmId}`)

      if (result.failures.length > 0) {
        for (const failure of result.failures) {
          debug.log('warn', `Failed to apply rule ${failure.ruleName}: ${failure.error}`)
        }
      }

      return result
    } catch (error) {
      const nftError = error as NftablesError | Error | unknown
      const message = `Failed to apply VM rules for ${vmId} (TAP: ${tapDeviceName}): ${nftError instanceof Error ? nftError.message : String(nftError)}`
      debug.log('error', message)

      // Log structured error details if available
      if (this.isNftablesError(nftError)) {
        debug.log('error', `NftablesError code: ${nftError.code}`)
        if (nftError.context) {
          debug.log('error', `Context: ${JSON.stringify(nftError.context)}`)
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
   * @returns Object containing total VMs count, count of updated VMs, and any errors
   */
  async applyDepartmentRules (
    departmentId: string,
    departmentRules: FirewallRuleInput[]
  ): Promise<{ totalVms: number; vmsUpdated: number; errors: string[] }> {
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

    debug.log(`Applying department rules to ${machines.length} VMs in department ${departmentId}`)

    let vmsUpdated = 0
    const errors: string[] = []

    for (const machine of machines) {
      // Skip VMs without TAP device configured
      if (!machine.configuration?.tapDeviceName) {
        const errorMsg = `VM ${machine.id} (${machine.name}) has no TAP device configured, skipping`
        debug.log('warn', errorMsg)
        errors.push(errorMsg)
        continue
      }

      try {
        // Get VM-specific rules
        const vmRules = machine.firewallRuleSet?.rules || []
        const vmRulesInput = this.convertPrismaRulesToInput(vmRules)

        // Apply rules via nftables
        const result = await this.nftablesService.applyRules(
          machine.id,
          machine.configuration.tapDeviceName,
          departmentRules,
          vmRulesInput
        )

        // VM was processed successfully (even if some rules failed)
        vmsUpdated++

        // Log and track partial failures
        if (result.failedRules > 0) {
          debug.log('warn', `VM ${machine.id} (${machine.name}): ${result.failedRules}/${result.totalRules} rules failed to apply`)

          for (const failure of result.failures) {
            debug.log('warn', `  Rule "${failure.ruleName}": ${failure.error}`)
          }

          // Add summarized message to errors for caller visibility
          errors.push(`VM ${machine.id} (${machine.name}): ${result.failedRules}/${result.totalRules} rules failed (partial success)`)
        }
      } catch (error) {
        // Hard failure - the entire operation for this VM failed
        const errorMsg = `Failed to apply rules to VM ${machine.id} (${machine.name}): ${error instanceof Error ? error.message : String(error)}`
        debug.log('error', errorMsg)
        errors.push(errorMsg)
      }
    }

    debug.log('info', `Department rules applied to ${vmsUpdated}/${machines.length} VMs`)

    if (errors.length > 0) {
      debug.log('warn', `${errors.length} VMs failed to update`)
    }

    return { totalVms: machines.length, vmsUpdated, errors }
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

    debug.log(`Removing firewall for VM ${vmId}`)

    await this.nftablesService.removeVMChain(vmId)

    debug.log('info', `Firewall removed for VM ${vmId}`)
  }

  /**
   * Lists all VM firewall chains in the nftables table.
   * Useful for debugging and cleanup operations.
   *
   * @returns Array of objects containing chain name and extracted VM ID
   */
  async listVMChains (): Promise<Array<{ chainName: string; vmId: string }>> {
    debug.log('Listing VM firewall chains')

    try {
      const allChains = await this.nftablesService.listChains()

      // Filter for VM chains (those starting with VM_CHAIN_PREFIX)
      const vmChains = allChains
        .filter(chain => chain.startsWith(VM_CHAIN_PREFIX))
        .map(chainName => ({
          chainName,
          // Extract VM ID by removing the prefix
          // Note: The VM ID is sanitized (first 8 chars, alphanumeric only)
          vmId: chainName.substring(VM_CHAIN_PREFIX.length)
        }))

      debug.log('info', `Found ${vmChains.length} VM firewall chains`)

      return vmChains
    } catch (error) {
      const message = `Failed to list VM chains: ${error instanceof Error ? error.message : String(error)}`
      debug.log('error', message)
      throw new Error(message)
    }
  }

  /**
   * Converts Prisma FirewallRule models to FirewallRuleInput format.
   * This is the format expected by NftablesService.
   *
   * @param rules - Array of Prisma FirewallRule objects
   * @returns Array of FirewallRuleInput objects
   */
  convertPrismaRulesToInput (rules: PrismaFirewallRule[]): FirewallRuleInput[] {
    return rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      action: rule.action as 'ACCEPT' | 'DROP' | 'REJECT',
      direction: rule.direction as 'IN' | 'OUT' | 'INOUT',
      priority: rule.priority,
      protocol: rule.protocol,
      srcPortStart: rule.srcPortStart,
      srcPortEnd: rule.srcPortEnd,
      dstPortStart: rule.dstPortStart,
      dstPortEnd: rule.dstPortEnd,
      srcIpAddr: rule.srcIpAddr,
      srcIpMask: rule.srcIpMask,
      dstIpAddr: rule.dstIpAddr,
      dstIpMask: rule.dstIpMask,
      connectionState: rule.connectionState as ConnectionStateConfig | null,
      overridesDept: rule.overridesDept
    }))
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

    debug.log(`Retrieved TAP device name for VM ${vmId}: ${machine.configuration.tapDeviceName}`)

    return machine.configuration.tapDeviceName
  }
}
