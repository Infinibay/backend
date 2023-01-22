import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import { GraphQLError } from "graphql";

const login = {
  Mutation: {
    async Login(root, input) {
      try {
        const Email = input["input"]["Email"];
        const Password = input["input"]["Password"];
        const forLogin = await prisma.user.findUnique({
          where: {
            Email: Email,
          },
        });
        if (!(Password || Email)) {
          throw new Error("All input is required");
        }
        if ((await bcrypt.compare(Password, forLogin.Password)) == true) {
          const forUpdateToken = await prisma.user.update({
            where: {
              id: forLogin.id,
            },
            data: {
              token: jwt.sign(
                {
                  id: forLogin.id,
                  Email: forLogin.Email,
                  userType: forLogin.userType,
                },
                process.env.TOKEN_KEY,
                {
                  expiresIn: "1d",
                }
              ),
            },
          });
          console.log(forLogin.userType);
          return forUpdateToken;
        } else {
          throw new GraphQLError("Wrong password..!", {
            extensions: {
              StatusCode: 401,
            },
          });
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Login Failed " + "Please Try Again....!", {
          extensions: {
            StatusCode: 401,
          },
        });
      }
    },
  },
};
export default login;
