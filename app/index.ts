import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { expressMiddleware } from "@apollo/server/express4";
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import "reflect-metadata";
import { buildSchema } from "type-graphql";
import { PrismaClient } from "@prisma/client";

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
    ]
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
  httpServer.listen(4000, () => {
    console.log(`GraphQL server ready at http://localhost:4000/graphql`);
  });
}

bootstrap().catch(console.error);
