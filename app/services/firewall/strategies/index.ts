/**
 * Barrel export for firewall filter strategies.
 *
 * This module exports all strategy-related types and classes,
 * allowing consumers to import from a single location:
 *
 * @example
 * ```typescript
 * import {
 *   IFilterStrategy,
 *   FilterCreationResult,
 *   DepartmentFilterStrategy,
 *   VMFilterStrategy
 * } from '@services/firewall/strategies'
 * ```
 */

export { DepartmentFilterStrategy } from './DepartmentFilterStrategy'
export { FilterCreationResult, IFilterStrategy } from './IFilterStrategy'
export { VMFilterStrategy } from './VMFilterStrategy'
