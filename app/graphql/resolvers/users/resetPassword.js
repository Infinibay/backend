import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import { GraphQLError } from "graphql";

const forResetPassword = {
  Mutation: {
    //////for Reset Password/////
    async resetPassword(_root, input) {
      const config = process.env;
      try {
        console.log(input);
        const token = input["input"]["token"];
        console.log(token);
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        console.log(decoded);

        var Password = input["input"]["Password"];
        var encryptedPassword = await bcrypt.hash(Password, 10);

        console.log(decoded.id);
        prisma.user.update({
          where: {
            id: decoded.id,
          },
          data: {
            Password: encryptedPassword,
          },
        }).then(()=>{
          console.log("Password Reset");
          return "Password Reset";
        })
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Something went wrong please try again", {
          extensions: {
            StatusCode: 404,
          },
        });
      }
    },
  },
};
export default forResetPassword;
