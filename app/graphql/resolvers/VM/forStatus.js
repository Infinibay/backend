import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare.js"
import { createCall } from "../Virtualization/index.js";

const forStatusVMResolvers = {
Mutation: {
    async forStatus(_root, input) {
        try {
          let token = input["input"]["token"];
          AuthForBoth(token);
          const forID = AuthForBoth().id;
          const forUserType = AuthForBoth().userType
          if (forID) {
            const id = input["input"]["id"];
            const button = input["input"]["button"];
            const forFindStatusID = await prisma.virtualMachine.findUnique({
              where: {
                id: id,
              },
            });
            if (forFindStatusID.userId == forID || forUserType == 'admin') {
              if (button == true) {
                let result = await createCall("startVMCall",{"name": forFindStatusID.VirtualMachine_Name})
                if(result == "")
                prisma.virtualMachine.update({
                  where: {
                    id: forFindStatusID.id,
                  },
                  data: {
                    Status: true,
                  },
                }).then(()=>{
                  console.log("changeStatus");
                  return "Status Updated";
                })
              }
              if (button == false) {
                let result = await createCall("shutdownCall",{"name": forFindStatusID.VirtualMachine_Name})
                const offStatus = await prisma.virtualMachine.update({
                  where: {
                    id: forFindStatusID.id,
                  },
                  data: {
                    Status: false,
                  },
                });
                console.log(offStatus);
                return "Status Updated";
              }
            } else {
              throw new Error("Invalid Token");
            }
          }
        } catch (error) {
          console.log(error);
          throw new GraphQLError("Failed to Update", {
            extensions: {
              StatusCode: 404,
              code: "Failed ",
            },
          });
        }
      },
    }
}
export default forStatusVMResolvers