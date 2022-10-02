import "reflect-metadata";
import cors from "cors";
import express, { Express } from "express";
import { ApolloServer, CorsOptions } from "apollo-server-express";
// import { buildSchema } from "type-graphql";
import { PrismaClient } from '@prisma/client'


import { typeDefs } from "./graphql/TypeDefs";
import { resolvers } from "./graphql/Resolvers";
import { verifyToken } from './utils/functions';

const prisma = new PrismaClient()

const main = async () => {
  const envName = process.env.NODE_ENV || "development";
  const prisma = new PrismaClient()
  const corsOptions = {
    origin: "*",
    credentials: true,
  } as CorsOptions;

  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    csrfPrevention: true,
    context: async ({ req }) => {
      
      if (!req.headers.authorization) {
        return {
          prisma,
        };
      }
      
      // get user from jwt token
      let token: string = req.headers.authorization || '';
      token = token.replace('Bearer ', '');
      // return if no token
      const jwtToken = verifyToken(token);
      console.log('jwtToken', jwtToken);
      const userId = jwtToken?.userId;
      if (!userId) {
        return {
          prisma
        };
      }
      const user = await prisma.user.findFirst({
        where: {
          id: userId
        }
      }); 
      console.log('user', user);
      return {
        user,
        prisma
      };
    }
  });
  await apolloServer.start();
  const app: Express = express();
  apolloServer.applyMiddleware({ app, 
    path: "/graphql",
    cors: corsOptions,
  });
  app.use(cors(corsOptions));
  

  app.get("/", (req, res) => {
    res.send("Hello World!");
  });

  const port = Number(process.env.PORT) || 3000;
  const hostname = '0.0.0.0'

  app.listen(port, hostname, () => {
    console.log(`Listening port ${hostname}:${port}`);
  });
}

main()
  .then(async() => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });