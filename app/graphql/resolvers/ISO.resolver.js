const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
const jwt = require("jsonwebtoken");
const { GraphQLError } = require("graphql");

const config = process.env;
const IOS_resolvers = {
  Query: {
    //-----------------------------------FOR IOS------------------------------------------------------------//
    //for get all IOS (admin )
    getAllIOS: async (root, input) => {
      try {
        const { token, Search } = input.input;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const { id: decoded_id, userType: User_Type } = decoded;

        if (decoded_id && User_Type === 'admin') {
          const queryOptions = {
            select: {
              Name: true,
              Type: true,
              createdAt: true,
              userId: true,
            },
          };

          if (Search) {
            queryOptions.where = {
              Name: {
                contains: Search,
                mode: 'insensitive',
              },
            };
          }

          const IOS = await prisma.IOS.findMany(queryOptions);
          return IOS;
        } else {
          throw new GraphQLError('Unauthorized access. Only admin users can access this resource.', {
            extensions: {
              StatusCode: 401,
              code: 'Failed ',
            },
          });
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 401,
            code: 'Failed ',
          },
        });
      }
    },
    //FOR GET IOS BY ID (users)
    getIOSById: async (parent, { input }) => {
      const { token, search } = input;
      try {
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const userId = decoded.id;

        if (!userId) {
          throw new Error("Login again");
        }

        const IOSProperties = {
          id: true,
          userId: true,
          Name: true,
          Type: true,
          createdAt: true,
        };

        let result;

        if (search) {
          result = await prisma.iOS.findMany({
            where: {
              userId,
              Name: {
                contains: search,
                mode: "insensitive",
              },
            },
          });
        } else {
          result = await prisma.IOS.findMany({ where: { userId }, select: IOSProperties });
        }

        return result;
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Please enter valid credentials", {
          extensions: {
            StatusCode: 401,
            code: "Failed ",
          },
        });
      }
    },
  },
  Mutation: {
    // Create IOS
    async createIOS(parent, { input }) {
      try {
        const { Name, Type, userId, createdAt, Size } = input;
        const ios = await prisma.iOS.create({
          data: {
            Name,
            Type,
            userId,
            createdAt,
            Size,
          },
        });
        return ios;
      } catch (error) {
        throw new GraphQLError("Failed to create IOS", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },

    //FOR DELETE IOS
    async deleteIOS(root, input) {
      try {
        await prisma.IOS.delete({
          where: {
            id: input.input.id,
          },
        });
        return "IOS Deleted";
      } catch (error) {
        throw new GraphQLError("Failed to delete IOS", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
  },
};
module.exports = IOS_resolvers;
