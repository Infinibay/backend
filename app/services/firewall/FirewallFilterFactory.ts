import type { Connection } from '@infinibay/libvirt-node'
import { FirewallRule, PrismaClient, RuleSetType } from '@prisma/client'

import { DepartmentFilterStrategy, FilterCreationResult, VMFilterStrategy } from './strategies'
import { FilterNameGenerator } from '@utils/firewall/FilterNameGenerator'
import { FirewallValidationService } from './FirewallValidationService'
import { LibvirtNWFilterService } from './LibvirtNWFilterService'
import { NWFilterXMLGeneratorService } from './NWFilterXMLGeneratorService'

/**
 * Factory for creating firewall filters using the Strategy Pattern.
 *
 * This factory encapsulates the complexity of choosing and executing
 * the correct strategy based on entity type (Department vs VM).
 *
 * Architecture:
 * - Instantiates all required services (validation, XML generation, libvirt)
 * - Creates strategy instances (DepartmentFilterStrategy, VMFilterStrategy)
 * - Provides facade methods for common operations
 * - Delegates to appropriate strategy based on RuleSetType
 *
 * Design Patterns:
 * - Factory Pattern: Creates appropriate strategy based on entity type
 * - Strategy Pattern: Delegates to polymorphic strategy implementations
 * - Facade Pattern: Simplifies complex filter creation operations
 *
 * Future Integration:
 * This factory will be used by the FirewallManager facade (to be created
 * in subsequent phase) to provide a unified API for firewall operations.
 *
 * @example
 * ```typescript
 * const factory = new FirewallFilterFactory(prisma, libvirtConnection)
 *
 * // Create a department filter
 * const deptResult = await factory.createFilter(
 *   RuleSetType.DEPARTMENT,
 *   'dept-id-123',
 *   departmentRules
 * )
 *
 * // Create a VM filter (automatically inherits from department)
 * const vmResult = await factory.createFilter(
 *   RuleSetType.VM,
 *   'vm-id-456',
 *   vmRules
 * )
 * ```
 */
export class FirewallFilterFactory {
  private readonly departmentStrategy: DepartmentFilterStrategy
  private readonly validationService: FirewallValidationService
  private readonly vmStrategy: VMFilterStrategy
  private readonly xmlGenerator: NWFilterXMLGeneratorService
  private readonly libvirtService: LibvirtNWFilterService

  constructor (
    private readonly prisma: PrismaClient,
    private readonly libvirtConnection: Connection
  ) {
    // Initialize services
    this.validationService = new FirewallValidationService()
    this.xmlGenerator = new NWFilterXMLGeneratorService()
    this.libvirtService = new LibvirtNWFilterService(libvirtConnection)

    // Initialize strategies with their dependencies
    this.departmentStrategy = new DepartmentFilterStrategy(
      this.xmlGenerator,
      this.libvirtService,
      this.validationService
    )

    this.vmStrategy = new VMFilterStrategy(
      prisma,
      this.xmlGenerator,
      this.libvirtService,
      this.validationService,
      this.departmentStrategy
    )
  }

  /**
   * Creates a firewall filter based on entity type.
   *
   * This method delegates to the appropriate strategy (Department or VM)
   * based on the entityType parameter.
   *
   * @param entityType - The type of entity (DEPARTMENT or VM)
   * @param entityId - The UUID of the entity
   * @param rules - Array of firewall rules to apply
   * @returns Promise resolving to filter creation result
   * @throws Error if entity type is unknown or filter creation fails
   */
  async createFilter (
    entityType: RuleSetType,
    entityId: string,
    rules: FirewallRule[]
  ): Promise<FilterCreationResult> {
    switch (entityType) {
    case RuleSetType.DEPARTMENT:
      return await this.departmentStrategy.createFilter(entityId, rules)

    case RuleSetType.VM:
      return await this.vmStrategy.createFilter(entityId, rules)

    default:
      throw new Error(`Unknown entity type: ${entityType}`)
    }
  }

  /**
   * Gets the filter name for a given entity without creating the filter.
   *
   * This is a convenience facade method that delegates to the centralized
   * FilterNameGenerator utility.
   *
   * @param entityType - The type of entity (DEPARTMENT or VM)
   * @param entityId - The UUID of the entity
   * @returns The generated filter name
   */
  getFilterName (entityType: RuleSetType, entityId: string): string {
    return FilterNameGenerator.generate(entityType, entityId)
  }

  /**
   * Ensures a department filter exists in libvirt.
   *
   * This method:
   * 1. Queries the department with its FirewallRuleSet
   * 2. Creates the department filter if it has rules
   * 3. Returns the creation result
   *
   * @param departmentId - The UUID of the department
   * @returns Promise resolving to filter creation result
   * @throws Error if department not found or has no FirewallRuleSet
   */
  async ensureDepartmentFilter (departmentId: string): Promise<FilterCreationResult> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!department) {
      throw new Error(`Department not found: ${departmentId}`)
    }

    if (!department.firewallRuleSet) {
      throw new Error(
        `Department ${departmentId} has no FirewallRuleSet. ` +
        'Please create a FirewallRuleSet for this department first.'
      )
    }

    return await this.departmentStrategy.createFilter(
      departmentId,
      department.firewallRuleSet.rules
    )
  }

  /**
   * Ensures a VM filter exists in libvirt.
   *
   * This method:
   * 1. Queries the VM with its FirewallRuleSet and department
   * 2. Creates the VM filter if it has rules
   * 3. Automatically inherits from department filter
   * 4. Returns the creation result
   *
   * @param vmId - The UUID of the VM
   * @returns Promise resolving to filter creation result
   * @throws Error if VM not found, has no FirewallRuleSet, or department filter doesn't exist
   */
  async ensureVMFilter (vmId: string): Promise<FilterCreationResult> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: true,
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM not found: ${vmId}`)
    }

    if (!vm.firewallRuleSet) {
      throw new Error(
        `VM ${vmId} has no FirewallRuleSet. ` +
        'Please create a FirewallRuleSet for this VM first.'
      )
    }

    return await this.vmStrategy.createFilter(
      vmId,
      vm.firewallRuleSet.rules
    )
  }
}
