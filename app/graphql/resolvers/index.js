// const { PrismaClient, Prisma } = require("@prisma/client");
// const prisma = new PrismaClient();
// const { gql, GraphQlUpload } = require("apollo-server-express");
// const bcrypt = require("bcrypt");
// const { response } = require("express");
// const jwt = require("jsonwebtoken");
// var smtpTransport = require("nodemailer-smtp-transport");
// const nodemailer = require("nodemailer");
// // const { config } = require("dotenv");
// const file = require("../../configFile/config.json");
// const fs = require("fs");
// const { isNonNullType, isNullableType } = require("graphql");
// const path = require("path");
// const config = process.env;
// const resolvers = {
//   Query: {
//     //////for confile file get/////
//     getConfigFile: async () => {
//       try {
//         const for_config_file = file;
//         console.log(for_config_file);
//         return for_config_file;
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //-------------------------------------------------------FOR USER---------------------------------------------///
//     //////for get  All User List/////

//     getUserList: async (parent, input) => {
//       try {
//         token = input["input"]["token"];
//         Search = input["input"]["Search"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         if (decoded.User_Type == "admin") {
//           const for_get_user_list = await prisma.user.findMany({
//             where: {
//               Deleted: false,
//               User_Type: "user",
//             },
//           });


//           if (Search && decoded.User_Type == "admin") {
//             const search_to_find = await prisma.user.findMany({
//               where: {
//                 Deleted: false,
//                 User_Type: "user",
//                 First_Name: {
//                   contains: Search,
//                   mode: "insensitive",
//                 },
//               },
//             });
//           //  console.log(search_to_find);
//             return search_to_find;
//           }
//          // console.log(for_get_user_list);
//           return for_get_user_list;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //////for get User By ID/////

//     getUserByID: async (parent, input) => {
//       try {
//         console.log("hello", input);
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = decoded.id;
//         // console.log(decoded_id);
//         if (decoded_id && decoded.User_Type == "admin") {
//           const find_user_by_id = await prisma.user.findUnique({
//             where: {
//               id: input["input"]["id"],
//             },
//             select: {
//               id: true,
//               First_Name: true,
//               Last_Name: true,
//               Email: true,
//               Deleted: true,
//              User_Image: true,
//               _count: true,
//             },
//           });
//           return find_user_by_id;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //------------------------------------------ FOR VIRTUAL MACHINE----------------------------------------------- //
//     //////for get User VM/////

//     getUserVM: async (parent, input) => {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         if (decoded_id) {
//           const for_user_VM = await prisma.user.findUnique({
//             where: {
//               id: decoded_id,
//             },
//             select: {
//               id: true,
//               First_Name: true,
//             Last_Name: true,
//               Email: true,
//              User_Image: true,
//               User_Type: true,
//               Notification: {
//                 select: {
//                   id: true,
//                   Message: true,
//                 },
//               },
//               IOS: {
//                 select: {
//                   id: true,
//                   Name: true,
//                 },
//               },
//               VM: {
//                 select: {
//                   VirtualMachine_Name: true,
//                   VM_Image: true,
//                 },
//               },
//               _count: {
//                 select: {
//                   VM: true,
//                   Notification: true,
//                   IOS: true,
//                 },
//               },
//             },
//           });

//           console.log(for_user_VM._count);
//           console.log(for_user_VM);

//           return for_user_VM;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //////for Get Specific VM/////

//     getSpecificVM: async (parent, input) => {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         // const for_type = input.userId.userType
//         console.log(decoded.userType);

//         if (decoded_id && decoded.User_Type == "user") {
//           const for_specific_VM = await prisma.virtualMachine.findUnique({
//             where: {
//               id: input["input"]["id"],
//             },
//             select: {
//               id: true,
//               VirtualMachine_Name: true,
//               Description: true,
//               Title: true,
//               Status: true,
//               Config: true,
//               user: {
//                 select: {
//                   id: true,
//                   Email: true,
//                 },
//               },
//             },
//           });
//           if (for_specific_VM.user.id == decoded_id) {
//             console.log("hello");
//             console.log(for_specific_VM);
//             return for_specific_VM;
//           } else {
//             console.log("ERRPOR");
//             throw new Error("VM Not Found");
//           }
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //////for get All VM/////

//     getAllVM: async (root, input) => {
//       try {
//         token = input["input"]["token"];
//         Search = input["input"]["Search"];
//         Status = input["input"]["Status"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         if (decoded_id && decoded.User_Type == "admin") {
//           const for_VM = await prisma.virtualMachine.findMany({
//             select: {
//               VirtualMachine_Name: true,
//               VM_Image: true,
//               Title: true,
//               Status: true,
//               GU_ID: true,
//               Config: true,
//               Description: true,
//               id: true,
//             },
//           });
//           if (Search) {
//             const search_to_find = await prisma.virtualMachine.findMany({
//               where: {
//                 VirtualMachine_Name: {
//                   contains: Search,
//                   mode: "insensitive",
//                 },
//               },
//             });
//             console.log(search_to_find);
//             return search_to_find;
//           }
//           if (Status) {
//             const for_search_with_status = await prisma.virtualMachine.findMany(
//               {
//                 where: {
//                   Status: {
//                     equals: Status,
//                   },
//                 },
//               }
//             );
//             console.log(for_search_with_status);
//             return for_search_with_status;
//           }

//           // console.log(for_VM);
//           return for_VM;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     ////GET USER ALL VM
//     getUserAllVM: async (parent, input) => {
//       try {
//         token = input["input"]["token"];
//         Status = input["input"]["Status"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         if (decoded_id && decoded.User_Type == "user") {
//           const for_VM = await prisma.virtualMachine.findMany({
//             where: {
//               userId: decoded_id,
//             },
//             select: {
//               VirtualMachine_Name: true,
//               VM_Image: true,
//               Title: true,
//               Status: true,
//               GU_ID: true,
//               Config: true,
//               Description: true,
//               id: true,
//               user: {
//                 select: {
//                   id: true,
//                 },
//               },
//             },
//           });
//           // console.log();
//           //  console.log(decoded.id);
//           if (Status) {
//             const for_search_with_status = await prisma.virtualMachine.findMany(
//               {
//                 where: {
//                   userId: decoded_id,
//                   Status: {
//                     equals: Status,
//                   },
//                 },
//               }
//             );
//             console.log(for_search_with_status);
//             return for_search_with_status;
//           }

//           console.log(for_VM);
//           return for_VM;
//         }
//       } catch (error) {
//         console.log(error);
//         console.log(error);
//       }
//     },

//     ////------------------------------------FOR NOTIFICATION------------------------------------------------------////
//     // GET  notification
//     getNotification: async () => {
//       try {
//         const for_get_notification = await prisma.notification.findMany({});
//         return for_get_notification;
//       } catch (error) {
//         return error;
//       }
//     },

//     getUserNotification: async (root, input) => {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         if (decoded_id) {
//           const user_notification = await prisma.notification.findMany({
//             where: {
//               userId: decoded_id,
//             },
//           });
//           console.log(user_notification);
//           return user_notification;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //-----------------------------------FOR IOS------------------------------------------------------------//
//     //for get all IOS (admin )
//     getAllIOS: async (root, input) => {
//       try {
//         token = input["input"]["token"];
//         Search = input["input"]["Search"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         console.log(decoded.userType);
//         if (decoded.User_Type == "admin") {
//           const for_find_IOS = await prisma.IOS.findMany({
//             select: {
//               Name: true,
//               Type: true,
//               createdAt: true,
//               userId: true,
//             },
//           });
//           if (Search) {
//             const search_to_find = await prisma.IOS.findMany({
//               where: {
//                 Name: {
//                   contains: Search,
//                   mode: "insensitive",
//                 },
//               },
//             });
//             console.log(search_to_find);
//             return search_to_find;
//           }
//           console.log(for_find_IOS);
//           return for_find_IOS;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //FOR GET IOS BY ID (users)
//     getIOSById: async (parent, input) => {
//       try {
//         token = input["input"]["token"];
//         search = input["input"]["search"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         console.log(decoded_id);
//         if (decoded_id) {
//           const get_IOS = await prisma.IOS.findMany({
//             where: {
//               userId: decoded_id,
//             },
//             select: {
//               id: true,
//               userId: true,
//               Name: true,
//               Type: true,
//               createdAt: true,
//             },
//           });
//           if (search) {
//             const for_find = await prisma.iOS.findMany({
//               where: {
//                 userId: decoded_id,
//                 Name: {
//                   contains: search,
//                   mode: "insensitive",
//                 },
//               },
//             });
//             console.log(for_find);
//             return for_find;
//           }

//           console.log(get_IOS);
//           return get_IOS;
//         } else {
//           throw new Error("login again");
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//   },
//   Mutation: {
//     //------------------------------------------USER------------------------------------------------//
//     //////for Create User/////

//     async createUser(root, input) {
//       try {
//         //for Image
//         const path = "app/userImage/" + Date.now() + ".jpeg";
//         const userImage = input["input"]["userImage"];
//         if (userImage) {
//           var base64Data = await userImage.replace(
//             /^data:([A-Za-z-+/]+);base64,/,
//             ""
//           );
//           fs.writeFileSync(path, base64Data, { encoding: "base64" });
//           console.log(path);
//           //for encrypted Password
//         }

//         const encryptedPassword = await bcrypt.hash(
//           input["input"]["Password"],
//           10
//         );
//         const type_of_user = "user";
//         const user_create = await prisma.user.create({
//           data: {
//             First_Name: input["input"]["firstName"],
//             Last_Name: input["input"]["lastName"],
//             Email: input["input"]["Email"],
//             Password: encryptedPassword,
//             Deleted: input["input"]["Deleted"],
//             User_Image: path,
//             User_Type: type_of_user,
//           },
//         });
//         console.log(user_create);
//         return user_create;
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //////for Update User/////

//     async updateUser(root, input) {
//       try {
//         //for token
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;

//         const path = "app/userImage/" + Date.now() + ".jpeg";
//         const userImage = input["input"]["userImage"];
//         if (userImage) {
//           var base64Data = await userImage.replace(
//             /^data:([A-Za-z-+/]+);base64,/,
//             ""
//           );
//           fs.writeFileSync(path, base64Data, { encoding: "base64" });
//           console.log(path);
//         }

//         if (decoded_id) {
//           const for_Update_User = await prisma.user.update({
//             where: {
//               id: decoded_id,
//             },
//             data: {
//               First_Name: input["input"]["firstName"],
//               Last_Name: input["input"]["lastName"],
//               Email: input["input"]["Email"],
//               Password: input["input"]["Password"],
//               Deleted: input["input"]["Deleted"],
//               // userImage: input["input"]["userImage"] ,
//               User_Image: path,
//               // userType: input["input"]["userType"],
//             },
//           });
//           return for_Update_User;
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //////for Delete User/////

//     async deleteUser(root, input) {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         console.log(decoded.User_Type)
//         console.log(decoded.userType);
//         const decoded_id = input.userId.id;
//         console.log(decoded_id);
       
//         if (decoded_id && decoded.User_Type == "admin") {
//           const for_delete_User = await prisma.user.update({
//             where: {
//               id: input["input"]["id"],
//             },
//             data: {
//               Deleted: true,
//             },
//           });
//           console.log(for_delete_User);
//           return "Deleted";
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //////for Login/////
//     async Login(root, input) {
//       try {
//         const Email = input["input"]["Email"];
//         const Password = input["input"]["Password"];
//         const for_login = await prisma.user.findUnique({
//           where: {
//             Email: Email,
//           },
//         });

//         if (!Password) {
//           console.log("hello");
//           throw new Error("All input is required");
//         }

//         if ((await bcrypt.compare(Password, for_login.Password)) == true) {
//           const for_update_token = await prisma.user.update({
//             where: {
//               id: for_login.id,
//             },
//             data: {
//               token: jwt.sign(
              
//                 {
//                   id: for_login.id,
//                   Email: for_login.Email,
//                  User_Type: for_login.User_Type,
//                 },
//                 process.env.TOKEN_KEY,
//                 {
//                   expiresIn: "1d",
//                 }
//               ),
//             },
//           });
//           console.log(for_login.User_Type);
//           // console.log(for_login.userType);
//           return for_update_token;
//           //console.log(for_update_token);
//           //  throw new response (token)

//           //  return token
//         } else {
//           throw new Error("Password Incorrect");
//         }
//         // // console.log(for_login);
//         // return (for_update_token);
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     async sendEmail(root, input) {
//       try {
//         const Email = input["input"]["Email"];
//         console.log(Email);
//         const transporter = nodemailer.createTransport(
//           smtpTransport({
//             service: "gmail",
//             host: "smtp.gmail.com",
//             auth: {
//               user: "razorshariq@gmail.com",
//               pass: "xhkjchgrxezlsnvz",
//             },
//           })
//         );
//         const mailOptions = {
//           from: "fizzafatima066@gmail.com",
//           to: Email,
//           subject: "Password Reset",
//           text: "That was easy!",
//           html: `<a href="localhost:3001/forgetpassword?> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword? </a>`,
//         };

//         transporter.sendMail(mailOptions, function (error, info) {
//           if (error) {
//             console.log(error);
//           } else {
//             console.log("Email sent: " + info.response);
//           }
//         });
//       } catch (error) {
//         return error;
//       }
//     },
//     //////for Forget Passwordr/////
//     async forgetPassword(root, input) {
//       try {
//         //  const Email = input["input"]["Email"]

//         const userEmail = await prisma.user.findUnique({
//           where: {
//             Email: input["input"]["Email"],
//           },
//         });
//         console.log(userEmail);
//         if (userEmail) {
//           if (!userEmail) {
//             throw new Error("please verify your email");
//           }
//           if (userEmail.Deleted == false) {
//             const tokenss = jwt.sign(
//               {
//                 id: userEmail.id,
//                 Email: userEmail.Email,
//               },
//               process.env.TOKEN_KEY,

//               {
//                 expiresIn: "2h",
//               }
//             );
//             var token = tokenss;
//             console.log(token);
//             // sendEmail(req, token);
//             const transporter = nodemailer.createTransport(
//               smtpTransport({
//                 service: "gmail",
//                 host: "smtp.gmail.com",
//                 auth: {
//                   user: "razorshariq@gmail.com",
//                   pass: "xhkjchgrxezlsnvz",
//                 },
//               })
//             );
//             const mailOptions = {
//               from: "razorshariq@gmail.com",
//               to: userEmail.Email,
//               subject: "Password Reset",
//               text: "That was easy!",

//               // html: "<p> hello</p>",
//               html: `<a href="localhost:3001/forgetpassword?token=${token}"> please click the link and reset your password or visit this link http://localhost:3030/forgetpassword?token=${token} </a>`,
//             };

//             transporter.sendMail(mailOptions, function (error, info) {
//               if (error) {
//                 console.log(error);
//               } else {
//                 console.log("Email sent: " + info.response);
//               }
//             });
//             console.log("pls check ur mail");
//             return "Check Your Mail";
//           }
//           if (userEmail.Deleted == true) {
//             console.log("user not found");
//             throw new Error("user profile not found ");
//           }
//         } else {
//           console.log("not found");
//           throw new Error("NOT FOUND");
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //////for Reset Password/////

//     async resetPassword(root, input) {
//       const config = process.env;

//       try {
//         console.log(input);
//         const token = input["input"]["token"];
//         console.log(token);
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         const userId = decoded.id;
//         console.log(userId);
//         // var Email = input["input"]["Email"];
//         var Password = input["input"]["Password"];

//         var encryptedPassword = await bcrypt.hash(Password, 10);
//         const for_reset_password = await prisma.user.update({
//           where: {
//             id: userId,
//           },
//           data: {
//             Password: encryptedPassword,
//           },
//         });

//         console.log("Password Reset");
//         return "Password Reset";
//       } catch (error) {
//         console.log(error);
//       }
//     },

//     //----------------------------------------------- VIRTUAL MACHINE-----------------------------------------------//

//     //////for Create VM/////

//     async createVM(root, input, context) {
//       try {
//         //for Image
//         const path = "app/VM_image/" + Date.now() + ".jpeg";
//         const VM_Image = input["input"]["vmImage"];
//         //  console.log("HELLO", VM_Image);
//         if (VM_Image) {
//           var base64Data = await VM_Image.replace(
//             /^data:([A-Za-z-+/]+);base64,/,
//             ""
//           );
//           //console.log("ABC", base64Data);
//           fs.writeFileSync(path, base64Data, { encoding: "base64" });
//           console.log(path);
//         }

//         //for token
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         console.log("hello", input.userId.id);
//         console.log((input.userId = decoded));

//         if (decoded_id) {
//           const VM_create = await prisma.virtualMachine.create({
//             data: {
//               userId: decoded_id,
//               VirtualMachine_Name: input["input"]["virtualMachineName"],
//               Title: input["input"]["Title"],
//               Description: input["input"]["Description"],
//               Status: input["input"]["Status"],
//               VM_Image: path,
//               Config: input["input"]["Config"],
//             },
//             select: {
//               id: true,
//               GU_ID: true,
//               VirtualMachine_Name: true,
//               Status: true,
//               Description: true,
//               Status: true,
//               Config: true,
//               VM_Image: true,
//             },
//           });
//           console.log(VM_create);
//           return VM_create;
//           //}
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //////for Update VM/////

//     async upadteVM(root, input) {
//       try {
//         // for image
//         const path = "app/VM_image/" + Date.now() + ".jpeg";
//         const VM_Image = input["input"]["vmImage"];
//         //  console.log("HELLO", VM_Image);
//         if (VM_Image) {
//           var base64Data = await VM_Image.replace(
//             /^data:([A-Za-z-+/]+);base64,/,
//             ""
//           );
//           fs.writeFileSync(path, base64Data, { encoding: "base64" });
//           console.log(path);
//         }
//         //for token
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;
//         console.log("hello", input.userId.id);
//         console.log((input.userId = decoded));

//         if (decoded_id) {
//           const id = input["input"]["id"];
//           const for_updating_vm = await prisma.virtualMachine.findUnique({
//             where: {
//               id: id,
//             },
//             select: {
//               id: true,
//               VirtualMachine_Name: true,
//               user: {
//                 select: {
//                   id: true,
//                   Email: true,
//                 },
//               },
//             },
//           });

//           if (
//             for_updating_vm.user.id == decoded_id ||
//             decoded.userType == "admin"
//           ) {
//             const for_Update = await prisma.virtualMachine.update({
//               where: {
//                 id: input["input"]["id"],
//               },
//               data: {
//                 VirtualMachine_Name: input["input"]["virtualMachineName"],
//                 Title: input["input"]["Title"],
//                 Description: input["input"]["Description"],
//                 Status: input["input"]["Status"],
//                 userId: input["input"]["userId"],
//                 Config: input["input"]["Config"],
//                 VM_Image: path,
//               },
//               select: {
//                 id: true,
//                 VirtualMachine_Name: true,
//                 Description: true,
//                 Status: true,
//                 Config: true,
//                 Title: true,
//                 VM_Image: true,
//               },
//             });
//             console.log(for_Update);
//             return for_Update;
//           } else {
//             throw new Error("Error");
//           }
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     ///// For Delete Virtual Machine //////////////
//     async deleteVM(root, input) {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;

//         if (decoded_id) {
//           const id = input["input"]["id"];
//           console.log(id.length);
//           //for (var i = id.length - 1; i >= 0; i++) {
//           const for_delete_vm = await prisma.virtualMachine.findMany({
//             where: {
//               //  user: decoded_id,
//               id: { in: id },
//               userId: decoded_id,
//             },
//             select: {
//               id: true,
//               VirtualMachine_Name: true,
//               user: {
//                 select: {
//                   id: true,
//                   Email: true,
//                 },
//               },
//               Notification: {
//                 select: {
//                   id: true,
//                   // message: true
//                 },
//               },
//             },
//           });
//           console.log(for_delete_vm);
//           console.log(for_delete_vm.length);
//           //}
//           // console.log(decoded_id);
//           for (var i = for_delete_vm.length; i >= 0; i++) {
//             console.log({ in: id });
//             console.log(i);
//             if (
//               for_delete_vm
//               //.user.id == decoded_id ||
//               // decoded.userType == "admin"
//             ) {
//               const for_not = await prisma.notification.deleteMany({
//                 where: {
//                   vm_id: { in: id },
//                   userId: decoded_id,
//                 },
//               });
//               console.log(for_not);
//               const delete_vm_id = await prisma.virtualMachine.deleteMany({
//                 where: {
//                   id: { in: id },
//                   userId: decoded_id,
//                 },
//               });
//               console.log(delete_vm_id);
//               if (delete_vm_id) {
//                 console.log("del");
//               }
//               return "VM_Deleted";
//             } else {
//               throw new Error("ERROR");
//             }
//             return for_delete_vm;
//           }
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     async Upload_Image(root, input) {
//       try {
//         const path = "app/VM_image/" + Date.now() + ".jpeg";
//         const VM_Image = input["input"]["VM_Image"];
//         var base64Data = VM_Image.replace(/^data:([A-Za-z-+/]+);base64,/, "");
//         const buffer = new Buffer.from(base64Data, "base64");
//         fs.writeFileSync("new-path.jpg", buffer);
//         console.log(fs.writeFileSync("new-path.jpg", buffer));
//         fs.writeFileSync(path, base64Data, { encoding: "base64" });
//         console.log(path);
//         return path;
//       } catch (error) {
//         console.log(error);
//       }
//     },

//     async  forStatus(root, input) {
//       try {
//         token = input["input"]["token"];
//         const decoded = jwt.verify(token, config.TOKEN_KEY);
//         input.userId = decoded;
//         const decoded_id = input.userId.id;

//         if (decoded_id) {
//           const id = input["input"]["id"];
//           const button = input["input"]["button"];
//           const for_find_status_id = await prisma.virtualMachine.findUnique({
//             where: {
//               id: id,
//             },
//           });
//           if (for_find_status_id.userId == decoded_id) {
//             if (button == true) {
//               const change_status = await prisma.virtualMachine.update({
//                 where: {
//                   id: for_find_status_id.id,
//                 },
//                 data: {
//                   Status: true,
//                 },
//               });
//               console.log("change_status");

//               return "Status Updated";
//             }

//             if (button == false) {
//               const off_status = await prisma.virtualMachine.update({
//                 where: {
//                   id: for_find_status_id.id,
//                 },
//                 data: {
//                   Status: false,
//                 },
//               });
//               console.log(off_status);
//               return "Status Updated";
//             }
//           } else {
//             throw new Error("Invalid Token");
//           }
//         }
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //----------------------------------------------- NOTIFICATION-----------------------------------------------------//

//     // FOR ADD NOTIFICATION
//     async addNotification(root, input) {
//       try {
//         const for_notification = await prisma.notification.create({
//           data: {
//             Message: input["input"]["Message"],
//             userId: input["input"]["userId"],
//             vm_id: input["input"]["vmId"],
//             Readed: input["input"]["Readed"],
//           },
//         });
//         console.log(for_notification);
//         return for_notification;
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //FOR UPDATE NOTIFICATION
//     async updateNotification(root, input) {
//       try {
//         const for_notification_update = await prisma.notification.updateMany({
//           where: {
//             userId: input["input"]["userId"],
//           },
//           data: {
//             Readed: input["input"]["Readed"],
//           },
//         });

//         console.log(for_notification_update);
//         return "Updated";
//       } catch (error) {
//         return error;
//       }
//     },
//     //FOR DELETE NOTIFICATION
//     async deleteNotification(root, input) {
//       try {
//         const for_delete_notification = await prisma.notification.delete({
//           where: {
//             id: input["input"]["id"],
//           },
//         });
//         return "Deleted";
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//     //-------------------------------------------------IOS----------------------------------------------------//
//     // fOR Create IOS

//     async createIOS(root, input) {
//       try {
//         const for_create_IOS = await prisma.IOS.create({
//           data: {
//             Name: input["input"]["Name"],
//             Type: input["input"]["Type"],
//             userId: input["input"]["userId"],
//             createdAt: input["input"]["createdAt"],
//             Size: input["input"]["Size"],
//           },
//         });
//         return for_create_IOS;
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },

//     //FOR DELETE IOS
//     async deleteIOS(root, input) {
//       try {
//         const for_delete_IOS = await prisma.IOS.delete({
//           where: {
//             id: input["input"]["id"],
//           },
//         });
//         console.log(for_delete_IOS);
//         return "IOS Deleted";
//       } catch (error) {
//         console.log(error);
//         return error;
//       }
//     },
//   },
// };
// module.exports = resolvers;
