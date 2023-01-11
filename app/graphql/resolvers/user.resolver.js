const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
var smtpTransport = require("nodemailer-smtp-transport");
const nodemailer = require("nodemailer");
const file = require("../../configFile/config.json");
const fs = require("fs");
const config = process.env;
const { GraphQLError } = require("graphql");
var decoded;
function Auth() {
  decoded = jwt.verify(token, config.TOKEN_KEY);
  console.log(decoded, "details");
  console.log(decoded.id, "getid");
}
const userResolver = {
  Query: {
    //////for confile file get/////
    getConfigFile: async () => {
      try {
        const forConfigFile = file;
        console.log(forConfigFile);
        return forConfigFile;
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    //-------------------------------------------------------FOR USER---------------------------------------------///
    getUserVM: async (parent, input) => {
      try {
        token = input["input"]["token"];
        Auth();
        if (decoded.id) {
          const forUserVM = await prisma.user.findUnique({
            where: {
              id: decoded.id,
            },
            select: {
              id: true,
              First_Name: true,
              Last_Name: true,
              Email: true,
              User_Image: true,
              User_Type: true,
              Notification: {
                select: {
                  id: true,
                  Message: true,
                },
              },
              IOS: {
                select: {
                  id: true,
                  Name: true,
                },
              },
              VM: {
                select: {
                  VirtualMachine_Name: true,
                  VM_Image: true,
                },
              },
              _count: {
                select: {
                  VM: true,
                  Notification: true,
                  IOS: true,
                },
              },
            },
          });
          console.log(forUserVM._count);
          console.log(forUserVM);
          return forUserVM;
        }
      } catch (error) {
        throw new GraphQLError("Something went wrong please check again", {
          extensions: {
            StatusCode: 500,
          },
        });
      }
    },
    //////for get  All User List/////
    getUserList: async (parent, input) => {
      try {
        token = input["input"]["token"];
        Search = input["input"]["Search"];
        Auth();
        if (decoded.User_Type == "admin") {
          const forGetUserList = await prisma.user.findMany({
            where: {
              Deleted: false,
              User_Type: "user",
            },
          });

          if (Search && decoded.User_Type == "admin") {
            const searchToFind = await prisma.user.findMany({
              where: {
                Deleted: false,
                User_Type: "user",
                First_Name: {
                  contains: Search,
                  mode: "insensitive",
                },
              },
            });
            return searchToFind;
          }
          console.log(forGetUserList);
          return forGetUserList;
        }
      } catch (error) {
        console.log(error);
        // return error;
        throw new GraphQLError("Something went wrong please check again", {
          extensions: {
            StatusCode: 500,
          },
        });
      }
    },
    //////for get User By ID/////
    getUserByID: async (parent, input) => {
      try {
        token = input["input"]["token"];
        Auth();
        if (decoded.id) {
          const findUserById = await prisma.user.findUnique({
            where: {
              id: decoded.id,
            },
            select: {
              id: true,
              First_Name: true,
              Last_Name: true,
              Email: true,
              Deleted: true,
              User_Image: true,
              User_Type: true,
              _count: true,
            },
          });
          console.log(findUserById);
          return findUserById;
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Something went wrong please try again later", {
          extensions: {
            StatusCode: 500,
          },
        });
      }
    },
  },
  Mutation: {
    //------------------------------------------USER------------------------------------------------//
    //////for Create User/////
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
        const type_of_user = "user";
        console.log("abcv");
        const userCreate = await prisma.user.create({
          data: {
            First_Name: input["input"]["firstName"],
            Last_Name: input["input"]["lastName"],
            Email: input["input"]["Email"],
            Password: encryptedPassword,
            Deleted: input["input"]["Deleted"],
            User_Image: path,
            User_Type: input["input"]["userType"],
          },
        });
        console.log(userCreate);
        return userCreate;
      } catch (error) {
        throw new GraphQLError("Sign-up Failed", {
          extensions: {
            StatusCode: 400,
            code: "Sign-up Failed",
          },
        });
      }
    },
    //////for Update User/////
    async updateUser(root, input) {
      try {
        //for token
        token = input["input"]["token"];
        Auth();
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
        if (decoded.id) {
          if (userImage) {
            const forUpdateUser = await prisma.user.update({
              where: {
                id: decoded.id,
              },
              data: {
                First_Name: input["input"]["firstName"],
                Last_Name: input["input"]["lastName"],
                Email: input["input"]["Email"],
                Password: input["input"]["Password"],
                Deleted: input["input"]["Deleted"],
                User_Image: path,
              },
            });
            console.log("forUpdateUser");
            return forUpdateUser;
          } else {
            const forUpdateUserwithoutimage = await prisma.user.update({
              where: {
                id: decoded.id,
              },
              data: {
                First_Name: input["input"]["firstName"],
                Last_Name: input["input"]["lastName"],
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
    //////for Delete User/////
    async deleteUser(root, input) {
      try {
        token = input["input"]["token"];
        Auth();
        if (decoded.id && decoded.User_Type == "admin") {
          const forDeleteUser = await prisma.user.update({
            where: {
              id: input["input"]["id"],
            },
            data: {
              Deleted: true,
            },
          });
          console.log(forDeleteUser);
          return "Deleted";
        }
      } catch (error) {
        throw new GraphQLError("Delete User Failed..!", {
          extensions: {
            StatusCode: 404,
          },
        });
      }
    },
    //////for Login/////
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
                  User_Type: forLogin.User_Type,
                },
                process.env.TOKEN_KEY,
                {
                  expiresIn: "1d",
                }
              ),
            },
          });
          console.log(forLogin.User_Type);
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
    //////for Reset Password/////
    async resetPassword(root, input) {
      const config = process.env;
      try {
        console.log(input);
        const token = input["input"]["token"];
        console.log(token);
        Auth();
        var Password = input["input"]["Password"];
        var encryptedPassword = await bcrypt.hash(Password, 10);
        const forResetPassword = await prisma.user.update({
          where: {
            id: decoded.id,
          },
          data: {
            Password: encryptedPassword,
          },
        });
        console.log("Password Reset");
        return "Password Reset";
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
module.exports = userResolver;
