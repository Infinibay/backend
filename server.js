import express from "express"
import {ApolloServer} from "apollo-server"
import dotenv from 'dotenv'
dotenv.config()
const PORT = 9090 
var server = express()


import typeDefs from "./app/graphql/typeDefs/index.js"
import resolvers from "./app/graphql/resolvers/index.js"

server.use(express.static('app'))
server.listen(3000, () => {
  console.log(`🚀 GRAPHQL Server is running at http://localhost:3000`)
})

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req, res }) => ({ req, res }),
  disable: 'x-Powered-by'
})
// console.log(process.env)
apolloServer.listen(process.env.PORT, () => {
  console.log(
    `🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`
  )
})
