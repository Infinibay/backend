const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

const jwt = require("jsonwebtoken");
const { GraphQLError } = require("graphql");
const config = process.env;
const notification_resolver = {
  Query: {
    ////------------------------------------FOR NOTIFICATION------------------------------------------------------////
    // GET  notification
    getNotification: async () => {
      try {
        const for_get_notification = await prisma.notification.findMany({});
        return for_get_notification;
      } catch (error) {
        //  return error;

        throw new GraphQLError("failed to get all notifications ", {
          extensions: {
            StatusCode: 500,
            code: "Failed ",
          },
        });
      }
    },

    getUserNotification: async (root, input) => {
      try {
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        if (decoded_id) {
          const user_notification = await prisma.notification.findMany({
            where: {
              userId: decoded_id,
            },
          });
          console.log(user_notification);
          return user_notification;
        }
      } catch (error) {
        console.log(error);
        //  return error;
        throw new GraphQLError("Please enter valid credentials ", {
          extensions: {
            StatusCode: 401,
            code: "Failed ",
          },
        });
      }
    },
  },

  Mutation: {
    //----------------------------------------------- NOTIFICATION-----------------------------------------------------//

    // FOR ADD NOTIFICATION
    async addNotification(root, input) {
      try {
        const for_notification = await prisma.notification.create({
          data: {
            Message: input["input"]["Message"],
            userId: input["input"]["userId"],
            vm_id: input["input"]["vmId"],
            Readed: input["input"]["Readed"],
          },
        });
        console.log(for_notification);
        return for_notification;
      } catch (error) {
        console.log(error);
        //  return error;
        throw new GraphQLError("Failed to Create", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
    //FOR UPDATE NOTIFICATION
    async updateNotification(root, input) {
      try {
        const for_notification_update = await prisma.notification.updateMany({
          where: {
            userId: input["input"]["userId"],
          },
          data: {
            Readed: input["input"]["Readed"],
          },
        });

        console.log(for_notification_update);
        return "Updated";
      } catch (error) {
        //
        throw new GraphQLError("Failed to Update", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
    //FOR DELETE NOTIFICATION
    async deleteNotification(root, input) {
      try {
        const for_delete_notification = await prisma.notification.delete({
          where: {
            id: input["input"]["id"],
          },
        });
        return "Deleted";
      } catch (error) {
        console.log(error);
        //return error;

        throw new GraphQLError("Failed to Delete", {
          extensions: {
            StatusCode: 404,
            code: "Failed ",
          },
        });
      }
    },
  },
};

module.exports = notification_resolver;
