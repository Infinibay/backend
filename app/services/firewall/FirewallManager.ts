import type { Connection } from '@infinibay/libvirt-node'
import { PrismaClient, RuleSetType } from '@prisma/client'

import { Debugger } from '@utils/debug'
import { FilterNameGenerator } from '@utils/firewall/FilterNameGenerator'

import { FirewallFilterFactory } from './FirewallFilterFactory'
import { FirewallRuleService } from './FirewallRuleService'

const debug = new Debugger('infinibay:service:firewall:manager')

/**
 * Result object returned by ensureFirewallForVM operation.
 */
export interface FirewallSetupResult {
  /** Whether the department ruleset was created (true) or already existed (false) */
  departmentRuleSetCreated: boolean

  /** Whether the VM ruleset was created (true) or already existed (false) */
  vmRuleSetCreated: boolean

  /** The generated department filter name */
  departmentFilterName: string

  /** The generated VM filter name */
  vmFilterName: string

  /** Number of department rules applied to libvirt filter */
  departmentRulesApplied: number

  /** Number of VM rules applied to libvirt filter */
  vmRulesApplied: number

  /** Overall success status of the operation */
  success: boolean
}

/**
 * Filter names for a VM and its department.
 */
export interface FilterNames {
  /** The department filter name (e.g., 'ibay-department-a1b2c3d4') */
  departmentFilterName: string

  /** The VM filter name (e.g., 'ibay-vm-e5f6g7h8') */
  vmFilterName: string
}

/**
 * Result object returned by resyncVMFirewall operation.
 */
export interface VMFirewallResyncResult {
  /** Whether the VM ruleset was created during resync (true) or already existed (false) */
  ruleSetCreated: boolean

  /** Number of department rules inherited by this VM */
  departmentRulesInherited: number

  /** Number of VM-specific rules applied to libvirt filter */
  vmRulesApplied: number

  /** Whether the libvirt filter was successfully applied */
  filterApplied: boolean

  /** Overall success status of the resync operation */
  success: boolean
}

/**
 * Facade that simplifies complex firewall initialization operations.
 *
 * This manager coordinates between multiple services to provide a clean,
 * maintainable API for firewall operations during VM creation. It replaces
 * the complex multi-step flow that previously existed in createMachineService.ts.
 *
 * Design Patterns:
 * - **Facade Pattern**: Hides complexity of coordinating multiple services
 * - **Dependency Injection**: All dependencies injected via constructor
 * - **Single Responsibility**: Focused only on firewall setup coordination
 *
 * Architecture:
 * - Instantiates FirewallRuleService for database operations
 * - Instantiates FirewallFilterFactory for libvirt filter creation and validation
 * - Provides two primary methods:
 *   1. ensureFirewallForVM(): Complete firewall setup
 *   2. getFilterNames(): Retrieve filter identifiers
 *
 * Validation:
 * - Rule validation is handled internally by FirewallFilterFactory
 * - VM filter creation automatically validates department filter existence
 * - FirewallOrchestrationService is NOT used by this manager - validation occurs
 *   within the filter creation strategies
 *
 * Filter Creation Contract:
 * - Department filters: Always ensured/created, even with zero rules (base for inheritance)
 * - VM filters: Always ensured/created, even with zero rules, and inherit from the department via <filterref>
 *
 * This eliminates the need for:
 * - Type casting to access private properties
 * - Scattered firewall logic across multiple private methods
 * - Redundant database queries (single query with necessary relations)
 * - Direct manipulation of internal service state
 *
 * @example
 * ```typescript
 * const manager = new FirewallManager(prisma, libvirtConnection)
 *
 * // During VM creation: ensure firewall is fully set up
 * const result = await manager.ensureFirewallForVM(vmId, departmentId)
 * console.log(`Applied ${result.vmRulesApplied} VM rules`)
 *
 * // Later: get filter names for attaching to VM NIC
 * const names = await manager.getFilterNames(vmId)
 * console.log(`Department filter: ${names.departmentFilterName}`)
 * console.log(`VM filter: ${names.vmFilterName}`)
 * ```
 */
export class FirewallManager {
  private readonly filterFactory: FirewallFilterFactory
  private readonly ruleService: FirewallRuleService

  constructor (
    private readonly prisma: PrismaClient,
    private readonly libvirtConnection: Connection
  ) {
    this.ruleService = new FirewallRuleService(prisma)
    this.filterFactory = new FirewallFilterFactory(prisma, libvirtConnection)

    debug.log('info', 'FirewallManager initialized')
  }

  /**
   * Ensures firewall infrastructure (ruleset + nwfilter) exists for an entity.
   *
   * This method is called by Prisma callbacks to proactively create firewall
   * infrastructure when departments or VMs are created. It creates:
   * 1. FirewallRuleSet in database (if it doesn't exist)
   * 2. Empty nwfilter in libvirt (for inheritance and future rules)
   *
   * After creating the FirewallRuleSet, this method updates the entity's
   * firewallRuleSetId foreign key to establish the 1:1 relationship. This ensures
   * subsequent queries with include: { firewallRuleSet } will find the ruleset.
   *
   * The method is idempotent - safe to call multiple times for the same entity.
   *
   * @param entityType - The type of entity (DEPARTMENT or VM)
   * @param entityId - The UUID of the entity
   * @param description - Description for the ruleset
   * @returns Promise resolving to creation result
   */
  async ensureFirewallInfrastructure (
    entityType: RuleSetType,
    entityId: string,
    description: string
  ): Promise<{ ruleSetCreated: boolean, filterCreated: boolean }> {
    debug.log('info', `Ensuring firewall infrastructure for ${entityType} ${entityId}`)

    const result = {
      ruleSetCreated: false,
      filterCreated: false
    }

    try {
      // Step 1: Check if ruleset already exists
      const existingRuleSet = await this.prisma.firewallRuleSet.findFirst({
        where: {
          entityType,
          entityId
        }
      })

      // Step 2: Create ruleset if it doesn't exist
      if (!existingRuleSet) {
        debug.log('info', `Creating ${entityType} ruleset for ${entityId}`)
        const filterName = FilterNameGenerator.generate(entityType, entityId)
        const priority = entityType === RuleSetType.DEPARTMENT ? 1000 : 500

        const ruleSet = await this.ruleService.createRuleSet(
          entityType,
          entityId,
          description,
          filterName,
          priority
        )
        result.ruleSetCreated = true

        // Step 2.1: Link the ruleset to the entity via foreign key
        try {
          if (entityType === RuleSetType.DEPARTMENT) {
            await this.prisma.department.update({
              where: { id: entityId },
              data: { firewallRuleSetId: ruleSet.id }
            })
            debug.log('info', `Linked ruleset ${ruleSet.id} to department ${entityId}`)
          } else if (entityType === RuleSetType.VM) {
            await this.prisma.machine.update({
              where: { id: entityId },
              data: { firewallRuleSetId: ruleSet.id }
            })
            debug.log('info', `Linked ruleset ${ruleSet.id} to VM ${entityId}`)
          }
        } catch (linkError) {
          // Handle edge case where entity doesn't exist (rare race condition)
          // Log error but don't throw to prevent callback failure
          debug.log('error', `Failed to link ruleset to ${entityType} ${entityId}: ${(linkError as Error).message}`)
        }
      } else {
        debug.log('info', `${entityType} ruleset already exists for ${entityId}`)

        // Self-healing: Check if FK link is broken and repair if needed
        if (entityType === RuleSetType.DEPARTMENT) {
          const dept = await this.prisma.department.findUnique({
            where: { id: entityId },
            select: { firewallRuleSetId: true }
          })
          if (dept && !dept.firewallRuleSetId) {
            await this.prisma.department.update({
              where: { id: entityId },
              data: { firewallRuleSetId: existingRuleSet.id }
            })
            debug.log('info', `Self-healed: linked existing ruleset ${existingRuleSet.id} to department ${entityId}`)
          }
        } else if (entityType === RuleSetType.VM) {
          const machine = await this.prisma.machine.findUnique({
            where: { id: entityId },
            select: { firewallRuleSetId: true }
          })
          if (machine && !machine.firewallRuleSetId) {
            await this.prisma.machine.update({
              where: { id: entityId },
              data: { firewallRuleSetId: existingRuleSet.id }
            })
            debug.log('info', `Self-healed: linked existing ruleset ${existingRuleSet.id} to VM ${entityId}`)
          }
        }
      }

      // Step 3: Create empty nwfilter in libvirt
      try {
        // Create filter directly with empty rules array to avoid timing issues
        // We can't use ensureDepartmentFilter/ensureVMFilter because they query the DB
        // for the ruleset, which might not be visible yet in the current transaction
        const filterCreationResult = await this.filterFactory.createFilter(
          entityType,
          entityId,
          [] // Empty rules array - filter will be updated later when rules are added
        )
        result.filterCreated = true
        debug.log('info', `${entityType} filter created in libvirt: ${filterCreationResult.filterName} (UUID: ${filterCreationResult.libvirtUuid})`)
      } catch (error) {
        // Gracefully handle filter already exists
        const errorMessage = (error as Error).message
        if (errorMessage.includes('already exists')) {
          debug.log('info', `${entityType} filter already exists in libvirt for ${entityId}`)
          result.filterCreated = false
        } else {
          throw error
        }
      }

      debug.log('info', `Firewall infrastructure ensured for ${entityType} ${entityId}`)
      return result
    } catch (error) {
      debug.log('error', `Failed to ensure firewall infrastructure for ${entityType} ${entityId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Ensures complete firewall setup for a VM and its department.
   *
   * **NOTE**: With Prisma callbacks now creating firewall infrastructure automatically,
   * this method primarily serves as a **verification layer** and **fallback mechanism**
   * for VMs/departments created before the callback system was implemented.
   *
   * The afterCreateDepartment and afterCreateMachine Prisma callbacks (in
   * utils/modelCallbacks/) now handle proactive creation of FirewallRuleSets and
   * nwfilters when entities are created. This method continues to be useful for:
   * - Verifying firewall infrastructure exists before VM definition in libvirt
   * - Creating missing infrastructure for legacy VMs/departments
   * - Manual troubleshooting and repair operations
   *
   * This method includes self-healing logic to detect and repair broken foreign key
   * relationships. If a FirewallRuleSet exists but isn't linked to the entity, it will
   * be linked automatically.
   *
   * This is the primary method that replaces the entire ensureNWFiltersExist() +
   * createVMRuleSet() + createNWFiltersInLibvirt() flow from createMachineService.ts.
   *
   * Operations performed:
   * 1. Query VM with all necessary relations (single query)
   * 2. Validate departmentId matches VM's actual department
   * 3. Create department ruleset in DB if it doesn't exist (fallback for legacy departments)
   * 4. Create VM ruleset in DB if it doesn't exist (fallback for legacy VMs)
   * 5. Ensure department filter exists in libvirt (even with zero rules)
   * 6. Ensure VM filter exists in libvirt (even with zero rules) to establish inheritance
   * 7. Return comprehensive result with all details
   *
   * Filter Creation Contract:
   * - Department filters: Always ensured/created, even with zero rules (base for inheritance)
   * - VM filters: Always ensured/created, even with zero rules, and inherit from the department via <filterref>
   *
   * Design Principles:
   * - **Fail-fast**: Validates preconditions early (VM exists, has department, departmentId matches)
   * - **Idempotent**: Safe to call multiple times - checks existence before creating
   * - **Graceful degradation**: Handles "filter already exists" errors gracefully
   * - **No redundant queries**: Reuses initially loaded relations when possible
   *
   * @param vmId - The UUID of the VM
   * @param departmentId - The UUID of the department (must match VM's department.id)
   * @returns Promise resolving to comprehensive setup result
   * @throws Error if VM not found, has no department, departmentId mismatch, or critical operation fails
   */
  async ensureFirewallForVM (vmId: string, departmentId: string): Promise<FirewallSetupResult> {
    debug.log('info', `Ensuring firewall for VM ${vmId} in department ${departmentId}`)

    try {
      // Step 1: Query VM once with all necessary relations
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
        throw new Error(`VM ${vmId} has no department`)
      }

      // Step 2: Validate departmentId matches VM's actual department
      if (vm.department.id !== departmentId) {
        throw new Error(
          `Department ID mismatch: VM ${vmId} belongs to department ${vm.department.id}, ` +
          `but departmentId argument is ${departmentId}`
        )
      }

      // Initialize result object
      const result: FirewallSetupResult = {
        departmentRuleSetCreated: false,
        vmRuleSetCreated: false,
        departmentFilterName: FilterNameGenerator.generate(RuleSetType.DEPARTMENT, departmentId),
        vmFilterName: FilterNameGenerator.generate(RuleSetType.VM, vmId),
        departmentRulesApplied: 0,
        vmRulesApplied: 0,
        success: false
      }

      // Step 3: Ensure department ruleset exists in database
      let departmentRuleSet = vm.department.firewallRuleSet
      if (!departmentRuleSet) {
        // Self-healing: Check if ruleset exists but FK link is broken
        const orphanedDeptRuleSet = await this.prisma.firewallRuleSet.findFirst({
          where: {
            entityType: RuleSetType.DEPARTMENT,
            entityId: departmentId
          },
          include: { rules: true }
        })

        if (orphanedDeptRuleSet) {
          // Self-heal: Link the existing ruleset
          debug.log('info', `Self-healed: linking existing ruleset ${orphanedDeptRuleSet.id} to department ${departmentId}`)
          await this.prisma.department.update({
            where: { id: departmentId },
            data: { firewallRuleSetId: orphanedDeptRuleSet.id }
          })
          departmentRuleSet = orphanedDeptRuleSet
        } else {
          // Create new ruleset
          debug.log('warn', `Creating department ruleset for ${departmentId} as fallback (should have been created by callback)`)
          departmentRuleSet = await this.ruleService.createRuleSet(
            RuleSetType.DEPARTMENT,
            departmentId,
            `Department Firewall: ${vm.department.name}`,
            FilterNameGenerator.generate(RuleSetType.DEPARTMENT, departmentId),
            1000 // Lower priority than VM rules
          )
          result.departmentRuleSetCreated = true
          // Update the in-memory object to reflect the newly created ruleset
          departmentRuleSet.rules = []
        }
      }

      // Step 4: Ensure VM ruleset exists in database
      let vmRuleSet = vm.firewallRuleSet
      if (!vmRuleSet) {
        // Self-healing: Check if ruleset exists but FK link is broken
        const orphanedVMRuleSet = await this.prisma.firewallRuleSet.findFirst({
          where: {
            entityType: RuleSetType.VM,
            entityId: vmId
          },
          include: { rules: true }
        })

        if (orphanedVMRuleSet) {
          // Self-heal: Link the existing ruleset
          debug.log('info', `Self-healed: linking existing ruleset ${orphanedVMRuleSet.id} to VM ${vmId}`)
          await this.prisma.machine.update({
            where: { id: vmId },
            data: { firewallRuleSetId: orphanedVMRuleSet.id }
          })
          vmRuleSet = orphanedVMRuleSet
        } else {
          // Create new ruleset
          debug.log('warn', `Creating VM ruleset for ${vmId} as fallback (should have been created by callback)`)
          vmRuleSet = await this.ruleService.createRuleSet(
            RuleSetType.VM,
            vmId,
            `VM Firewall: ${vm.name}`,
            FilterNameGenerator.generate(RuleSetType.VM, vmId),
            500 // Higher priority than department
          )
          result.vmRuleSetCreated = true
          // Update the in-memory object to reflect the newly created ruleset
          vmRuleSet.rules = []
        }
      }

      // Step 5: Always ensure department filter exists in libvirt (even with zero rules)
      // The department filter must exist as a base for VM inheritance
      // No re-query needed - we have the data from initial query or just created it
      const departmentRules = departmentRuleSet.rules || []
      debug.log('info', `Ensuring department filter in libvirt for ${departmentId} with ${departmentRules.length} rules`)
      const deptFilterResult = await this.filterFactory.ensureDepartmentFilter(departmentId)
      result.departmentRulesApplied = deptFilterResult.rulesApplied

      // Step 6: Create VM filter in libvirt ALWAYS (even with zero rules)
      // This is required to establish the inheritance relationship via <filterref>
      // No re-query needed - we have the data from initial query or just created it
      const vmRules = vmRuleSet.rules || []
      debug.log('info', `Creating VM filter in libvirt for ${vmId} with ${vmRules.length} VM-specific rules (inherits dept rules)`)

      try {
        const vmFilterResult = await this.filterFactory.ensureVMFilter(vmId)
        result.vmRulesApplied = vmFilterResult.rulesApplied
      } catch (error) {
        const errorMessage = (error as Error).message

        // Self-healing: If VM filter creation failed due to missing department filter, try to fix it
        if (errorMessage.includes('does not exist in libvirt') || errorMessage.includes('department callbacks failed')) {
          debug.log('warn', `VM filter creation failed due to missing department filter. Attempting self-heal for department ${departmentId}`)

          try {
            // Ensure department filter exists (self-healing)
            await this.filterFactory.ensureDepartmentFilter(departmentId)
            debug.log('info', `Self-heal successful: department filter created for ${departmentId}`)

            // Retry VM filter creation
            debug.log('info', `Retrying VM filter creation for ${vmId} after self-heal`)
            const vmFilterResult = await this.filterFactory.ensureVMFilter(vmId)
            result.vmRulesApplied = vmFilterResult.rulesApplied
            debug.log('info', `Self-heal complete: VM filter created successfully for ${vmId}`)
          } catch (retryError) {
            debug.log('error', `Self-heal failed for VM ${vmId}: ${(retryError as Error).message}`)
            throw retryError
          }
        } else {
          // Different error, propagate it
          throw error
        }
      }

      // Step 7: Mark as successful only after both filters are ensured
      result.success = true
      debug.log('info', `Firewall setup complete for VM ${vmId}`)

      return result
    } catch (error) {
      debug.log('error', `Failed to ensure firewall for VM ${vmId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Re-synchronizes firewall state for an existing VM.
   *
   * This method is useful for:
   * - Migrating VMs created before the firewall system
   * - Manual troubleshooting or repairing inconsistent state
   * - Re-syncing firewall state after manual libvirt modifications
   *
   * **For NEW VMs, use ensureFirewallForVM() instead.**
   *
   * Operations performed:
   * 1. Query VM with all necessary relations (single query)
   * 2. Create VM ruleset in DB if it doesn't exist
   * 3. Count inherited department rules
   * 4. Ensure department filter exists in libvirt (if department has rules)
   * 5. Apply/update the VM filter in libvirt (automatically handles department inheritance)
   *
   * Design Principles:
   * - **Idempotent**: Safe to call multiple times - checks existence before creating
   * - **Minimal impact**: Only creates missing resources, doesn't recreate existing ones
   * - **Graceful error handling**: Continues operation even if filter creation fails
   *
   * @param vmId - The UUID of the VM to resync
   * @returns Promise resolving to comprehensive resync result
   * @throws Error if VM not found, has no department, or critical operation fails
   */
  async resyncVMFirewall (vmId: string): Promise<VMFirewallResyncResult> {
    debug.log('info', `Re-syncing firewall for VM ${vmId}`)

    try {
      // Step 1: Query VM with all necessary relations
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
        throw new Error(`VM ${vmId} has no department`)
      }

      // Initialize result object
      const result: VMFirewallResyncResult = {
        ruleSetCreated: false,
        departmentRulesInherited: 0,
        vmRulesApplied: 0,
        filterApplied: false,
        success: false
      }

      // Step 2: Ensure VM ruleset exists in database
      if (!vm.firewallRuleSet) {
        debug.log('info', `Creating VM ruleset for ${vmId} during resync`)
        const ruleSet = await this.ruleService.createRuleSet(
          RuleSetType.VM,
          vmId,
          `VM Firewall: ${vm.name}`,
          FilterNameGenerator.generate(RuleSetType.VM, vmId),
          500 // Higher priority than department
        )
        result.ruleSetCreated = true

        // Link the ruleset to the machine via foreign key
        await this.prisma.machine.update({
          where: { id: vmId },
          data: { firewallRuleSetId: ruleSet.id }
        })
        debug.log('info', `Linked ruleset ${ruleSet.id} to VM ${vmId} during resync`)
      }

      // Step 3: Count inherited department rules
      const deptRules = vm.department.firewallRuleSet?.rules || []
      result.departmentRulesInherited = deptRules.length
      debug.log('info', `VM ${vmId} inherits ${deptRules.length} department rules`)

      // Step 4: Always ensure department filter exists (even with zero rules)
      // VMFilterStrategy requires department filter to exist before creating VM filter
      debug.log('info', `Ensuring department filter for ${vm.department.id}`)
      await this.filterFactory.ensureDepartmentFilter(vm.department.id)

      // Step 5: Apply/update VM filter in libvirt
      // This automatically handles department filter inheritance via VMFilterStrategy
      try {
        debug.log('info', `Applying VM filter for ${vmId}`)
        const vmFilterResult = await this.filterFactory.ensureVMFilter(vmId)
        result.vmRulesApplied = vmFilterResult.rulesApplied
        result.filterApplied = true
        debug.log('info', `Applied ${vmFilterResult.rulesApplied} VM-specific rules to filter`)
      } catch (error) {
        debug.log('error', `Failed to apply VM filter: ${(error as Error).message}`)
        result.filterApplied = false
        // Don't throw - allow partial success
      }

      // Mark as successful if we at least ensured the ruleset exists
      result.success = true
      debug.log('info', `Firewall resync complete for VM ${vmId}`)

      return result
    } catch (error) {
      debug.log('error', `Failed to resync firewall for VM ${vmId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Gets filter names for a VM and its department without creating them.
   *
   * This is a convenience method for retrieving filter identifiers that are
   * needed when attaching filters to a VM's network interface. It does not
   * create any resources - only generates the names based on entity IDs.
   *
   * @param vmId - The UUID of the VM
   * @returns Promise resolving to filter names
   * @throws Error if VM not found or has no department
   *
   * @example
   * ```typescript
   * const names = await manager.getFilterNames('vm-123')
   * // Use names.departmentFilterName and names.vmFilterName in VM domain XML
   * ```
   */
  async getFilterNames (vmId: string): Promise<FilterNames> {
    debug.log('info', `Getting filter names for VM ${vmId}`)

    try {
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          department: true
        }
      })

      if (!vm) {
        throw new Error(`VM not found: ${vmId}`)
      }

      if (!vm.department) {
        throw new Error(`VM ${vmId} has no department`)
      }

      const result: FilterNames = {
        departmentFilterName: FilterNameGenerator.generate(RuleSetType.DEPARTMENT, vm.department.id),
        vmFilterName: FilterNameGenerator.generate(RuleSetType.VM, vmId)
      }

      debug.log('info', `Filter names for VM ${vmId}: dept=${result.departmentFilterName}, vm=${result.vmFilterName}`)

      return result
    } catch (error) {
      debug.log('error', `Failed to get filter names for VM ${vmId}: ${(error as Error).message}`)
      throw error
    }
  }
}
