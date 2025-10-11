import { FirewallRule, RuleSetType } from '@prisma/client'

import { FilterCreationResult, IFilterStrategy } from './IFilterStrategy'
import { FilterNameGenerator } from '@utils/firewall/FilterNameGenerator'
import { FirewallValidationService } from '../FirewallValidationService'
import { LibvirtNWFilterService } from '../LibvirtNWFilterService'
import { NWFilterXMLGeneratorService } from '../NWFilterXMLGeneratorService'

/**
 * Strategy for creating department-level firewall filters.
 *
 * Department filters serve as the base layer that is inherited by all VMs
 * within the department. These filters have no parent filter themselves.
 *
 * Architecture:
 * - Department filters are base filters (no <filterref> parent)
 * - All VMs in a department automatically inherit these rules
 * - Changes to department filters affect all VMs in the department
 *
 * Workflow:
 * 1. Validate rules for conflicts
 * 2. Generate filter name using centralized naming utility
 * 3. Generate filter XML (without parent filter reference)
 * 4. Define filter in libvirt
 * 5. Return creation result
 */
export class DepartmentFilterStrategy implements IFilterStrategy {
  constructor (
    private xmlGenerator: NWFilterXMLGeneratorService,
    private libvirtService: LibvirtNWFilterService,
    private validationService: FirewallValidationService
  ) {}

  /**
   * Creates a department filter in libvirt.
   *
   * This method handles both empty filters (no rules) and filters with rules.
   * Empty filters are valid and commonly created by Prisma callbacks when
   * departments are first created. They serve as base filters for VM inheritance.
   *
   * @param departmentId - The UUID of the department
   * @param rules - Array of firewall rules to apply (can be empty array)
   * @returns Promise resolving to filter creation result
   * @throws Error if validation fails or filter creation fails
   */
  async createFilter (departmentId: string, rules: FirewallRule[]): Promise<FilterCreationResult> {
    // Log if creating an empty filter (common for new departments)
    if (rules.length === 0) {
      console.log(`[DepartmentFilterStrategy] Creating empty department filter ${departmentId} (base filter for inheritance)`)
    }

    // Step 1: Validate rules for conflicts (validation passes for empty arrays)
    const validation = await this.validationService.validateRuleConflicts(rules)
    if (!validation.isValid) {
      throw new Error(`Rule validation failed: ${validation.conflicts.map(c => c.message).join(', ')}`)
    }

    // Step 2: Generate filter name
    const filterName = this.getFilterName(departmentId)

    // Step 3: Generate XML without parent filter (department filters are base filters)
    const xmlContent = await this.xmlGenerator.generateFilterXML(
      { name: filterName, rules }
    )

    // Step 4: Define filter in libvirt
    const libvirtUuid = await this.libvirtService.defineFilter(xmlContent)

    // Step 5: Return creation result
    return {
      filterName,
      libvirtUuid,
      xmlContent,
      rulesApplied: rules.length
    }
  }

  /**
   * Gets the filter name for a department.
   *
   * @param departmentId - The UUID of the department
   * @returns The generated filter name
   */
  getFilterName (departmentId: string): string {
    return FilterNameGenerator.generate(RuleSetType.DEPARTMENT, departmentId)
  }
}
