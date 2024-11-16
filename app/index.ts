// External Libraries
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import bodyParser from 'body-parser';
import 'dotenv/config';
import 'reflect-metadata';

// Apollo Server Related Imports
import { ApolloServer } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { expressMiddleware } from '@apollo/server/express4';

// Prisma Client and Utils
import { PrismaClient } from '@prisma/client';
import { buildSchema } from 'type-graphql';
import { authChecker } from './utils/authChecker';
import { InfinibayContext } from './utils/context';
import resolvers from './graphql/resolvers';

// Crons
import { startCrons } from './crons/all';

const prisma = new PrismaClient(); // Create a new instance of PrismaClient

// Check: https://github.com/MichalLytek/type-graphql/blob/c5a03745dc951785b73a0afa4e85cd041adfa279/examples/redis-subscriptions/index.ts
async function bootstrap(): Promise<void> {
  // Build TypeGraphQL executable schema
  const schema = await buildSchema({
    resolvers,
    emitSchemaFile: path.resolve(__dirname, 'schema.graphql'),
    authChecker,
  });

  const app = express();
  const httpServer = http.createServer(app);

  // Add health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  const server = new ApolloServer<InfinibayContext>({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    plugins: [],
    formatError: (error: any): GraphQLError => {
      console.error(error);

      // Check if it's an unauthorized exception
      if (error?.extensions?.code == 'UNAUTHORIZED' ||
        error?.message.toLowerCase().includes('unauthorized')) {
        return new GraphQLError('Unauthorized: You do not have permission to perform this action');
      }

      // For all other errors, return a generic message
      return new GraphQLError('Internal server error');
    },
  });

  // Start server
  await server.start();
  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    bodyParser.json(),
    expressMiddleware(server, {
      context: async ({ req, res }): Promise<InfinibayContext> => {
        return { req, res, prisma, user: null } as InfinibayContext; // Add prisma to the context
      },
    })
  );

  // Create a thread and start all crons
  startCrons();

  // Now that the HTTP server is fully set up, we can listen to it
  httpServer.listen(4000, '0.0.0.0', () => {
    console.log('GraphQL server ready at http://0.0.0.0:4000/graphql');
    console.log('Health check endpoint available at http://0.0.0.0:4000/health');
  });
}

void bootstrap().catch(console.error);
