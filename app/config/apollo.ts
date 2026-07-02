// Apollo Server 4 — GraphQL Server
// Official Docs: https://www.apollographql.com/docs/apollo-server/
// Repository: https://github.com/apollographql/apollo-server
import logger from '@main/logger'
import { ApolloServer, type ApolloServerPlugin } from '@apollo/server'
import {
  GraphQLError,
  GraphQLSchema,
  Kind,
  type ASTNode,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type ValidationContext,
  type ValidationRule
} from 'graphql'
import { buildSchema } from 'type-graphql'
import { getComplexity, simpleEstimator } from 'graphql-query-complexity'
import path from 'node:path'
import { InfinibayContext } from '@main/utils/context'
import { authChecker } from '@main/utils/authChecker'
import resolvers from '@main/graphql/resolvers'
import { pubsub } from '@main/utils/pubsub'
import { sanitizeErrorForUser } from '@main/utils/sanitizeError'

export interface ApolloServerBundle {
  server: ApolloServer
  schema: GraphQLSchema
}

// Parse a positive-integer env override, falling back to a safe default so a
// malformed value can never disable the limit (NaN would compare falsely).
const envInt = (value: string | undefined, fallback: number): number => {
  const n = parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Generous ceilings; every real frontend operation clears them. Override via env.
const GRAPHQL_MAX_DEPTH = envInt(process.env.GRAPHQL_MAX_DEPTH, 12)
const GRAPHQL_MAX_COMPLEXITY = envInt(process.env.GRAPHQL_MAX_COMPLEXITY, 2000)

// ── In-house query depth limit ──────────────────────────────────────────────
// graphql-depth-limit is not a dependency, so this small ValidationRule bounds
// the combinatorial resolver fan-out reachable through the schema's cyclic
// relations (department → machines → department → …). Kept generous so no
// legitimate nested query is rejected.
const measureDepth = (
  node: ASTNode,
  fragments: Record<string, FragmentDefinitionNode>,
  visited: Set<string>
): number => {
  switch (node.kind) {
    case Kind.FIELD: {
      // Introspection meta-fields (__typename/__schema/__type) don't nest resolvers.
      if (node.name.value.startsWith('__') || !node.selectionSet) return 0
      return 1 + Math.max(0, ...node.selectionSet.selections.map(
        (s) => measureDepth(s, fragments, visited)
      ))
    }
    case Kind.FRAGMENT_SPREAD: {
      // Guard against fragment cycles (belt-and-suspenders alongside graphql's
      // own NoFragmentCycles rule) so this traversal can never stack-overflow.
      if (visited.has(node.name.value)) return 0
      const frag = fragments[node.name.value]
      return frag ? measureDepth(frag, fragments, new Set(visited).add(node.name.value)) : 0
    }
    case Kind.INLINE_FRAGMENT:
    case Kind.FRAGMENT_DEFINITION:
    case Kind.OPERATION_DEFINITION:
      return Math.max(0, ...node.selectionSet.selections.map(
        (s) => measureDepth(s, fragments, visited)
      ))
    default:
      return 0
  }
}

const createDepthLimitRule = (maxDepth: number): ValidationRule =>
  (context: ValidationContext): ASTVisitor => ({
    OperationDefinition (operation: OperationDefinitionNode) {
      const fragments: Record<string, FragmentDefinitionNode> = {}
      for (const def of context.getDocument().definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def
      }
      const depth = measureDepth(operation, fragments, new Set<string>())
      if (depth > maxDepth) {
        context.reportError(new GraphQLError(
          `Query is too deep: ${depth} levels exceeds the maximum of ${maxDepth}.`,
          { nodes: [operation] }
        ))
      }
    }
  })

// Client-safe error codes whose (sanitized) message may reach the tenant. Every
// other error is masked to avoid leaking host paths / raw stderr / schema detail.
const SAFE_ERROR_CODES = new Set<string>([
  'BAD_USER_INPUT',
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED'
])

export const createApolloServer = async (): Promise<ApolloServerBundle> => {
  const schema = await buildSchema({
    resolvers,
    emitSchemaFile: path.resolve(__dirname, '../schema.graphql'),
    authChecker,
    pubSub: pubsub
  })

  // Field-count complexity ceiling, evaluated PER REQUEST (at didResolveOperation,
  // after parse+validate) so it sees the request's real variables. It MUST NOT be a
  // static validationRule: graphql-query-complexity coerces the operation's declared
  // variables against the variables it was given, so a rule built once with no
  // variables makes every operation that declares a required variable fail with
  // "Variable $x of required type … was not provided" — which broke all mutations.
  const complexityPlugin: ApolloServerPlugin = {
    async requestDidStart () {
      return {
        async didResolveOperation ({ request, document }) {
          const complexity = getComplexity({
            schema,
            operationName: request.operationName ?? undefined,
            query: document,
            variables: request.variables ?? {},
            estimators: [simpleEstimator({ defaultComplexity: 1 })]
          })
          if (complexity > GRAPHQL_MAX_COMPLEXITY) {
            throw new GraphQLError(
              `Query is too complex: ${complexity} exceeds the maximum allowed complexity of ${GRAPHQL_MAX_COMPLEXITY}.`,
              { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }
            )
          }
        }
      }
    }
  }

  const server = new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    // Only expose the full schema graph to dev tooling; hide it in production.
    introspection: process.env.NODE_ENV !== 'production',
    // Depth limit (static, variable-independent) bounds nested resolver fan-out;
    // the complexity ceiling runs per-request in complexityPlugin below.
    validationRules: [createDepthLimitRule(GRAPHQL_MAX_DEPTH)],
    plugins: [complexityPlugin],
    formatError: (error: any): GraphQLError => {
      logger.error(error)

      // Check if it's an unauthorized exception
      if (error?.extensions?.code === 'UNAUTHORIZED' ||
          error?.message.toLowerCase().includes('unauthorized')) {
        return new GraphQLError('Not authorized', {
          extensions: {
            code: 'UNAUTHORIZED'
          }
        })
      }

      // Handle FORBIDDEN errors
      if (error?.extensions?.code === 'FORBIDDEN') {
        return new GraphQLError('Access denied', {
          extensions: {
            code: 'FORBIDDEN'
          }
        })
      }

      // Handle NOT_FOUND errors
      if (error?.extensions?.code === 'NOT_FOUND') {
        return new GraphQLError('Resource not found', {
          extensions: {
            code: 'NOT_FOUND'
          }
        })
      }

      // Default masking (defense-in-depth): Apollo does NOT mask messages by
      // default, so an unexpected resolver error — a libvirt/virsh failure, an
      // fs ENOENT carrying an absolute host path, a raw Prisma/stderr dump —
      // would otherwise reach the tenant verbatim, leaking host layout and
      // other-tenant identifiers. Genuine client-facing errors (safe codes)
      // keep their message, but run through sanitizeErrorForUser to strip any
      // embedded host paths / stderr; everything else is masked. The full raw
      // error is already logged server-side above.
      const code = error?.extensions?.code
      if (typeof code === 'string' && SAFE_ERROR_CODES.has(code)) {
        return new GraphQLError(sanitizeErrorForUser(error?.message) ?? 'Invalid request', {
          extensions: { code }
        })
      }

      return new GraphQLError('Internal server error', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' }
      })
    }
  })

  return { server, schema }
}
