import express from 'express'
import { ApolloServer } from 'apollo-server'
import logger from './logger.js'
import dotenv from 'dotenv'

import typeDefs from './app/graphql/typeDefs/index.js'
import resolvers from './app/graphql/resolvers/index.js'
dotenv.config()

const server = express()

server.use(express.static('app'))
server.listen(3000, () => {
  logger.info('🚀 GRAPHQL Server is running at http://localhost:3000')
})

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req, res }) => ({ req, res }),
  disable: 'x-Powered-by'
})

apolloServer.listen(process.env.PORT, () => {
  logger.info(`🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`)
})
