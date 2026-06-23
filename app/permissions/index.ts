/**
 * Action/verb RBAC — public surface.
 *
 *   import { Can } from '@main/permissions'
 *   @Can('vm:edit', { id: (a) => a.id })
 *
 * and inside resolver bodies:  await ctx.assertCan('vm:power', vm)
 *                              const where = await ctx.scopedWhere('vm:view')
 */
export { Can } from './decorator'
export type { CanOptions } from './decorator'
export { PermissionService } from './PermissionService'
export type { GrantMap } from './PermissionService'
export { attachPermissionHelpers } from './helpers'
export {
  RESOURCES,
  RESOURCE_BY_KEY,
  RESOURCE_KEYS,
  GROUPS,
  GROUP_KEYS,
  ALL_LEAF_PERMISSIONS,
  SCOPES,
  SCOPE_RANK,
  expand,
  isValidPermission,
  isLeafPermission,
  isScopedPermission,
  resourceOf
} from './registry'
export type { Scope, ResourceDef } from './registry'
export { LOADERS, scopeCovers, toScopeInstance } from './scope'
export type { ScopeInstance, InstanceLoader } from './scope'
export { ROLE_PRESETS, SYSTEM_ROLE_KEYS, applyRolePresets, resetRoleToPreset, presetGrants } from './presets'
export type { RolePreset } from './presets'
