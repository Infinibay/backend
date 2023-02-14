import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare.js"
import fs from "fs"
const updateVMResolvers = {
  Mutation: {
    //////for Update VM/////
    async upadteVM(_root, input) {
      try {
        // for image
        const path = "app/VMImage/" + Date.now() + ".jpeg";
        // if (vmImage  = input['input']['vmImage']) {
        //   const path = 'app/vmImage /' + Date.now() + '.jpeg'
        const vmImage = input["input"]["vmImage"];
        if (vmImage) {
          var base64Data = await vmImage.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ""
          );
          fs.writeFileSync(path, base64Data, { encoding: "base64" });
          console.log(path);
        }
        //for token
        let token = input["input"]["token"];
        // Auth()
        // isAuthForBoth();
        const forID = AuthForBoth(token).id;
        if (forID) {
          const id = input["input"]["id"];
          const forUpdatingVM = await prisma.virtualMachine.findUnique({
            where: {
              id: id,
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
            },
          });

          if (forUpdatingVM.user.id == forID) {
            if (vmImage) {
              const forUpdate = await prisma.virtualMachine.update({
                where: {
                  id: input["input"]["id"],
                },
                data: {
                  virtualMachineName: input["input"]["virtualMachineName"],
                  Title: input["input"]["Title"],
                  Description: input["input"]["Description"],
                  Status: input["input"]["Status"],
                  userId: input["input"]["userId"],
                  Config: input["input"]["Config"],
                  vmImage: path,
                },
                select: {
                  id: true,
                  virtualMachineName: true,
                  Description: true,
                  Status: true,
                  Config: true,
                  Title: true,
                  vmImage: true,
                },
              });
              console.log("forUpdate");
              return forUpdate;
            } else {
              const forUpdatewithoutimage = await prisma.virtualMachine.update({
                where: {
                  id: input["input"]["id"],
                },
                data: {
                  virtualMachineName: input["input"]["virtualMachineName"],
                  Title: input["input"]["Title"],
                  Description: input["input"]["Description"],
                  Status: input["input"]["Status"],
                  userId: input["input"]["userId"],
                  Config: input["input"]["Config"],

                  // vmImage : path
                },
                select: {
                  id: true,
                  virtualMachineName: true,
                  Description: true,
                  Status: true,
                  Config: true,
                  Title: true,
                  vmImage: true,
                },
              });
              console.log("forUpdatewithoutimage");
              return forUpdatewithoutimage;
            }
          } else {
            throw new Error("Error");
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
  },
};
export default updateVMResolvers;
