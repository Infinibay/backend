// const express_apollo = require('@apollo/server/express4')
// const {ApolloServer} = require('apollo-server')
// require('dotenv').config()
// const bodyParser = require('body-parser')
// const { PrismaClient, Prisma } = require('@prisma/client')
// //const startStandaloneServer= require('@apollo/server/standalone');
// const { startStandaloneServer } = require('@apollo/server/standalone');
// const prisma = new PrismaClient()
// PORT = 9090
// var express = require('express')
// var server = express()
// const typeDefs = require('./app/graphql/typeDefs/index.typedefs')
// const resolvers = require('./app/graphql/resolvers/index.resolvers');
// const {verifyToken }= require('./app/Utils/helperfunction')
// server.use(express.static('app'))
// server.listen(3000, () => {
//   console.log(`🚀 GRAPHQL Server is running at http://localhost:3000`)
// })

// const jwt = require('jsonwebtoken');
// // get the user info from a JWT
// const getUser = (token)=>{
//     if (token) {
//         try {
//             // return the user information from the token
//             return jwt.verify(token, process.env.JWT_SECRET);
//         } catch (err) {
//             // if there's a problem with the token, throw an error
//             throw new Error('Session invalid');
//         }
//     }


    
// };


// const apolloServer = new ApolloServer({
//   typeDefs,
//   resolvers,
  
//  // debug : false,
// //  context: ({req}) => {
// //   const token = req.headers.authorization;
// //  // console.log(token);
// //   const user = getUser(token);
// //   console.log(user.token);
// //   return { models, user };

// // },
// //     // return {
// //     //   ...req,
// //     //   prisma,
// //     //   userId:
// //     //     req && req.headers.authorization
      
// //     //       ? getUserId(req)
// //     //       : null
// //     // }
// //   },
//   disable: 'x-Powered-by'
// });
// // const { url } =  startStandaloneServer(apolloServer, {
// //   context: async ({ req }) => {
// //     const token = req.headers.authorization || '';
// //     const user = getUser(token);
// //     if (!user)
// //       throw new Error('User is not authenticated', {
// //         extensions: {
// //           code: 'UNAUTHENTICATED',
// //           http: { status: 401 },
// //         },
// //       });
// //     return { user };
// //   },
// //   listen: { port: 9090 },
  
 
// // });
// // console.log(`🚀  Server ready at ${url}`);
// // console.log(url);
// // server.use(verifyToken);
// apolloServer.listen(process.env.PORT,  () => {
//   //console.log(`🚀 Server listening at: ${url}`);
//   console.log(
//     `🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`
//   )
// })



const express_apollo = require('apollo-server-express')
const { ApolloServer } = require('apollo-server')
require('dotenv').config()
const bodyParser = require('body-parser')
const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()
PORT = 9090
var express = require('express')
var server = express()
const typeDefs = require('./app/graphql/typeDefs/index.typedefs')
const resolvers = require('./app/graphql/resolvers/index.resolvers')
server.use(express.static('app'))
server.listen(3000, () => {
  console.log(`🚀 GRAPHQL Server is running at http://localhost:3000`)
})
const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  disable: 'x-Powered-by'
})
apolloServer.listen(process.env.PORT, () => {
  console.log(
    `🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`
  )
})
