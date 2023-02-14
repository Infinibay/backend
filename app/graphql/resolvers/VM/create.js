
import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare.js"
import fs from "fs"
const createVMResolvers = {
Mutation: {
    //----------------------------------------------- VIRTUAL MACHINE-----------------------------------------------//
    //////for Create VM/////
    async createVM(_root, input) {
      try {
        //for Image
        const path = "app/VMImage/" + Date.now() + ".jpeg";
        const vmImage  = input["input"]["vmImage"];
        if (vmImage ) {
          var base64Data = await vmImage .replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ""
          );
          fs.writeFileSync(path, base64Data, { encoding: "base64" });
          console.log(path);
        }
        //for token
       let token = input["input"]["token"];
       const forID = AuthForBoth(token).id
        console.log(forID, "user_id");
        if (token) {
          const VMCreate = await prisma.virtualMachine.create({
            data: {
              userId: forID,
              virtualMachineName: input["input"]["virtualMachineName"],
              Title: input["input"]["Title"],
              Description: input["input"]["Description"],
              Status: input["input"]["Status"],
              vmImage : path,
              Config: input["input"]["Config"],
            },
            select: {
              id: true,
              guId : true,
              virtualMachineName: true,
              Status: true,
              Description: true,
              Config: true,
              vmImage : true,
            },
          });
          console.log(VMCreate);
          return VMCreate;
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Failed to Create", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    }
}
}
export default createVMResolvers;