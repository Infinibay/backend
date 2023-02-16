import {AuthForBoth} from "../../middleWare.js"
import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import { createCall } from "../Virtualization/index.js";

//// For Delete Virtual Machine //////////////

const deleteVMResolvers = {
  Mutation: {
    async deleteVM(_root, input) {
      try {
        let token = input["input"]["token"];
        const forID = AuthForBoth(token);
        const foruserType = forID.userType;
        // Auth()
        if (foruserType) {
          if (foruserType == "admin") {
            const id = input["input"]["id"];
            console.log(id.length);
            const forDeleteVM = await prisma.virtualMachine.findMany({
              where: {
                id: { in: id },
              },
              select: {
                id: true,
                virtualMachineName: true,
                user: {
                  select: {
                    id: true,
                    Email: true,
                  },
                },
                Notification: {
                  select: {
                    id: true,
                  },
                },
              },
            });
            console.log(forDeleteVM);

            console.log(forDeleteVM.length);
            for (var i = forDeleteVM.length; i >= 0; i++) {
              console.log({ in: id });
              console.log(i);
              if (forDeleteVM) {
                let result = await createCall("deleteCall",{ "name": forDeleteVM[i].virtualMachineName})
                if(result.data["result"]["status"]){
                  const forNot = await prisma.notification.deleteMany({
                    where: {
                      vmId: { in: id },
                    },
                  });
                  console.log(forNot);
                  const deleteVMId = await prisma.virtualMachine.deleteMany({
                    where: {
                      id: { in: id },
                    },
                  });
                  console.log(deleteVMId);
                  if (deleteVMId) {
                    console.log("del");
                  }
                  return "VM_Deleted";
                }
                else{
                  throw new GraphQLError('Failed to Delete', {
                    extensions: {
                      StatusCode: 404,
                      code: 'Failed '
                    }
                  }) 
                }
              } else {
                throw new Error("error");
              }
            }
          }
          if (forID.userType == "user" && forID.id) {
            console.log(forID.id);
            const id = input["input"]["id"];
            console.log(id.length);
            const forDeleteVM = await prisma.virtualMachine.findMany({
              where: {
                id: { in: id },
                userId: forID.id,
              },
              select: {
                id: true,
                userId: true,
                virtualMachineName: true,
               
                user: {
                  select: {
                    id: true,
                    Email: true,
                  },
                },
                Notification: {
                  select: {
                    id: true,
                  },
                },
              },
            });
            console.log(forDeleteVM);
            console.log(forDeleteVM.length);
            for (let j = forDeleteVM.length; j >= 0; j++) {
              console.log({ in: id });
              console.log(j);
              if (forDeleteVM) {
                let result = await createCall("deleteCall",{ "name": forDeleteVM[i].virtualMachineName})
                if(result.data["result"]["status"]){
                const forNot = await prisma.notification.deleteMany({
                  where: {
                    vmId: { in: id },
                    userId: forID.id,
                  },
                });
                console.log(forNot.userId);
                const deleteVMId = await prisma.virtualMachine.deleteMany({
                  where: {
                    id: { in: id },
                    userId: forID.id,
                  },
                });
                console.log(deleteVMId.userId);
                return "VM_Deleted";
              }
              else{
                throw new GraphQLError('Failed to Delete', {
                  extensions: {
                    StatusCode: 404,
                    code: 'Failed '
                  }
                }) 
              }
              } else {
                throw new Error("error");
              }
            }
          }
        }
      } catch (error) {
        throw new GraphQLError("Failed to Delete", {
          extensions: {
            StatusCode: 404,
            code: "Failed ",
          },
        });
      }
    },
  },
};

export default deleteVMResolvers;
