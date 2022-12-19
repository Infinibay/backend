const express_apollo = require("apollo-server-express");
const { ApolloServer } = require("apollo-server");
require("dotenv").config();
const bodyParser = require("body-parser");
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
PORT = 9090;
var express = require("express");
var server = express();

const typeDefs = require("./app/graphql/typeDefs/index.typedefs");
const resolvers = require("./app/graphql/resolvers/index.resolvers");
const verifyToken = require("./app/graphql/validators/auth");

//http://localhost:3000/VM_image/1669615906192.jpeg
server.use(express.static("app"));
server.listen(3000, () => {
  console.log(`🚀 GRAPHQL Server is running at http://localhost:3000`);
});

const getErrorCode = require("./app/Utils/error.message");

// server.use('/graphql', (req, res) => {
const formessage = (req, res) => {
  graphqlHTTP({
    schema: schema,
    graphiql: process.env.NODE_ENV === "development",
    context: { req },
    formatError: (err) => {
      console.log(err.message);
      const error = getErrorCode("UNAUTHORIZED");
      console.log(error.statusCode);
      return { message: error.message, statusCode: error.statusCode };
    },
  })(req, res);
};

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  formessage,

  disable: "x-Powered-by",
});

apolloServer.listen(process.env.PORT, () => {
  console.log(
    `🚀 GRAPHQL Server is running at http://localhost:${process.env.PORT}`
  );
});
