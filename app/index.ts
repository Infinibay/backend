import express, { Express } from 'express';
import { ApolloServer } from 'apollo-server';
import logger from './logger';
import dotenv from 'dotenv';
import cors from 'cors'

import typeDefs from './graphql/typeDefs';
import resolvers from './graphql/resolvers';
dotenv.config();

const server: Express = express();

server.use(express.static('app'));
server.disable('x-powered-by'); 
server.use(cors());
server.listen(3000, () => {
  logger.info('🚀 GRAPHQL Server is running at http://localhost:3000');
});

const apolloServer: ApolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req, res }) => ({ req, res })
});

apolloServer.listen(process.env.PORT, () => {
  logger.info(`🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`);
});
