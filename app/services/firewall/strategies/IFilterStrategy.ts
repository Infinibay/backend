import { FirewallRule } from '@prisma/client'

/**
 * Result object returned by filter creation operations.
 */
export interface FilterCreationResult {
  /** The generated filter name (e.g., 'ibay-vm-a1b2c3d4') */
  filterName: string

  /** The libvirt UUID of the created filter */
  libvirtUuid: string

  /** The complete XML content of the filter */
  xmlContent: string

  /** Number of rules applied to the filter */
  rulesApplied: number
}

/**
 * Strategy interface for filter creation.
 *
 * This interface defines the contract for filter creation strategies,
 * enabling polymorphic behavior where the factory can work with different
 * strategies without knowing their concrete implementations (Open/Closed Principle).
 *
 * Implementations:
 * - DepartmentFilterStrategy: Creates base filters for departments (no parent)
 * - VMFilterStrategy: Creates VM filters that inherit from department filters
 */
export interface IFilterStrategy {
  /**
   * Creates a firewall filter in libvirt with the specified rules.
   *
   * @param entityId - The UUID of the entity (department ID or VM ID)
   * @param rules - Array of firewall rules to apply to the filter
   * @returns Promise resolving to creation result with filter details
   * @throws Error if filter creation fails or validation fails
   */
  createFilter (entityId: string, rules: FirewallRule[]): Promise<FilterCreationResult>

  /**
   * Gets the filter name for a given entity without creating the filter.
   *
   * @param entityId - The UUID of the entity (department ID or VM ID)
   * @returns The generated filter name
   */
  getFilterName (entityId: string): string
}
