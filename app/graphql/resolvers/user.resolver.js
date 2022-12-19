const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
var smtpTransport = require("nodemailer-smtp-transport");
const nodemailer = require("nodemailer");
const file = require("../../configFile/config.json");
const fs = require("fs");
const path = require("path");
const config = process.env;
const errorName = require("../../helper/helperfunction");
const errorType = require("../../helper/helperfunction");
const { UNAUTHORIZED } = require("../../helper/helperfunction");
const { GraphQLError } = require("graphql");
const { argsToArgsConfig } = require("graphql/type/definition");
const {
  throwHttpGraphQLError,
} = require("apollo-server-core/dist/runHttpQuery");
// const {
//   throwHttpGraphQLError,
// } = require("apollo-server-core/dist/runHttpQuery");
//const { UNAUTHORIZED } = require("../../helper/helperfunction");
const user_resolver = {
  Query: {
    //////for confile file get/////
    getConfigFile: async () => {
      try {
        const for_config_file = file;
        console.log(for_config_file);
        return for_config_file;
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    //-------------------------------------------------------FOR USER---------------------------------------------///

    getUserVM: async (parent, input) => {
      try {
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        if (decoded_id) {
          const for_user_VM = await prisma.user.findUnique({
            where: {
              id: decoded_id,
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

          console.log(for_user_VM._count);
          console.log(for_user_VM);

          return for_user_VM;
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
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        console.log(decoded);
        console.log(decoded.User_Type);
        if (decoded.User_Type == "admin") {
          const for_get_user_list = await prisma.user.findMany({
            where: {
              Deleted: false,
              User_Type: "user",
            },
          });

          if (Search && decoded.User_Type == "admin") {
            const search_to_find = await prisma.user.findMany({
              where: {
                Deleted: false,
                User_Type: "user",
                First_Name: {
                  contains: Search,
                  mode: "insensitive",
                },
              },
            });
            //  console.log(search_to_find);
            return search_to_find;
          }
          console.log(for_get_user_list);
          return for_get_user_list;
        }
      } catch (error) {
        console.log(error);
        return error;
        //   throw new GraphQLError("Something went wrong please check again", {
        //     extensions: {
        //       StatusCode: 500,
        //     },
        //   });
      }
    },
    //////for get User By ID/////

    getUserByID: async (parent, input) => {
      try {
        // console.log("hello", input);
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = decoded.id;
        console.log(decoded_id);
        if (decoded_id) {
          const find_user_by_id = await prisma.user.findUnique({
            where: {
              id: decoded_id,
            },
            select: {
              id: true,
              First_Name: true,
              Last_Name: true,
              Email: true,
              Deleted: true,
              User_Image: true,
              _count: true,
            },
          });
          console.log(find_user_by_id);
          return find_user_by_id;
        }
      } catch (error) {
        console.log(error);
        // return error;
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
          //for encrypted Password
        }

        const encryptedPassword = await bcrypt.hash(
          input["input"]["Password"],
          10
        );
        const type_of_user = "user";
        console.log("abcv");

        const user_create = await prisma.user.create({
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
        console.log(user_create);
        return user_create;
      } catch (error) {
        // console.log(error);
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
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;

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

        if (decoded_id) {
          const for_Update_User = await prisma.user.update({
            where: {
              id: decoded_id,
            },
            data: {
              First_Name: input["input"]["firstName"],
              Last_Name: input["input"]["lastName"],
              Email: input["input"]["Email"],
              Password: input["input"]["Password"],
              Deleted: input["input"]["Deleted"],
              // userImage: input["input"]["userImage"] ,
              User_Image: path,
              // userType: input["input"]["userType"],
            },
          });
          return for_Update_User;
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
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        console.log(decoded.User_Type);
        console.log(decoded.userType);
        const decoded_id = input.userId.id;
        console.log(decoded_id);

        if (decoded_id && decoded.User_Type == "admin") {
          const for_delete_User = await prisma.user.update({
            where: {
              id: input["input"]["id"],
            },
            data: {
              Deleted: true,
            },
          });
          console.log(for_delete_User);
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
        const for_login = await prisma.user.findUnique({
          where: {
            Email: Email,
          },
        });

        if (!(Password || Email)) {
          console.log("hello");
          throw new Error("All input is required");
        }

        if ((await bcrypt.compare(Password, for_login.Password)) == true) {
          const for_update_token = await prisma.user.update({
            where: {
              id: for_login.id,
            },
            data: {
              token: jwt.sign(
                {
                  id: for_login.id,
                  Email: for_login.Email,
                  User_Type: for_login.User_Type,
                },
                process.env.TOKEN_KEY,
                {
                  expiresIn: "1d",
                }
              ),
            },
          });
          console.log(for_login.User_Type);
          // console.log(for_login.userType);
          return for_update_token;
        } else {
          throw new GraphQLError("Wrong password..!", {
            extensions: {
              StatusCode: 401,
            },
          });
        }
        // // console.log(for_login);
        // return (for_update_token);
      } catch (error) {
        console.log(error);
        throw new GraphQLError("Login Failed " + "Please Try Again....!", {
          extensions: {
            StatusCode: 401,
          },
        });
      }
    },

    async sendEmail(root, input) {
      try {
        const Email = input["input"]["Email"];
        console.log(Email);
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
          from: "fizzafatima066@gmail.com",
          to: Email,
          subject: "Password Reset",
          text: "That was easy!",
          html: `<a href="localhost:3001/forgetpassword?> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword? </a>`,
        };

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        });
      } catch (error) {
        return error;
      }
    },
    //////for Forget Passwordr/////
    async forgetPassword(root, input) {
      try {
        //  const Email = input["input"]["Email"]

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
            // sendEmail(req, token);
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

              // html: "<p> hello</p>",
              html: `<a href="localhost:3001/forgetpassword?token=${token}"> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword?token=${token} </a>`,
            };

            transporter.sendMail(mailOptions, function (error, info) {
              if (error) {
                console.log(error);
              } else {
                console.log("Email sent: " + info.response);
              }
            });
            console.log("pls check ur mail");
            return "Check Your Mail";
          }
          if (userEmail.Deleted == true) {
            console.log("user not found");
            throw new Error("user profile not found ");
          }
        } else {
          console.log("not found");
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
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const userId = decoded.id;
        console.log(userId);
        // var Email = input["input"]["Email"];
        var Password = input["input"]["Password"];

        var encryptedPassword = await bcrypt.hash(Password, 10);
        const for_reset_password = await prisma.user.update({
          where: {
            id: userId,
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

module.exports = user_resolver;
