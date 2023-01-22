import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {isAuthForUser} from "../../middleWare" 

const specificVirtualMachine = {
    Query: {


getSpecificVM: async (_parent, input) => {
    try {
      let token = input["input"]["token"];
      isAuthForUser(token);
      const forid = isAuthForUser().id;
      if (forid) {
        console.log(forid);
        const forSpecificVM = await prisma.virtualMachine.findUnique({
          where: {
            id: input["input"]["id"],
          },
          select: {
            id: true,
            userId: true,
            virtualMachineName: true,
            Description: true,
            Title: true,
            Status: true,
            Config: true,
            vmImage : true,
            guId : true,
            user: {
              select: {
                id: true,
                Email: true,
              },
            },
          },
        });
        if (forSpecificVM.user.id == forid) {
          console.log(forSpecificVM);
          return forSpecificVM;
        } else {
          throw new Error("VM Not Found");
        }
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError(
        "Something went wrong....please try again.!!!  ",
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

export default specificVirtualMachine;