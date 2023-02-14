import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare.js"

const userVirtualMachine = {
  Query: {




//-------------------------------------------------------FOR USER---------------------------------------------///
getUserVM: async (_parent, input) => {
    try {
      let token = input["input"]["token"];
      AuthForBoth(token);
      const forID = AuthForBoth().id;
      if (forID) {
        const forUserVM = await prisma.user.findUnique({
          where: {
            id: forID,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            Email: true,
            userImage: true,
            userType: true,
            Notification: {
              select: {
                id: true,
                Message: true,
              },
            },
            ISO: {
              select: {
                id: true,
                Name: true,
              },
            },
            VM: {
              select: {
                virtualMachineName: true,
                vmImage : true,
              },
            },
            _count: {
              select: {
                VM: true,
                Notification: true,
                ISO: true,
              },
            },
          },
        });
        console.log(forUserVM._count);
        console.log(forUserVM);
        return forUserVM;
      }
    } catch (error) {
      console.log(error);
      throw new GraphQLError("Something went wrong please check again", {
        extensions: {
          StatusCode: 500,
        },
      });
    }
  },
}
}
export default userVirtualMachine