import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();
import jwt from "jsonwebtoken"
import smtpTransport from "nodemailer-smtp-transport";
import nodemailer from "nodemailer"
import { GraphQLError } from "graphql";



const forgetPassword = {
    Mutation: {
//////for Forget Passwordr/////
 async forgetPassword(root, input) {
    try {
      const userEmail = await prisma.user.findUnique({
        where: {
          Email: input["input"]["Email"],
        },
      });
      console.log(userEmail);
      if (userEmail) {
        if (!userEmail) {
          throw new Error("please verify your email");
        }
        if (userEmail.Deleted == false) {
          const tokenss = jwt.sign(
            {
              id: userEmail.id,
              Email: userEmail.Email,
            },
            process.env.TOKEN_KEY,
            {
              expiresIn: "2h",
            }
          );
          var token = tokenss;
          console.log(token);
          const transporter = nodemailer.createTransport(
            smtpTransport({
              service: "gmail",
              host: "smtp.gmail.com",
              auth: {
                user: "razorshariq@gmail.com",
                pass: "xhkjchgrxezlsnvz",
              },
            })
          );
          const mailOptions = {
            from: "razorshariq@gmail.com",
            to: userEmail.Email,
            subject: "Password Reset",
            text: "That was easy!",
            html: `<a href="localhost:3001/forgetpassword?token=${token}"> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword?token=${token} </a>`,
          };
          transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
              console.log(error);
            } else {
              console.log("Email sent: " + info.response);
            }
          });
          console.log("Check Your Mail");
          return "Check Your Mail";
        }
        if (userEmail.Deleted == true) {
          console.log("User Not Found");
          throw new Error("User Profile Not Found ");
        }
      } else {
        console.log("Not Found");
        throw new Error("NOT FOUND");
      }
    } catch (error) {
      throw new GraphQLError("Something went wrong please try again", {
        extensions: {
          StatusCode: 404,
        },
      });
    }
  },
}
}
export default forgetPassword