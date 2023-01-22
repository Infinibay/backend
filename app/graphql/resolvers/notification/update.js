import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";

const forUpdateNotification = {
  Mutation: {
    //FOR UPDATE NOTIFICATION
    async updateNotification(root, input) {
      try {
        const forNotificationUpdate = await prisma.notification.updateMany({
          where: {
            userId: input["input"]["userId"],
          },
          data: {
            Readed: input["input"]["Readed"],
          },
        });
        console.log(forNotificationUpdate);
        return "Updated";
      } catch (error) {
        throw new GraphQLError("Failed to Update", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
  },
};
export default forUpdateNotification;
