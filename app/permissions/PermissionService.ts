/**
 * PermissionService — evaluates the action/verb RBAC.
 *
 * Effective grants for a user = expand(role grants) ∪ user ALLOW overrides −
 * user DENY overrides (DENY removes the leaf entirely). Each leaf maps to the
 * broadest scope granted. `can()` checks possession + (for scoped permissions)
 * that the granted scope covers the instance. SUPER_ADMIN works purely from
 * data: its role holds `*` @ANY which expands to every leaf.
 */
import { PrismaClient } from '@prisma/client'
import { Scope, SCOPE_RANK, expand, isScopedPermission, RESOURCES } from './registry'
import { ScopeInstance, scopeCovers } from './scope'
import { getUserAccessibleDepartments } from '@main/utils/authChecker'
import { ForbiddenError } from '@utils/errors'

export type GrantMap = Map<string, Scope>

function broaderScope (a: Scope | undefined, b: Scope): Scope {
  if (!a) return b
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b
}

export class PermissionService {
  constructor (private readonly prisma: PrismaClient) {}

  /** Resolve a user's effective leaf grants → broadest scope per leaf. */
  async effectiveGrants (userId: string): Promise<GrantMap> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        customRole: { select: { permissions: { select: { permission: true, scope: true } } } },
        permissionOverrides: { select: { permission: true, scope: true, effect: true } }
      }
    })
    const allow: GrantMap = new Map()
    if (!user) return allow

    // Role grants: custom role if assigned, else the system role matching the
    // legacy `role` enum (so users created before role assignment still work).
    let roleGrants = user.customRole?.permissions
    if (!roleGrants) {
      const role = await this.prisma.role.findUnique({
        where: { key: user.role },
        select: { permissions: { select: { permission: true, scope: true } } }
      })
      roleGrants = role?.permissions ?? []
    }
    for (const g of roleGrants) {
      for (const leaf of expand(g.permission)) {
        allow.set(leaf, broaderScope(allow.get(leaf), g.scope as Scope))
      }
    }

    // Per-user overrides: ALLOW widens, DENY removes the leaf entirely.
    const denied = new Set<string>()
    for (const ov of user.permissionOverrides) {
      const leaves = expand(ov.permission)
      if (ov.effect === 'ALLOW') {
        for (const leaf of leaves) allow.set(leaf, broaderScope(allow.get(leaf), ov.scope as Scope))
      } else {
        for (const leaf of leaves) denied.add(leaf)
      }
    }
    for (const leaf of denied) allow.delete(leaf)
    return allow
  }

  /**
   * Does the user hold `permission`? For scoped permissions, also check the
   * granted scope covers `instance` (when provided). When no instance is given
   * for a scoped permission, this only verifies possession (used by list
   * queries that then narrow rows via `scopedWhere`).
   *
   * `minScope` adds a scope floor for the possession-only path (no instance):
   * fleet-wide ops gated by a scoped verb (e.g. a system-wide health round on
   * `vmHealth:execute`) pass `minScope: 'ANY'` so an `@OWN` grant is NOT enough —
   * only a user granted the verb at `ANY` may run them.
   */
  async can (userId: string, permission: string, instance?: ScopeInstance | null, grants?: GrantMap, minScope?: Scope): Promise<boolean> {
    const allow = grants ?? await this.effectiveGrants(userId)
    const leaves = expand(permission)
    if (leaves.length === 0) return false

    // The user must hold every leaf; the usable scope is the narrowest among them.
    let granted: Scope | undefined
    for (const leaf of leaves) {
      const s = allow.get(leaf)
      if (!s) return false
      granted = granted === undefined ? s : (SCOPE_RANK[s] < SCOPE_RANK[granted] ? s : granted)
    }
    if (granted === undefined) return false

    if (instance && isScopedPermission(permission)) {
      return scopeCovers(this.prisma, userId, granted, instance)
    }
    // Possession-only path: enforce the optional scope floor.
    if (minScope && SCOPE_RANK[granted] < SCOPE_RANK[minScope]) return false
    return true
  }

  async assert (userId: string, permission: string, instance?: ScopeInstance | null, grants?: GrantMap, minScope?: Scope): Promise<void> {
    const ok = await this.can(userId, permission, instance, grants, minScope)
    if (!ok) throw new ForbiddenError(`Not authorized: requires ${permission}`)
  }

  /**
   * Privilege-escalation guard: can a principal holding `grants` grant
   * `permission` at `scope` to someone else? True iff the principal already
   * holds every leaf of `permission` at a scope at least as broad. SUPER_ADMIN
   * (`*` @ANY → every leaf @ANY) covers everything; a delegated admin can only
   * hand out the subset it already has. Fail-closed on unknown permissions.
   */
  coversGrant (grants: GrantMap, permission: string, scope: Scope): boolean {
    const leaves = expand(permission)
    if (leaves.length === 0) return false
    const need = SCOPE_RANK[scope]
    for (const leaf of leaves) {
      const have = grants.get(leaf)
      if (have === undefined || SCOPE_RANK[have] < need) return false
    }
    return true
  }

  /** Throws ForbiddenError unless the actor's own grants cover (permission, scope). */
  async assertCanGrant (actorId: string, permission: string, scope: Scope, grants?: GrantMap): Promise<void> {
    const allow = grants ?? await this.effectiveGrants(actorId)
    if (!this.coversGrant(allow, permission, scope)) {
      throw new ForbiddenError(`You cannot grant "${permission}" (${scope}): it exceeds your own permissions`)
    }
  }

  /**
   * Prisma WHERE filter narrowing a list query to the user's granted scope for
   * `permission` (e.g. `vm:view`). ownerField/deptField default to the common
   * Machine shape and can be overridden per resource.
   */
  async scopedWhere (
    userId: string,
    permission: string,
    baseWhere: Record<string, unknown> = {},
    opts: { ownerField?: string, deptField?: string } = {},
    grants?: GrantMap
  ): Promise<Record<string, unknown>> {
    const allow = grants ?? await this.effectiveGrants(userId)
    let granted: Scope | undefined
    for (const leaf of expand(permission)) {
      const s = allow.get(leaf)
      granted = s !== undefined ? broaderScope(granted, s) : granted
    }
    if (granted === undefined) return { ...baseWhere, id: '__no_access__' }
    if (granted === 'ANY') return baseWhere

    const ownerField = opts.ownerField ?? 'userId'
    const deptField = opts.deptField ?? 'departmentId'
    const ors: Record<string, unknown>[] = [{ [ownerField]: userId }]
    if (granted === 'DEPARTMENT') {
      const depts = await getUserAccessibleDepartments(this.prisma, userId)
      if (depts.length) ors.push({ [deptField]: { in: depts } })
    }
    return { ...baseWhere, OR: ors }
  }

  /**
   * Legacy nav-resource set for the sidebar/route guard. A resource contributes
   * its `nav` id if the user holds any verb on it; the VM family maps to
   * `workspace` (own-only end user) vs `desktops` (department/any operator).
   */
  async deriveAllowedResources (userId: string, grants?: GrantMap): Promise<string[]> {
    const allow = grants ?? await this.effectiveGrants(userId)
    const navs = new Set<string>()
    for (const r of RESOURCES) {
      let max: Scope | undefined
      for (const v of r.verbs) {
        const s = allow.get(`${r.key}:${v}`)
        if (s !== undefined) max = broaderScope(max, s)
      }
      if (max === undefined) continue
      if (r.nav === 'desktops') {
        navs.add(max === 'OWN' ? 'workspace' : 'desktops')
      } else {
        navs.add(r.nav)
      }
    }
    if (navs.has('desktops')) navs.add('overview')
    return [...navs]
  }
}
