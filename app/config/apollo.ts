import { ApolloServer } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { buildSchema } from 'type-graphql';
import path from 'node:path';
import { InfinibayContext } from '../utils/context';
import { authChecker } from '../utils/authChecker';
import resolvers from '../graphql/resolvers';

export const createApolloServer = async (): Promise<ApolloServer> => {
  // Build TypeGraphQL executable schema
  const schema = await buildSchema({
    resolvers,
    emitSchemaFile: path.resolve(__dirname, '../schema.graphql'),
    authChecker,
  });

  return new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    plugins: [],
    formatError: (error: any): GraphQLError => {
      console.error(error);

      // Check if it's an unauthorized exception
      if (error?.extensions?.code === 'UNAUTHORIZED' ||
          error?.message.toLowerCase().includes('unauthorized')) {
        return new GraphQLError('Not authorized', {
          extensions: {
            code: 'UNAUTHORIZED',
          },
        });
      }

      return error;
    },
  });
};
