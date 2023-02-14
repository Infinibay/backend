import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import fs from "fs"
import { GraphQLError } from "graphql";
import {AuthForBoth} from "../../middleWare.js"
    const forUpdateUser = {
        Mutation: {
    //////for Update User/////
    async updateUser(_root, input) {
        try {
          //for token
          let token = input["input"]["token"];
          const forID = AuthForBoth(token).id;
          const path = "app/userImage/" + Date.now() + ".jpeg";
          const userImage = input["input"]["userImage"];
          if (userImage) {
            var base64Data = await userImage.replace(
              /^data:([A-Za-z-+/]+);base64,/,
              ""
            );
            fs.writeFileSync(path, base64Data, { encoding: "base64" });
            console.log(path);
          }
          if (forID) {
            if (userImage) {
              const forUpdateUser = await prisma.user.update({
                where: {
                  id: forID,
                },
                data: {
                  firstName: input["input"]["firstName"],
                  lastName: input["input"]["lastName"],
                  Email: input["input"]["Email"],
                  Password: input["input"]["Password"],
                  Deleted: input["input"]["Deleted"],
                  userImage: path,
                },
              });
              console.log("forUpdateUser");
              return forUpdateUser;
            } else {
              const forUpdateUserwithoutimage = await prisma.user.update({
                where: {
                  id: forID,
                },
                data: {
                  firstName: input["input"]["firstName"],
                  lastName: input["input"]["lastName"],
                  Email: input["input"]["Email"],
                  Password: input["input"]["Password"],
                  Deleted: input["input"]["Deleted"],
                },
              });
              console.log("forUpdateUserwithoutimage");
              return forUpdateUserwithoutimage;
            }
          }
        } catch (error) {
          throw new GraphQLError("Update Failed..!", {
            extensions: {
              StatusCode: 404,
            },
          });
        }
      },

    }
}
export  default forUpdateUser