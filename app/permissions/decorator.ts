/**
 * `@Can('vm:edit')` — the single authorization chokepoint, replacing
 * `@Authorized(...)` + `assertCanAccessResource` + `assertCanManageVM`.
 *
 * Runs as a TypeGraphQL method middleware BEFORE the resolver:
 *  - ensures the request is authenticated,
 *  - verifies the user holds the permission,
 *  - for scoped permissions with an instance id, loads the instance and checks
 *    the granted scope (OWN/DEPARTMENT/ANY) covers it.
 *
 * Global verbs (create/settings) and scoped LIST queries pass with possession
 * only; list resolvers then narrow rows with `ctx.scopedWhere(...)`.
 *
 *   @Can('vm:create')                                   // global
 *   @Can('vm:edit', { id: (a) => a.id })                // instance, default 'vm' loader
 *   @Can('snapshot:create', { id: (a) => a.machineId, scopeVia: 'vm' })
 *   @Can('vm:view')                                     // list → use ctx.scopedWhere in body
 */
import { UseMiddleware, MiddlewareFn } from 'type-graphql'
import { InfinibayContext, requireUser } from '@utils/context'
import { attachPermissionHelpers } from './helpers'
import { LOADERS } from './scope'
import { resourceOf, isScopedPermission, Scope } from './registry'

export interface CanOptions {
  /** Extract the instance id from resolver args (omit for global/create/list ops). */
  id?: (args: Record<string, any>) => string | null | undefined
  /** Loader name to resolve the instance (defaults to the permission's resource). */
  scopeVia?: string
  /**
   * Scope floor for the possession-only path (no instance). Use `minScope: 'ANY'`
   * on fleet-wide ops gated by a scoped verb so an `@OWN`/`@DEPARTMENT` grant is
   * not enough — only a holder of the verb at the required scope may run them.
   */
  minScope?: Scope
}

export function Can (permission: string, opts: CanOptions = {}) {
  const middleware: MiddlewareFn<InfinibayContext> = async ({ context, args }, next) => {
    const user = requireUser(context)
    attachPermissionHelpers(context)
    const grants = await context.permissionGrants!()
    const svc = context.permissions!

    if (isScopedPermission(permission) && opts.id) {
      const id = opts.id(args as Record<string, any>)
      if (id) {
        const loaderName = opts.scopeVia ?? resourceOf(permission) ?? ''
        const loader = LOADERS[loaderName]
        const instance = loader ? await loader(context.prisma, id) : null
        await svc.assert(user.id, permission, instance, grants, opts.minScope)
        return next()
      }
    }

    // Global verb, create, list query, or fleet-wide op: possession (+ optional scope floor).
    await svc.assert(user.id, permission, null, grants, opts.minScope)
    return next()
  }
  return UseMiddleware(middleware)
}
