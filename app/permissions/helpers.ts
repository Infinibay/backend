/**
 * Attaches the permission helpers (`can`/`assertCan`/`scopedWhere`/grants) to an
 * InfinibayContext. Idempotent and memoised per request so repeated checks in a
 * resolver hit the DB once. Called by the `@Can` decorator and by context setup
 * (index.ts) and test factories, so resolver bodies can always use the helpers.
 */
import { InfinibayContext, requireUser } from '@utils/context'
import { PermissionService, GrantMap } from './PermissionService'
import { toScopeInstance } from './scope'

export function attachPermissionHelpers (ctx: InfinibayContext): void {
  if (ctx.assertCan) return // already attached
  const svc = new PermissionService(ctx.prisma)
  ctx.permissions = svc

  let grantsPromise: Promise<GrantMap> | null = null
  const grants = (): Promise<GrantMap> => {
    if (!ctx.user) return Promise.resolve(new Map())
    if (!grantsPromise) grantsPromise = svc.effectiveGrants(ctx.user.id)
    return grantsPromise
  }
  ctx.permissionGrants = grants

  ctx.can = async (permission, instance) => {
    if (!ctx.user) return false
    return svc.can(ctx.user.id, permission, instance != null ? toScopeInstance(instance) : null, await grants())
  }

  ctx.assertCan = async (permission, instance) => {
    const user = requireUser(ctx)
    await svc.assert(user.id, permission, instance != null ? toScopeInstance(instance) : null, await grants())
  }

  ctx.scopedWhere = async (permission, baseWhere = {}, opts = {}) => {
    const user = requireUser(ctx)
    return svc.scopedWhere(user.id, permission, baseWhere, opts, await grants())
  }
}
