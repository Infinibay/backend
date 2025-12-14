/**
 * Barrel export for firewall services.
 *
 * This module exports all firewall-related services, allowing consumers
 * to import from a single location.
 *
 * ## Arquitectura Actual (nftables)
 *
 * La arquitectura utiliza nftables a través de infinivirt para la gestión
 * de reglas de firewall a nivel de bridge (Layer 2). Los servicios son:
 *
 * - **FirewallManagerV2**: High-level VM firewall management via nftables
 * - **FirewallOrchestrationService**: Orchestration and rule application
 * - **FirewallRuleService**: CRUD operations for rules in database
 * - **FirewallValidationService**: Rule validation
 * - **InfinivirtFirewallService**: Direct nftables interaction via infinivirt
 *
 * @example
 * ```typescript
 * import {
 *   FirewallManagerV2,
 *   FirewallOrchestrationService,
 *   FirewallRuleService,
 *   FirewallValidationService,
 *   InfinivirtFirewallService
 * } from '@services/firewall'
 *
 * // Create database rulesets
 * const manager = new FirewallManagerV2(prisma)
 * await manager.ensureFirewallInfrastructure('VM', vmId, 'My VM Firewall')
 *
 * // Apply rules to nftables (handled by infinivirt during VM lifecycle)
 * await manager.resyncVMFirewall(vmId, tapDeviceName)
 * ```
 */

export { FirewallManagerV2, FirewallSetupResult, FirewallResyncResult } from './FirewallManagerV2'
export { FirewallOrchestrationService } from './FirewallOrchestrationService'
export { CreateRuleData, FirewallRuleService, FirewallRuleSetWithRules, UpdateRuleData } from './FirewallRuleService'
export { FirewallValidationService } from './FirewallValidationService'
export { InfinivirtFirewallService } from './InfinivirtFirewallService'
