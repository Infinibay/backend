import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";


const allNotification = {
  Query: {
    ////------------------------------------FOR NOTIFICATION------------------------------------------------------////
    // GET  notification
    getNotification: async () => {
      try {
        const forGetNotification = await prisma.notification.findMany({});
        return forGetNotification;
      } catch (error) {
        console.log(error);
        throw new GraphQLError("failed to get all notifications ", {
          extensions: {
            StatusCode: 500,
            code: "Failed ",
          },
        });
      }
    },
}
}
export default allNotification;