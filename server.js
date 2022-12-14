const express_apollo = require("apollo-server-express");
const { ApolloServer } = require("apollo-server");
require("dotenv").config();
const bodyParser = require("body-parser");
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
PORT = 9090;
var express = require("express");
var server = express();
const typeDefs = require("./app/graphql/typeDefs/schema");
const resolvers = require("./app/graphql/resolvers/index");
const verifyToken = require("./app/graphql/validators/auth");

//http://localhost:3000/VM_image/1669615906192.jpeg
server.use(express.static("app"));
server.listen(3000, () => {
  console.log(`🚀 GRAPHQL Server is running at http://localhost:3000`);
});

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  // context: ({ req }) => {
  //   // get the user token from the headers
  //   const token = req.headers.authorization || '';

  //   // try to retrieve a user with the token
  //   const user = verifyToken(token);

  //   // add the user to the context
  //   return { user };
  // },

  disable: "x-Powered-by",
});
// apolloServer.applyMiddleware({ app   });

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// apolloServer.applyMiddleware({ app, path: "/graphql" })
apolloServer.listen(process.env.PORT, () => {
  console.log(
    `🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`
  );
});
