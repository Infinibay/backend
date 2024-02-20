import express from 'express';
import { ApolloServer } from '@apollo/server';
import { ApolloError } from '@apollo/server';
import { PrismaClient } from '@prisma/client';
import { authChecker } from './utils/authChecker';
import resolvers from './graphql/resolvers';
import { buildSchema } from 'type-graphql';
import path from 'path';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import { InfinibayContext } from './utils/context';
import { expressMiddleware } from "@apollo/server/express4";

class InfinibayApp {

  public app: express.Application;
  public server: ApolloServer<InfinibayContext> | null = null;
  public prisma: PrismaClient;
  public setupMode: boolean = false;

  constructor() {
    this.app = express();
    this.prisma = new PrismaClient();
  }

  private async createApolloServer(): Promise<ApolloServer<InfinibayContext>> {
    // Check Prisma DB Connection
    let requireSetupPromise = this.requireSetup();

    const schema = await buildSchema({
      resolvers: resolvers,
      emitSchemaFile: path.resolve(__dirname, "schema.graphql"),
      authChecker: authChecker,
    });

    const server = new ApolloServer<InfinibayContext>({
      schema,
      csrfPrevention: true,
      cache: "bounded",
      plugins: [
      ],
      formatError: (error: any) => {
        console.error(error); // Log the error
        // Return a generic error message to the client
        return new ApolloError('Internal server error');
      },
    });

    this.setupMode = await requireSetupPromise;

    this.app.use("/graphql", cors<cors.CorsRequest>(), bodyParser.json(), expressMiddleware(server, {
        context: async ({ req, res }): Promise<InfinibayContext> => {
          return { req, res, prisma: this.prisma, user: null, setupMode: this.setupMode } as InfinibayContext; // Add prisma to the context
        },
      })
    )

    return server;
  }

  private async requireSetup(): Promise<boolean> {
    try {
      await this.prisma.$connect();
      await this.prisma.$disconnect();
      return false;
    } catch (error) {
      return true
    }
  }

  public async bootstrap() {
    // http server setup
    this.server = await this.createApolloServer();

    await this.server.start();

    return this.app;
  }
}

export default InfinibayApp;

