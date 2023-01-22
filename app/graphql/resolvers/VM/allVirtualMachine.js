import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {isAuth} from "../../middleWare"

const allVMResolver = {
    Query: {
  //////for get All VM/////
  getAllVM: async (_root, input) => {
    try {
      let token = input["input"]["token"];
      let Search = input["input"]["Search"];
      let Status = input["input"]["Status"];
      const foradminID = isAuth(token).id;
      console.log(foradminID);
      if (foradminID) {
        const forVM = await prisma.virtualMachine.findMany({
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
                firstName: true,
              },
            },
          },
        });
        if (Search) {
          const searchToFind = await prisma.virtualMachine.findMany({
            where: {
              virtualMachineName: {
                contains: Search,
                mode: "insensitive",
              },
            },
          });
          console.log(searchToFind);
          return searchToFind;
        }
        if (Status) {
          const forSearchWithStatus = await prisma.virtualMachine.findMany({
            where: {
              Status: {
                equals: Status,
              },
            },
          });
          console.log(forSearchWithStatus);
          return forSearchWithStatus;
        }
        return forVM;
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError(
        "Something went wrong....please enter valid credentials .!!!  ",
        {
          extensions: {
            StatusCode: 401,
            code: "Failed ",
          },
        }
      );
    }
  },
    }
}
export default allVMResolver;