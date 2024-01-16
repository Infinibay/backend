// External Libraries
import express from "express";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import bodyParser from "body-parser";
import "dotenv/config";
import "reflect-metadata";

// Apollo Server Related Imports
// @ts-ignore
import { ApolloServer, ApolloError, ApolloServerPluginLandingPageLocalDefault } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";

// Prisma Client and Utils
import { PrismaClient } from "@prisma/client";
import { buildSchema } from "type-graphql";
import { authChecker } from './utils/authChecker';
import { InfinibayContext } from './utils/context';
import resolvers from './graphql/resolvers';


const prisma = new PrismaClient(); // Create a new instance of PrismaClient

// Check: https://github.com/MichalLytek/type-graphql/blob/c5a03745dc951785b73a0afa4e85cd041adfa279/examples/redis-subscriptions/index.ts
async function bootstrap() {
  // Build TypeGraphQL executable schema
  const schema = await buildSchema({
    // Array of resolvers
    resolvers: resolvers,
    // Create 'schema.graphql' file with schema definition in current directory
    emitSchemaFile: path.resolve(__dirname, "schema.graphql"),
    authChecker: authChecker,
  });

  const app = express();
  const httpServer = http.createServer(app);

  const server = new ApolloServer<InfinibayContext>({
    schema,
    csrfPrevention: true,
    cache: "bounded",
    plugins: [
      ApolloServerPluginLandingPageLocalDefault({ embed: true }),
    ],
    formatError: (error) => {
      console.error(error); // Log the error
      // Return a generic error message to the client
      return new ApolloError('Internal server error');
    },
  });

  // Start server
  await server.start();
  app.use("/graphql", cors<cors.CorsRequest>(), bodyParser.json(), expressMiddleware(server, {
    context: async ({ req, res }): Promise<InfinibayContext> => {
      return { req, res, prisma, user: null } as InfinibayContext; // Add prisma to the context
    },
  }),
  );

  // Now that the HTTP server is fully set up, we can listen to it
  httpServer.listen(4000, '0.0.0.0', () => {
    console.log(`GraphQL server ready at http://0.0.0.0:4000/graphql`);
  });
}

bootstrap().catch(console.error);
