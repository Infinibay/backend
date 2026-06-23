/**
 * Reusable harness for "every mutation/query enforces a permission" tests.
 *
 * Runs each operation THROUGH THE SCHEMA (so the @Can middleware fires — unit
 * tests that call resolvers directly bypass it). The permission gate runs before
 * the resolver body, so the document only needs to be syntactically valid; dummy
 * variables are fine. We assert:
 *   - a user with no grants is DENIED (the security property), and
 *   - a SUPER_ADMIN is NOT denied by the gate (proves @Can is wired, not always-deny).
 */
import { buildSchema } from 'type-graphql'
import { graphql, GraphQLSchema } from 'graphql'
import resolvers from '@main/graphql/resolvers'
import { authChecker } from '@main/utils/authChecker'
import { pubsub } from '@main/utils/pubsub'
import { InfinibayContext } from '@utils/context'
import { PrismaClient, User } from '@prisma/client'

let schemaPromise: Promise<GraphQLSchema> | null = null

/** Build (once) the full TypeGraphQL schema, including the @Can middleware. */
export function getTestSchema (): Promise<GraphQLSchema> {
  if (!schemaPromise) {
    schemaPromise = buildSchema({ resolvers, authChecker, pubSub: pubsub, validate: false })
  }
  return schemaPromise
}

export function permissionContext (prisma: PrismaClient, user: User | null): InfinibayContext {
  return { req: {} as any, res: {} as any, prisma, user, setupMode: false }
}

export function isPermissionError (errors?: readonly any[] | null): boolean {
  return !!errors?.some((e) =>
    e?.extensions?.code === 'FORBIDDEN' ||
    e?.extensions?.code === 'UNAUTHENTICATED' ||
    /not authorized|access denied|forbidden|requires [a-z]+:/i.test(e?.message ?? '')
  )
}

/**
 * Assert that `document` is gated: denied for a no-perms user, allowed past the
 * gate for a SUPER_ADMIN (any non-permission error is fine for the latter).
 */
export async function assertRequiresPermission (opts: {
  schema: GraphQLSchema
  prisma: PrismaClient
  document: string
  variables?: Record<string, unknown>
  noPermsUser: User
  superAdminUser: User
}): Promise<void> {
  const denied = await graphql({
    schema: opts.schema,
    source: opts.document,
    variableValues: opts.variables,
    contextValue: permissionContext(opts.prisma, opts.noPermsUser)
  })
  if (!isPermissionError(denied.errors)) {
    throw new Error(`Expected a permission error for the no-perms user but got: ${JSON.stringify(denied.errors?.map((e) => e.message) ?? denied.data)}`)
  }
  expect(isPermissionError(denied.errors)).toBe(true)

  const allowed = await graphql({
    schema: opts.schema,
    source: opts.document,
    variableValues: opts.variables,
    contextValue: permissionContext(opts.prisma, opts.superAdminUser)
  })
  expect(isPermissionError(allowed.errors)).toBe(false)
}
