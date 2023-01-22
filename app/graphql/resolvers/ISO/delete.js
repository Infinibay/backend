import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare"

const forDeleteISO = {  
    Mutation: {
    
    //FOR DELETE-ISO
    async deleteISO(_root, input) {
        try {
          let token = input["input"]["token"];
  
          const forBoth = AuthForBoth(token).id;
          const forUserType = AuthForBoth(token).userType;
          if (forBoth) {
            if (forUserType == "admin") {
              const forDeleteISO = await prisma.ISO.delete({
                where: {
                  id: input["input"]["id"],
                },
              });
              console.log(forDeleteISO);
              return "ISO Deleted";
            }
            if (forUserType == "user") {
              const forFind = await prisma.ISO.findUnique({
                where: {
                  id: input["input"]["id"],
                },
              });
              console.log(forFind.userId);
              console.log(forFind.id, "id");
              if (forBoth == forFind.userId) {
                const userDeleteISO = await prisma.ISO.delete({
                  where: {
                    id: forFind.id,
                  },
                });
                console.log(userDeleteISO);
                return "deleted ISO";
              }
            }
          }
        } catch (error) {
          console.log(error);
          console.log(error["extensions"]["StatusCode"]);
  
          if (error["extensions"]["StatusCode"] == 400) {
            throw new GraphQLError("please enter valid credentials", {
              extensions: {
                StatusCode: 401,
                code: "Invalid Credentials",
              },
            });
          } else {
            console.log("hello");
            throw new GraphQLError("Failed to Delete", {
              extensions: {
                StatusCode: 400,
                code: "Failed",
              },
            });
          }
        }
      },}
    }
    export default forDeleteISO 