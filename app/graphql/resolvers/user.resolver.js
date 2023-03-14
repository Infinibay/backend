const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const fs = require("fs");
const file = require("../../configFile/config.json");
const { GraphQLError } = require("graphql");

const prisma = new PrismaClient();
const config = process.env;

// const {
//   throwHttpGraphQLError,
// } = require("apollo-server-core/dist/runHttpQuery");
//const { UNAUTHORIZED } = require("../../helper/helperfunction");
const user_resolver = {
  Query: {
    //////for confile file get/////
    getConfigFile: async () => {
    try {
      return file;
    } catch (error) {
      return error;
    }
    },
    //-------------------------------------------------------FOR USER---------------------------------------------///

    getUserVM: async (parent, input) => {
      try {
        const token = input.input.token;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const decodedId = decoded.id;

        if (decodedId) {
          const userVM = await prisma.user.findUnique({
            where: {
              id: decodedId,
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

          return userVM;
        }
      } catch (error) {
        throw new GraphQLError("Something went wrong please check again", {
          extensions: {
            statusCode: 500,
          },
        });
      }
    },

    //////for get  All User List/////

    getUserList: async (parent, input) => {
      try {
        const { token, Search } = input.input;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const { User_Type } = decoded;

        if (User_Type !== "admin") {
          throw new GraphQLError("Unauthorized access", {
            extensions: {
              statusCode: 401,
            },
          });
        }

        const userList = await prisma.user.findMany({
          where: {
            Deleted: false,
            User_Type: "user",
            ...(Search && {
              First_Name: {
                contains: Search,
                mode: "insensitive",
              },
            }),
          },
        });

        return userList;
      } catch (error) {
        throw new GraphQLError("Something went wrong, please check again", {
          extensions: {
            statusCode: 500,
          },
        });
      }
    },

    //////for get User By ID/////
    getUserByID: async (parent, input) => {
      try {
        const { token } = input.input;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const { id: decodedId } = decoded;

        if (decodedId) {
          const user = await prisma.user.findUnique({
            where: {
              id: decodedId,
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

          return user;
        }
      } catch (error) {
        throw new GraphQLError("Something went wrong, please try again later", {
          extensions: {
            statusCode: 500,
          },
        });
      }
    },
  },
  Mutation: {
    //------------------------------------------USER------------------------------------------------//
    //////for Create User/////

    async createUser(root, input) {
      try {
        // Create a unique file path for the user's image
        // TODO: Use some configuration on the system to determine where to store the images
        // TODO: Use a unique ID for the file name
        const path = `app/userImage/${Date.now()}.jpeg`;
        // Destructure the userImage from the input
        const { userImage } = input.input;
    
        // If a userImage was provided
        if (userImage) {
          try {
            // Remove the metadata from the base64 encoded image string
            const base64Data = userImage.replace(/^data:([A-Za-z-+/]+);base64,/, "");
            // Write the image data to the file system
            fs.writeFileSync(path, base64Data, { encoding: "base64" });
          } catch (error) {
            throw new GraphQLError("Error writing user image to file", {
              extensions: {
                statusCode: 500,
              },
            });
          }
        }
    
        // Hash the password using bcrypt
        // TODO: Use some configuration on the system to determine the number of rounds
        const encryptedPassword = await bcrypt.hash(input.input.Password, 10);
    
        // Create the user in the database
        const user = await prisma.user.create({
          data: {
            First_Name: input.input.firstName,
            Last_Name: input.input.lastName,
            Email: input.input.Email,
            Password: encryptedPassword,
            Deleted: input.input.Deleted,
            User_Image: path,
            User_Type: input.input.userType,
          },
        });
    
        return user;
      } catch (error) {
        // Throw a generic error with a status code if something goes wrong
        throw new GraphQLError("Sign-up Failed", {
          extensions: {
            statusCode: 400,
            code: "Sign-up Failed",
          },
        });
      }
    },

    //////for Update User/////

    // NOTE: root is not been used
    async updateUser(root, input) {
      try {
        const token = input.input.token;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const decoded_id = decoded.id;

        // Create a unique file path for the user's image
        // TODO: Use some configuration on the system to determine where to store the images
        const path = `app/userImage/${Date.now()}.jpeg`;
        const { userImage } = input.input;
        if (userImage) {
          const base64Data = userImage.replace(/^data:([A-Za-z-+/]+);base64,/, "");
          fs.writeFileSync(path, base64Data, { encoding: "base64" });
        }

        if (decoded_id) {
          // Hash the password using bcrypt
          // TODO: Use some configuration on the system to determine the number of rounds
          const encryptedPassword = await bcrypt.hash(input.input.Password, 10);
          const user = await prisma.user.update({
            where: {
              id: decoded_id,
            },
            data: {
              First_Name: input.input.firstName,
              Last_Name: input.input.lastName,
              Email: input.input.Email,
              Password: encryptedPassword,
              Deleted: input.input.Deleted,
              User_Image: path,
              User_Type: input.input.userType,
            },
          });
          return user;
        }
      } catch (error) {
        throw new GraphQLError("Update Failed..!", {
          extensions: {
            statusCode: 404,
          },
        });
      }
    },

    //////for Delete User/////

    async deleteUser(root, input) {
      try {
        const token = input.input.token;
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        const decoded_id = decoded.id;

        if (decoded_id && (decoded.User_Type === "admin")) {
          await prisma.user.update({
            where: {
              id: input.input.id,
            },
            data: {
              Deleted: true,
            },
          });
          return "Deleted";
        } else {
          throw new Error("Unauthorized access");
        }
      } catch (error) {
        throw new Error(`Delete User Failed: ${error.message}`);
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
