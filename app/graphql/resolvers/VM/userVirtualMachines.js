
import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {isAuthForUser} from "../../middleWare.js"

const allUserVMResolver = {
    Query: {
////GET USER ALL VM
getUserAllVM: async (_parent, input) => {
    try {
      let token = input["input"]["token"];
      let Status = input["input"]["Status"];
      isAuthForUser(token);
      const forUserId = isAuthForUser().id;
      if (forUserId) {
        const forUserVM = await prisma.virtualMachine.findMany({
          where: {
            userId: forUserId,
          },
          select: {
            virtualMachineName: true,
            vmImage : true,
            Title: true,
            Status: true,
            guId : true,
            Config: true,
            Description: true,
            id: true,
            user: {
              select: {
                id: true,
              },
            },
          },
        });
        if (Status) {
          const forSearchWithStatus = await prisma.virtualMachine.findMany({
            where: {
              userId: forUserId,
              Status: {
                equals: Status,
              },
            },
          });
          console.log(forSearchWithStatus);
          return forSearchWithStatus;
        }

        console.log(forUserVM);
        return forUserVM;
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError(
        "Something went wrong....please enter valid credentials .!!!  ",
        {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        }
      );
    }
  },
}
}
export default allUserVMResolver;