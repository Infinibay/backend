// External Libraries
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import bodyParser from 'body-parser';
import 'dotenv/config';
import 'reflect-metadata';
import timeout from 'connect-timeout';

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

// Routes
import isoUploadRouter from './routes/isoUpload';

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

  // Add connection debugging
  httpServer.on('connection', (socket) => {
    socket.setTimeout(60 * 60 * 1000); // 1hr timeout
    console.log(`[${new Date().toISOString()}] New connection established - Remote Address: ${socket.remoteAddress}`);
    
    socket.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Socket error from ${socket.remoteAddress}:`, error);
    });

    socket.on('close', (hadError) => {
      console.log(`[${new Date().toISOString()}] Connection closed from ${socket.remoteAddress} ${hadError ? 'due to error' : 'normally'}`);
    });

    socket.on('timeout', () => {
      console.log(`[${new Date().toISOString()}] Connection timeout from ${socket.remoteAddress}`);
      socket.end();
    });
  });

  httpServer.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Server error:`, error);
  });

  httpServer.on('clientError', (error, socket) => {
    console.error(`[${new Date().toISOString()}] Client error:`, error);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });


  // Configure express for large file uploads
  app.use(bodyParser.json({ limit: '100gb' }));
  app.use(bodyParser.urlencoded({ limit: '100gb', extended: true }));
  
  // Add global timeout middleware
  app.use(timeout(60 * 60 * 1000)); // 1hr. Is in miliseconds
  
  // Add global error handler for timeouts
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.name === 'TimeoutError') {
      res.status(408).json({ error: 'Request timeout' });
    } else {
      next(err);
    }
  });

  // Configure CORS with proper timeout
  app.use(cors<cors.CorsRequest>({
    maxAge: 3600, // 1 hour
    exposedHeaders: ['Content-Length', 'Content-Range'],
  }));

  // Add health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Mount the ISO upload router
  app.use('/isoUpload', isoUploadRouter);

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
