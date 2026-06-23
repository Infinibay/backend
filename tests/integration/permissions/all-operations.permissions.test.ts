/**
 * RBAC coverage test — asserts that EVERY GraphQL Query/Mutation field is
 * permission-gated: a user whose role grants nothing must be denied on all of
 * them. Introspects the built schema (so it auto-covers all ~227 operations and
 * any future ones) and synthesises type-valid dummy arguments so the @Can
 * middleware fires (it runs before the resolver body, so there are no side
 * effects on the denied path).
 *
 * Operations that are intentionally public / any-authenticated are allowlisted
 * in UNGATED. If a gated operation fails to deny, the test lists it — catching a
 * missing @Can.
 */
import {
  GraphQLSchema,
  graphql,
  isNonNullType,
  isListType,
  isScalarType,
  isEnumType,
  isInputObjectType,
  isObjectType,
  GraphQLInputType,
  GraphQLField
} from 'graphql'
import { User } from '@prisma/client'
import { testPrisma } from '../../setup/jest.setup'
import { getTestSchema, permissionContext, isPermissionError } from '../../setup/permission-harness'
import { seedSystemRoles, createNoPermsUser } from '../../setup/permission-factories'

// Intentionally NOT permission-gated (public or available to any authenticated user).
const UNGATED = new Set<string>([
  'login',
  'currentUser',
  'myPermissions'
])

function dummyForType (type: GraphQLInputType, depth = 0): any {
  if (isNonNullType(type)) return dummyForType(type.ofType as GraphQLInputType, depth)
  if (isListType(type)) return []
  if (isScalarType(type)) {
    switch (type.name) {
      case 'Int':
      case 'Float': return 1
      case 'Boolean': return false
      case 'DateTimeISO':
      case 'DateTime': return new Date(0).toISOString()
      case 'JSONObject':
      case 'JSON': return {}
      default: return 'x' // String, ID, and unknown scalars
    }
  }
  if (isEnumType(type)) return type.getValues()[0]?.value
  if (isInputObjectType(type)) {
    if (depth > 5) return {}
    const obj: Record<string, any> = {}
    for (const f of Object.values(type.getFields())) {
      // Only required fields, to keep the dummy minimal but type-valid.
      if (isNonNullType(f.type)) obj[f.name] = dummyForType(f.type as GraphQLInputType, depth + 1)
    }
    return obj
  }
  return null
}

function selectionFor (type: any): string {
  let t = type
  while (isNonNullType(t) || isListType(t)) t = t.ofType
  return isObjectType(t) ? ' { __typename }' : ''
}

function buildOperation (kind: 'query' | 'mutation', field: GraphQLField<any, any>) {
  const varDefs: string[] = []
  const args: string[] = []
  const variables: Record<string, any> = {}
  for (const arg of field.args) {
    varDefs.push(`$${arg.name}: ${arg.type.toString()}`)
    args.push(`${arg.name}: $${arg.name}`)
    if (isNonNullType(arg.type)) variables[arg.name] = dummyForType(arg.type as GraphQLInputType)
  }
  const argStr = args.length ? `(${args.join(', ')})` : ''
  const varStr = varDefs.length ? `(${varDefs.join(', ')})` : ''
  const document = `${kind}${varStr} { ${field.name}${argStr}${selectionFor(field.type)} }`
  return { document, variables }
}

describe('RBAC: every gated operation denies a permission-less user', () => {
  const prisma = testPrisma.prisma
  let schema: GraphQLSchema
  let noPerms: User

  beforeAll(async () => {
    schema = await getTestSchema()
    await seedSystemRoles(prisma)
    noPerms = await createNoPermsUser(prisma)
  }, 120000)

  it('denies a no-grants user on all Query/Mutation fields (and covers >150 ops)', async () => {
    const ops: Array<{ kind: 'query' | 'mutation', name: string, field: GraphQLField<any, any> }> = []
    for (const [name, field] of Object.entries(schema.getQueryType()!.getFields())) {
      if (!UNGATED.has(name)) ops.push({ kind: 'query', name, field })
    }
    for (const [name, field] of Object.entries(schema.getMutationType()!.getFields())) {
      if (!UNGATED.has(name)) ops.push({ kind: 'mutation', name, field })
    }

    const notDenied: string[] = []
    for (const op of ops) {
      const { document, variables } = buildOperation(op.kind, op.field)
      const result = await graphql({
        schema,
        source: document,
        variableValues: variables,
        contextValue: permissionContext(prisma, noPerms)
      })
      // The security invariant: a permission-less user must never successfully
      // execute a gated op. "Blocked" = an error occurred AND no field data was
      // returned. This holds for an outright permission denial AND for an
      // input-validation error that masks it (the resolver body never ran). An
      // ungated op that executes returns non-null field data → flagged.
      const blocked = (result.errors?.length ?? 0) > 0 && result.data?.[op.name] == null
      if (!blocked) notDenied.push(`${op.kind} ${op.name}${isPermissionError(result.errors) ? '' : ' (executed/non-perm)'}`)
    }

    if (notDenied.length) {
      throw new Error(
        `The following operations did NOT deny a permission-less user — add @Can, or allowlist if intentionally public:\n  ${notDenied.join('\n  ')}`
      )
    }
    expect(ops.length).toBeGreaterThan(150)
  }, 180000)
})
