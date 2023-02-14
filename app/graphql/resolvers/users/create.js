import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import bcrypt from "bcrypt"
import { GraphQLError } from "graphql";
import fs from "fs"
const signUp = {
  Mutation: {
    async createUser(root, input) {
      //for Image
      try {
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
        const encryptedPassword = await bcrypt.hash(
          input["input"]["Password"],
          10
        );
        console.log("abcv");
        const userCreate = await prisma.user.create({
          data: {
            firstName: input["input"]["firstName"],
            lastName: input["input"]["lastName"],
            Email: input["input"]["Email"],
            Password: encryptedPassword,
            Deleted: input["input"]["Deleted"],
            userImage: path,
            userType: input["input"]["userType"],
          },
        });
        console.log(userCreate);
        return userCreate;
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Sign-up Failed", {
          extensions: {
            StatusCode: 400,
            code: "Sign-up Failed",
          },
        });
      }
    },
  },
};
export default signUp;
