import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";

   const fordeleteNotification = {
 Mutation :{
   
   //FOR DELETE NOTIFICATION
    async deleteNotification(_root, input) {
        try {
          const forDeleteNotification = await prisma.notification.delete({
            where: {
              id: input["input"]["id"],
            },
          });
          console.log(forDeleteNotification);
          return "Deleted";
        } catch (error) {
          console.log(error);
          throw new GraphQLError("Failed to Delete", {
            extensions: {
              StatusCode: 404,
              code: "Failed ",
            },
          });
        }
      },
    }
}
export default fordeleteNotification