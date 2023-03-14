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
        const decodedId = decoded.id;

        if (decodedId && (decoded.User_Type === "admin")) {
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
        const email = input.input.Email;
        const password = input.input.Password;
        const forLogin = await prisma.user.findUnique({
          where: {
            Email: email,
          },
        });

        if (!password || !email) {
          throw new Error("Both email and password are required");
        }

        if (!forLogin) {
          throw new GraphQLError("Email not found", {
            extensions: {
              statusCode: 404,
            },
          });
        }

        if (await bcrypt.compare(password, forLogin.Password)) {
          const for_update_token = await prisma.user.update({
            where: {
              id: forLogin.id,
            },
            data: {
              token: jwt.sign({
                  id: forLogin.id,
                  Email: forLogin.Email,
                  User_Type: forLogin.User_Type,
                },
                config.TOKEN_KEY,
                {
                  expiresIn: "1d",
                }
              ),
            },
          });
          return for_update_token;
        } else {
          throw new GraphQLError("Wrong password", {
            extensions: {
              statusCode: 401,
            },
          });
        }
      } catch (error) {
        console.error(error);
        throw new GraphQLError("Login failed. Please try again later", {
          extensions: {
            statusCode: 500,
          },
        });
      }
    },

    async sendEmail(root, input) {
      try {
        const email = input.input.Email;
        const transporter = nodemailer.createTransport(
          // TODO: Add ENV variables for the email service
          smtpTransport({
            service: process.env.EMAIL_SERVICE,
            host: process.env.EMAIL_HOST,
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASSWORD,
            },
          })
        );
        const mailOptions = {
          from: process.env.EMAIL_FROM,
          to: email,
          subject: "Password Reset",
          text: "That was easy!",
          // TODO: Add a template library to generate the email
          html: `<a href="localhost:3001/forgetpassword?> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword? </a>`,
        };

        await transporter.sendMail(mailOptions);
      } catch (error) {
        // Throw a GraphQL error if something goes wrong
        throw new GraphQLError("Email not sent", {
          extensions: {
            statusCode: 500,
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
    
        if (!userEmail) {
          throw new Error("User profile not found. Please verify your email.");
        }
    
        if (userEmail.Deleted) {
          throw new Error("User profile not found.");
        }
    
        const token = jwt.sign({
            id: userEmail.id,
            Email: userEmail.Email,
          },
          process.env.TOKEN_KEY,
          {
            expiresIn: "2h",
          }
        );
    
        await sendEmail(userEmail.Email, token);
        return "Check your email for password reset instructions.";
      } catch (error) {
        throw new GraphQLError("Failed to send password reset email. Please try again.", {
          extensions: {
            StatusCode: 404,
          },
        });
      }
    },

    //////for Reset Password/////

    async resetPassword(root, input) {
      try {
        const token = input["input"]["token"];
        const decoded = jwt.verify(token, process.env.TOKEN_KEY);
        const userId = decoded.id;

        var Password = input["input"]["Password"];

        // TODO: Add some configuration to determine the number of rounds
        var encryptedPassword = await bcrypt.hash(Password, 10);
        await prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            Password: encryptedPassword,
          },
        });

        return "Password Reset";
      } catch (error) {
        console.log(error);
        throw new GraphQLError(`Error: ${error.message}`, {
          extensions: {
            StatusCode: 404,
          },
        });
      }
    },
  },
};

module.exports = user_resolver;
