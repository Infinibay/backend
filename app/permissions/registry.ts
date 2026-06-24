/**
 * Permission registry — the single source of truth for the action/verb RBAC.
 *
 * A permission is `resource:verb` (e.g. `vm:edit`). Grouping permissions expand
 * to a set of leaf permissions:
 *   - `<resource>:manage`   → every leaf verb of that resource
 *   - cross-resource bundles (`infrastructure:manage`, `blueprints:manage`, …)
 *   - `*`                   → every leaf permission (SUPER_ADMIN)
 *
 * Scope (`OWN | DEPARTMENT | ANY`) is attached to a grant, not baked into the
 * verb. `scoped` resources carry an instance with an owner/department; `global`
 * resources (settings, blueprints, …) ignore scope.
 *
 * This module has NO Prisma dependency for its static data so it can be imported
 * anywhere (service, seed, GraphQL registry query, tests). Instance loaders that
 * DO need Prisma live in `scope.ts`.
 */

export type Scope = 'OWN' | 'DEPARTMENT' | 'ANY'

export const SCOPES: Scope[] = ['OWN', 'DEPARTMENT', 'ANY']

/** Higher number ⇒ broader. ANY ⊇ DEPARTMENT ⊇ OWN. */
export const SCOPE_RANK: Record<Scope, number> = { OWN: 0, DEPARTMENT: 1, ANY: 2 }

export interface ResourceDef {
  /** Resource key, e.g. `vm`. */
  key: string
  /** Human label for the UI. */
  label: string
  /** UI grouping bucket. */
  group: 'Compute' | 'Operate' | 'Blueprints' | 'Network' | 'Infrastructure' | 'Identity' | 'Governance' | 'System'
  /** Whether instances carry an owner/department (scope applies to instance verbs). */
  scoped: boolean
  /** Leaf verbs available on this resource. */
  verbs: string[]
  /** Legacy nav-area id this resource maps to (drives derived `allowedResources`/sidebar). */
  nav: string
}

/**
 * Canonical resource × verb taxonomy, derived from the 227-operation inventory.
 */
export const RESOURCES: ResourceDef[] = [
  // ── Compute / VM lifecycle & guest ──────────────────────────────────────
  { key: 'vm', label: 'Virtual machines', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'create', 'edit', 'delete', 'power', 'console', 'execute', 'migrate', 'move', 'assign', 'joinDomain'] },
  { key: 'snapshot', label: 'Snapshots', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'create', 'delete', 'restore'] },
  { key: 'vmPackage', label: 'Guest packages', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'install', 'remove', 'update'] },
  { key: 'vmProcess', label: 'Guest processes', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'kill'] },
  { key: 'vmHealth', label: 'VM health', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'execute'] },
  { key: 'recommendation', label: 'Recommendations', group: 'Compute', scoped: true, nav: 'desktops',
    verbs: ['view', 'dismiss', 'resolve', 'cancel'] },
  { key: 'maintenanceTask', label: 'Maintenance', group: 'Operate', scoped: true, nav: 'desktops',
    verbs: ['view', 'create', 'edit', 'delete', 'execute'] },
  { key: 'backup', label: 'Backups', group: 'Operate', scoped: true, nav: 'desktops',
    verbs: ['view', 'create', 'delete', 'restore', 'schedule'] },
  { key: 'pool', label: 'Pools', group: 'Operate', scoped: true, nav: 'desktops',
    verbs: ['view', 'create', 'edit', 'delete', 'scale', 'drain', 'connect'] },

  // ── Departments & firewall (department-scoped) ──────────────────────────
  { key: 'department', label: 'Departments', group: 'Operate', scoped: true, nav: 'departments',
    verbs: ['view', 'create', 'edit', 'delete', 'manageMembers', 'manageFirewall'] },
  { key: 'firewallRule', label: 'Firewall', group: 'Network', scoped: true, nav: 'firewall',
    verbs: ['view', 'create', 'edit', 'delete', 'apply'] },

  // ── Scripts ─────────────────────────────────────────────────────────────
  { key: 'script', label: 'Scripts', group: 'Operate', scoped: true, nav: 'scripts',
    verbs: ['view', 'create', 'edit', 'delete', 'assign', 'execute', 'schedule', 'manageExecutions'] },

  // ── Blueprints (global) ─────────────────────────────────────────────────
  { key: 'application', label: 'Applications', group: 'Blueprints', scoped: false, nav: 'applications',
    verbs: ['view', 'create', 'edit', 'delete'] },
  { key: 'machineTemplate', label: 'Templates', group: 'Blueprints', scoped: false, nav: 'blueprints',
    verbs: ['view', 'create', 'edit', 'delete'] },
  { key: 'machineTemplateCategory', label: 'Template categories', group: 'Blueprints', scoped: false, nav: 'blueprints',
    verbs: ['view', 'create', 'edit', 'delete'] },
  { key: 'goldenImage', label: 'Golden images', group: 'Blueprints', scoped: false, nav: 'blueprints',
    verbs: ['view', 'create', 'edit', 'delete', 'publish', 'deprecate'] },
  { key: 'iso', label: 'ISOs', group: 'Blueprints', scoped: false, nav: 'blueprints',
    verbs: ['view', 'create', 'delete', 'execute'] },

  // ── Infrastructure (global) ─────────────────────────────────────────────
  { key: 'network', label: 'Networks', group: 'Network', scoped: false, nav: 'infrastructure',
    verbs: ['view', 'create', 'edit', 'delete'] },
  { key: 'node', label: 'Nodes', group: 'Infrastructure', scoped: false, nav: 'infrastructure',
    verbs: ['view', 'create', 'edit'] },
  { key: 'system', label: 'System', group: 'System', scoped: false, nav: 'infrastructure',
    verbs: ['view'] },

  // ── Identity & users ────────────────────────────────────────────────────
  { key: 'user', label: 'Users', group: 'Governance', scoped: true, nav: 'users',
    verbs: ['view', 'create', 'edit', 'delete'] },
  { key: 'identityProvider', label: 'Identity providers', group: 'Identity', scoped: false, nav: 'identity',
    verbs: ['view', 'create', 'edit', 'delete', 'assign', 'test', 'sync', 'use'] },

  // ── Governance (SUPER_ADMIN) ────────────────────────────────────────────
  { key: 'role', label: 'Roles', group: 'Governance', scoped: false, nav: 'policies',
    verbs: ['view', 'create', 'edit', 'delete', 'assign'] },
  { key: 'permission', label: 'Permission overrides', group: 'Governance', scoped: false, nav: 'policies',
    verbs: ['grantUser'] },
  { key: 'audit', label: 'Audit log', group: 'Governance', scoped: false, nav: 'policies',
    verbs: ['view'] },

  // ── Settings (global) ───────────────────────────────────────────────────
  { key: 'appSettings', label: 'App settings', group: 'System', scoped: false, nav: 'settings',
    verbs: ['view', 'edit'] },
  { key: 'pluginPackage', label: 'Plugins', group: 'System', scoped: false, nav: 'settings',
    verbs: ['view', 'edit', 'remove'] },
  { key: 'featureFlag', label: 'Feature flags', group: 'System', scoped: false, nav: 'settings',
    verbs: ['view', 'set'] }
]

export const RESOURCE_BY_KEY: Record<string, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.key, r])
)

export const RESOURCE_KEYS: string[] = RESOURCES.map((r) => r.key)

/** Every concrete leaf permission `resource:verb`. */
export const ALL_LEAF_PERMISSIONS: string[] = RESOURCES.flatMap((r) =>
  r.verbs.map((v) => `${r.key}:${v}`)
)

const LEAF_SET = new Set(ALL_LEAF_PERMISSIONS)

/**
 * Grouping permissions → their direct members (leaves or other groups).
 * `<resource>:manage` groups are generated; cross-resource bundles + `*` are
 * declared explicitly.
 */
export const GROUPS: Record<string, string[]> = (() => {
  const groups: Record<string, string[]> = {}
  // <resource>:manage → all leaves of that resource
  for (const r of RESOURCES) {
    groups[`${r.key}:manage`] = r.verbs.map((v) => `${r.key}:${v}`)
  }
  // Cross-resource bundles
  groups['blueprints:manage'] = ['application:manage', 'machineTemplate:manage', 'machineTemplateCategory:manage', 'goldenImage:manage', 'iso:manage']
  groups['infrastructure:manage'] = ['node:manage', 'network:manage', 'pool:manage', 'system:manage']
  groups['governance:manage'] = ['role:manage', 'permission:manage', 'audit:manage']
  // `*` → every leaf
  groups['*'] = RESOURCES.map((r) => `${r.key}:manage`)
  return groups
})()

const EXPAND_CACHE = new Map<string, string[]>()

/**
 * Expand a permission to the set of concrete leaf permissions it grants.
 * A leaf returns itself; a group returns the transitive closure of its members.
 * Unknown tokens return [] (fail-closed).
 */
export function expand (permission: string): string[] {
  const cached = EXPAND_CACHE.get(permission)
  if (cached) return cached

  const out = new Set<string>()
  const stack = [permission]
  const seen = new Set<string>()
  while (stack.length) {
    const p = stack.pop() as string
    if (seen.has(p)) continue
    seen.add(p)
    if (LEAF_SET.has(p)) {
      out.add(p)
    } else if (GROUPS[p]) {
      for (const m of GROUPS[p]) stack.push(m)
    }
    // else: unknown token → contributes nothing (fail-closed)
  }
  const arr = [...out]
  EXPAND_CACHE.set(permission, arr)
  return arr
}

/** A permission is valid if it is a known leaf or a known group. */
export function isValidPermission (permission: string): boolean {
  return LEAF_SET.has(permission) || permission in GROUPS
}

export function isLeafPermission (permission: string): boolean {
  return LEAF_SET.has(permission)
}

/** Parse `resource:verb` → its resource key (or null for `*`/unknown). */
export function resourceOf (permission: string): string | null {
  if (permission === '*') return null
  const key = permission.split(':')[0]
  return RESOURCE_BY_KEY[key] ? key : null
}

/** True if the permission targets a scoped (instance-bearing) resource. */
export function isScopedPermission (permission: string): boolean {
  const key = resourceOf(permission)
  return !!key && RESOURCE_BY_KEY[key].scoped
}

/** All grouping permission keys (for UI rendering of the hierarchy). */
export const GROUP_KEYS: string[] = Object.keys(GROUPS)
