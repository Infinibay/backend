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
        token = input["input"]["token"];
        console.log(token);
        Search = input["input"]["Search"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;

        const decoded_id = input.userId.id;
        console.log(decoded.userType);
        console.log(decoded_id);
        if (decoded_id && decoded.User_Type == "admin") {
          const for_find_IOS = await prisma.IOS.findMany({
            select: {
              Name: true,
              Type: true,
              createdAt: true,
              userId: true,
            },
          });
          console.log(for_find_IOS);
          if (Search) {
            const search_to_find = await prisma.IOS.findMany({
              where: {
                Name: {
                  contains: Search,
                  mode: "insensitive",
                },
              },
            });
            console.log(search_to_find);
            return search_to_find;
          }
          console.log(for_find_IOS);
          return for_find_IOS;
        }
      } catch (error) {
        console.log(error);
        //  return error;
        throw new GraphQLError("Please enter valid credentials", {
          extensions: {
            StatusCode: 401,
            code: "Failed ",
          },
        });
      }
    },
    //FOR GET IOS BY ID (users)
    getIOSById: async (parent, input) => {
      try {
        token = input["input"]["token"];
        search = input["input"]["search"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        console.log(decoded_id);
        if (decoded_id) {
          const get_IOS = await prisma.IOS.findMany({
            where: {
              userId: decoded_id,
            },
            select: {
              id: true,
              userId: true,
              Name: true,
              Type: true,
              createdAt: true,
            },
          });
          if (search) {
            const for_find = await prisma.iOS.findMany({
              where: {
                userId: decoded_id,
                Name: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            });
            console.log(for_find);
            return for_find;
          }

          console.log(get_IOS);
          return get_IOS;
        } else {
          throw new Error("login again");
        }
      } catch (error) {
        console.log(error);
        // return error;
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
    //-------------------------------------------------IOS----------------------------------------------------//
    // fOR Create IOS

    async createIOS(root, input) {
      try {
        const for_create_IOS = await prisma.IOS.create({
          data: {
            Name: input["input"]["Name"],
            Type: input["input"]["Type"],
            userId: input["input"]["userId"],
            createdAt: input["input"]["createdAt"],
            Size: input["input"]["Size"],
          },
        });
        return for_create_IOS;
      } catch (error) {
        console.log(error);
        // return error;
        throw new GraphQLError("Failed to Create", {
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
        const for_delete_IOS = await prisma.IOS.delete({
          where: {
            id: input["input"]["id"],
          },
        });
        console.log(for_delete_IOS);
        return "IOS Deleted";
      } catch (error) {
        console.log(error);
        //        return error;
        throw new GraphQLError("failed to delete", {
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
