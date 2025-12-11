/**
 * Barrel export for firewall services.
 *
 * This module exports all firewall-related services, allowing consumers
 * to import from a single location.
 *
 * ## Arquitectura Actual (nftables)
 * La arquitectura actual utiliza nftables a través de InfinivirtFirewallService
 * para la gestión de reglas de firewall. Los servicios recomendados son:
 * - FirewallOrchestrationService: Orquestación de alto nivel
 * - FirewallRuleService: CRUD de reglas en base de datos
 * - FirewallValidationService: Validación de reglas
 * - InfinivirtFirewallService: Aplicación de reglas a nftables
 *
 * ## Servicios Legacy (deprecated)
 * Los siguientes servicios son parte de la arquitectura legacy basada en
 * libvirt nwfilter y están marcados como deprecated:
 * - FirewallManager: Usar FirewallManagerV2 o FirewallOrchestrationService
 * - LibvirtNWFilterService: Usar InfinivirtFirewallService
 * - NWFilterXMLGeneratorService: Ya no es necesario con nftables
 *
 * @example
 * ```typescript
 * // Uso recomendado (nueva arquitectura nftables)
 * import {
 *   FirewallOrchestrationService,
 *   FirewallRuleService,
 *   FirewallValidationService,
 *   InfinivirtFirewallService
 * } from '@services/firewall'
 *
 * // Uso legacy (deprecated)
 * import {
 *   FirewallManager, // @deprecated - use FirewallManagerV2
 *   LibvirtNWFilterService, // @deprecated - use InfinivirtFirewallService
 *   NWFilterXMLGeneratorService // @deprecated - not needed with nftables
 * } from '@services/firewall'
 * ```
 */

export { FirewallFilterFactory } from './FirewallFilterFactory'
/** @deprecated Use FirewallManagerV2 or FirewallOrchestrationService instead */
export { FilterNames, FirewallManager, FirewallSetupResult, VMFirewallResyncResult } from './FirewallManager'
export { FirewallOrchestrationService } from './FirewallOrchestrationService'
export { CreateRuleData, FirewallRuleService, FirewallRuleSetWithRules, UpdateRuleData } from './FirewallRuleService'
export { FirewallValidationService } from './FirewallValidationService'
export { InfinivirtFirewallService } from './InfinivirtFirewallService'
/** @deprecated Use InfinivirtFirewallService instead */
export { LibvirtNWFilterService } from './LibvirtNWFilterService'
/** @deprecated No longer needed with nftables architecture */
export { NWFilterXMLGeneratorService } from './NWFilterXMLGeneratorService'
