// Apollo Server 4 — GraphQL Server
// Official Docs: https://www.apollographql.com/docs/apollo-server/
// Repository: https://github.com/apollographql/apollo-server
import logger from '@main/logger'
import { ApolloServer } from '@apollo/server'
import { GraphQLError, GraphQLSchema } from 'graphql'
import { buildSchema } from 'type-graphql'
import path from 'node:path'
import { InfinibayContext } from '@main/utils/context'
import { authChecker } from '@main/utils/authChecker'
import resolvers from '@main/graphql/resolvers'
import { pubsub } from '@main/utils/pubsub'

export interface ApolloServerBundle {
  server: ApolloServer
  schema: GraphQLSchema
}

export const createApolloServer = async (): Promise<ApolloServerBundle> => {
  const schema = await buildSchema({
    resolvers,
    emitSchemaFile: path.resolve(__dirname, '../schema.graphql'),
    authChecker,
    pubSub: pubsub
  })

  const server = new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    plugins: [],
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

      return error
    }
  })

  return { server, schema }
}
