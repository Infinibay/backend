/**
 * Barrel export for firewall services.
 *
 * This module exports all firewall-related services, allowing consumers
 * to import from a single location.
 *
 * ## Arquitectura Actual (nftables)
 *
 * La arquitectura utiliza nftables a través de infinization para la gestión
 * de reglas de firewall a nivel de bridge (Layer 2). Los servicios son:
 *
 * - **FirewallManagerV2**: High-level VM firewall management via nftables
 * - **FirewallOrchestrationService**: Orchestration and rule application
 * - **FirewallRuleService**: CRUD operations for rules in database
 * - **FirewallValidationService**: Rule validation
 * - **InfinizationFirewallService**: Direct nftables interaction via infinization
 *
 * @example
 * ```typescript
 * import {
 *   FirewallManagerV2,
 *   FirewallOrchestrationService,
 *   FirewallRuleService,
 *   FirewallValidationService,
 *   InfinizationFirewallService
 * } from '@services/firewall'
 *
 * // Create database rulesets
 * const manager = new FirewallManagerV2(prisma)
 * await manager.ensureFirewallInfrastructure('VM', vmId, 'My VM Firewall')
 *
 * // Apply rules to nftables (handled by infinization during VM lifecycle)
 * await manager.resyncVMFirewall(vmId, tapDeviceName)
 * ```
 */

export { FirewallManagerV2, FirewallSetupResult, FirewallResyncResult } from './FirewallManagerV2'
export { FirewallOrchestrationService } from './FirewallOrchestrationService'
export { CreateRuleData, FirewallRuleService, FirewallRuleSetWithRules, UpdateRuleData } from './FirewallRuleService'
export { FirewallValidationService } from './FirewallValidationService'
export { InfinizationFirewallService } from './InfinizationFirewallService'
