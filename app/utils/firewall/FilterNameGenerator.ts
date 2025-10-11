import crypto from 'crypto'

import { RuleSetType } from '@prisma/client'

/**
 * Centralized utility for generating libvirt nwfilter names.
 *
 * This utility ensures consistent naming across all firewall-related services
 * by providing a single source of truth for filter name generation.
 *
 * Naming Convention:
 * - Format: `ibay-{type}-{hash}`
 * - Type: "department" for department filters, "vm" for VM filters
 * - Hash: First 8 characters of MD5 hash of entity ID
 *
 * Why MD5?
 * - Deterministic: Same input always produces same output
 * - Collision-resistant: For UUIDs, MD5 provides sufficient uniqueness
 * - Compact: Truncated to 8 chars keeps filter names readable
 *
 * Example outputs:
 * - `ibay-department-a1b2c3d4` for department filters
 * - `ibay-vm-e5f6g7h8` for VM filters
 */
export class FilterNameGenerator {
  /**
   * Explicit mapping from RuleSetType enum to filter name prefix.
   * This ensures type safety and avoids relying on enum value casing.
   */
  private static readonly TYPE_PREFIX_MAP: Record<RuleSetType, string> = {
    [RuleSetType.DEPARTMENT]: 'department',
    [RuleSetType.VM]: 'vm'
  }

  /**
   * Generates a unique filter name with ibay- prefix using MD5 hashing.
   *
   * @param type - The type of rule set (DEPARTMENT or VM)
   * @param entityId - The UUID of the entity (department ID or VM ID)
   * @returns Filter name in format: ibay-{type}-{hash}
   * @throws Error if the RuleSetType is not supported
   *
   * @example
   * ```typescript
   * FilterNameGenerator.generate(RuleSetType.DEPARTMENT, 'dept-uuid-123')
   * // Returns: 'ibay-department-a1b2c3d4'
   *
   * FilterNameGenerator.generate(RuleSetType.VM, 'vm-uuid-456')
   * // Returns: 'ibay-vm-e5f6g7h8'
   * ```
   */
  static generate (type: RuleSetType, entityId: string): string {
    const hash = crypto
      .createHash('md5')
      .update(entityId)
      .digest('hex')
      .substring(0, 8)

    const typeStr = this.TYPE_PREFIX_MAP[type]
    if (!typeStr) {
      throw new Error(`Unsupported RuleSetType: ${type}`)
    }

    return `ibay-${typeStr}-${hash}`
  }
}
