import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare"


const forUserNotification = {
    Mutation :{
getUserNotification: async (root, input) => {
    try {
      let token = input["input"]["token"];
      const forid = AuthForBoth(token).id;
      if (forid) {
        const userNotification = await prisma.notification.findMany({
          where: {
            userId: forid,
          },
        });
        console.log(userNotification);
        return userNotification;
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError("Please enter valid credentials ", {
        extensions: {
          StatusCode: 401,
          code: "Failed ",
        },
      });
    }
  },
},
}
export default forUserNotification