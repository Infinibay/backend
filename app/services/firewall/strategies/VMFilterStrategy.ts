import { FirewallRule, PrismaClient, RuleSetType } from '@prisma/client'

import { DepartmentFilterStrategy } from './DepartmentFilterStrategy'
import { FilterCreationResult, IFilterStrategy } from './IFilterStrategy'
import { FilterNameGenerator } from '@utils/firewall/FilterNameGenerator'
import { FirewallValidationService } from '../FirewallValidationService'
import { LibvirtNWFilterService } from '../LibvirtNWFilterService'
import { NWFilterXMLGeneratorService } from '../NWFilterXMLGeneratorService'

/**
 * Strategy for creating VM-specific firewall filters.
 *
 * VM filters inherit from department filters using the libvirt <filterref>
 * mechanism. This creates a hierarchical filter structure where VMs
 * automatically get all department rules plus their own specific rules.
 *
 * Inheritance Mechanism:
 * - VM filter includes `<filterref filter="ibay-department-xyz"/>`
 * - Libvirt automatically applies department rules first, then VM rules
 * - Changes to department filter automatically affect all VMs
 *
 * Workflow:
 * 1. Query VM to find its department
 * 2. Ensure department filter exists in libvirt
 * 3. Validate VM rules for conflicts
 * 4. Generate VM filter name
 * 5. Generate XML with parent filter reference
 * 6. Define filter in libvirt
 * 7. Return creation result
 */
export class VMFilterStrategy implements IFilterStrategy {
  constructor (
    private prisma: PrismaClient,
    private xmlGenerator: NWFilterXMLGeneratorService,
    private libvirtService: LibvirtNWFilterService,
    private validationService: FirewallValidationService,
    private departmentStrategy: DepartmentFilterStrategy
  ) {}

  /**
   * Creates a VM filter in libvirt that inherits from the department filter.
   *
   * This method handles both empty filters (no VM-specific rules) and filters with rules.
   * Empty VM filters are valid and commonly created by Prisma callbacks when VMs are
   * first created. They inherit all department rules via <filterref> mechanism.
   *
   * @param vmId - The UUID of the VM
   * @param rules - Array of firewall rules to apply (can be empty array)
   * @returns Promise resolving to filter creation result
   * @throws Error if VM not found, department not assigned, department filter doesn't exist, or validation fails
   */
  async createFilter (vmId: string, rules: FirewallRule[]): Promise<FilterCreationResult> {
    // Step 1: Query VM with department relation
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { department: true }
    })

    if (!vm) {
      throw new Error(`VM not found: ${vmId}`)
    }

    if (!vm.department) {
      throw new Error(`VM ${vmId} has no department assigned. Please assign a department before creating firewall filters.`)
    }

    // Log if creating an empty filter (common for new VMs)
    if (rules.length === 0) {
      console.log(`[VMFilterStrategy] Creating empty VM filter ${vmId} (inherits all rules from department ${vm.department.id})`)
    }

    // Step 2: Ensure department filter exists in libvirt
    const deptFilterName = this.departmentStrategy.getFilterName(vm.department.id)
    const deptFilterExists = await this.libvirtService.filterExists(deptFilterName)

    if (!deptFilterExists) {
      throw new Error(
        `Department filter '${deptFilterName}' does not exist in libvirt. ` +
        `This likely means the department callbacks failed. Department ID: ${vm.department.id}.`
      )
    }

    // Step 3: Validate VM rules (validation passes for empty arrays)
    const validation = await this.validationService.validateRuleConflicts(rules)
    if (!validation.isValid) {
      throw new Error(`Rule validation failed: ${validation.conflicts.map(c => c.message).join(', ')}`)
    }

    // Step 4: Generate VM filter name
    const vmFilterName = this.getFilterName(vmId)

    // Step 4.5: Get existing UUID if filter already exists (for redefinition)
    const existingUuid = await this.libvirtService.getFilterUuid(vmFilterName)

    // Step 5: Generate XML with parent filter reference (creates inheritance via <filterref>)
    const xmlContent = await this.xmlGenerator.generateFilterXML(
      { name: vmFilterName, rules },
      deptFilterName, // This creates the <filterref> to department filter
      existingUuid || undefined // Use existing UUID if available
    )

    // Step 6: Define filter in libvirt
    const libvirtUuid = await this.libvirtService.defineFilter(xmlContent)

    // Step 7: Return creation result
    return {
      filterName: vmFilterName,
      libvirtUuid,
      xmlContent,
      rulesApplied: rules.length
    }
  }

  /**
   * Gets the filter name for a VM.
   *
   * @param vmId - The UUID of the VM
   * @returns The generated filter name
   */
  getFilterName (vmId: string): string {
    return FilterNameGenerator.generate(RuleSetType.VM, vmId)
  }
}
