import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";



const createNotification= {
Mutation: {
    //----------------------------------------------- NOTIFICATION-----------------------------------------------------//
    // FOR ADD NOTIFICATION
    async addNotification(root, input) {
      try {
        const forNotification = await prisma.notification.create({
          data: {
            Message: input["input"]["Message"],
            userId: input["input"]["userId"],
             vmId: input["input"]["vmId"],
            Readed: input["input"]["Readed"],
          },
        });
        console.log(forNotification);
        return forNotification;
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Failed to Create", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },
}
}

export default createNotification