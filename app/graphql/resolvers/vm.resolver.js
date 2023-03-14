const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
const { GraphQLError } = require("graphql");
const jwt = require("jsonwebtoken");

const config = process.env;
const vm_resolvers = {
  Query: {
    //------------------------------------------ FOR VIRTUAL MACHINE----------------------------------------------- //
    //////for get User VM/////

    // getUserVM: async (parent, input) => {
    //   try {
    //     token = input["input"]["token"];
    //     const decoded = jwt.verify(token, config.TOKEN_KEY);
    //     input.userId = decoded;
    //     const decoded_id = input.userId.id;
    //     if (decoded_id) {
    //       const for_user_VM = await prisma.user.findUnique({
    //         where: {
    //           id: decoded_id,
    //         },
    //         select: {
    //           id: true,
    //           First_Name: true,
    //           Last_Name: true,
    //           Email: true,
    //           User_Image: true,
    //           User_Type: true,
    //           Notification: {
    //             select: {
    //               id: true,
    //               Message: true,
    //             },
    //           },
    //           IOS: {
    //             select: {
    //               id: true,
    //               Name: true,
    //             },
    //           },
    //           VM: {
    //             select: {
    //               VirtualMachine_Name: true,
    //               VM_Image: true,
    //             },
    //           },
    //           _count: {
    //             select: {
    //               VM: true,
    //               Notification: true,
    //               IOS: true,
    //             },
    //           },
    //         },
    //       });

    //       console.log(for_user_VM._count);
    //       console.log(for_user_VM);

    //       return for_user_VM;
    //     }
    //   } catch (error) {
    //     console.log(error);
    //     return error;
    //   }
    // },

    //////for Get Specific VM/////
    getSpecificVM: async (parent, input) => {
      try {
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        // const for_type = input.userId.userType
        console.log(decoded.userType);

        if (decoded_id && decoded.User_Type == "user") {
          const for_specific_VM = await prisma.virtualMachine.findUnique({
            where: {
              id: input["input"]["id"],
            },
            select: {
              id: true,
              VirtualMachine_Name: true,
              Description: true,
              Title: true,
              Status: true,
              Config: true,
              user: {
                select: {
                  id: true,
                  Email: true,
                },
              },
            },
          });
          if (for_specific_VM.user.id == decoded_id) {
            console.log("hello");
            console.log(for_specific_VM);
            return for_specific_VM;
          } else {
            console.log("ERRPOR");
            throw new Error("VM Not Found");
          }
        }
      } catch (error) {
        console.log(error);
        // return error;
        throw new GraphQLError(
          "Something went wrong....please try again.!!!  ",
          {
            extensions: {
              StatusCode: 400,
              code: "Failed ",
            },
          }
        );
      }
    },
    //////for get All VM/////

    getAllVM: async (root, input) => {
      try {
        token = input["input"]["token"];
        Search = input["input"]["Search"];
        Status = input["input"]["Status"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        if (decoded_id && decoded.User_Type == "admin") {
          const for_VM = await prisma.virtualMachine.findMany({
            select: {
              VirtualMachine_Name: true,
              VM_Image: true,
              Title: true,
              Status: true,
              GU_ID: true,
              Config: true,
              Description: true,
              id: true,
            },
          });
          if (Search) {
            const search_to_find = await prisma.virtualMachine.findMany({
              where: {
                VirtualMachine_Name: {
                  contains: Search,
                  mode: "insensitive",
                },
              },
            });
            console.log(search_to_find);
            return search_to_find;
          }
          if (Status) {
            const for_search_with_status = await prisma.virtualMachine.findMany(
              {
                where: {
                  Status: {
                    equals: Status,
                  },
                },
              }
            );
            console.log(for_search_with_status);
            return for_search_with_status;
          }

          // console.log(for_VM);
          return for_VM;
        }
      } catch (error) {
        console.log(error);
        //return error;
        throw new GraphQLError(
          "Something went wrong....please enter valid credentials .!!!  ",
          {
            extensions: {
              StatusCode: 401,
              code: "Failed ",
            },
          }
        );
      }
    },

    ////GET USER ALL VM
    getUserAllVM: async (parent, input) => {
      try {
        token = input["input"]["token"];
        Status = input["input"]["Status"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        if (decoded_id && decoded.User_Type == "user") {
          const for_VM = await prisma.virtualMachine.findMany({
            where: {
              userId: decoded_id,
            },
            select: {
              VirtualMachine_Name: true,
              VM_Image: true,
              Title: true,
              Status: true,
              GU_ID: true,
              Config: true,
              Description: true,
              id: true,
              user: {
                select: {
                  id: true,
                },
              },
            },
          });
          // console.log();
          //  console.log(decoded.id);
          if (Status) {
            const for_search_with_status = await prisma.virtualMachine.findMany(
              {
                where: {
                  userId: decoded_id,
                  Status: {
                    equals: Status,
                  },
                },
              }
            );
            console.log(for_search_with_status);
            return for_search_with_status;
          }

          console.log(for_VM);
          return for_VM;
        }
      } catch (error) {
        console.log(error);
        throw new GraphQLError(
          "Something went wrong....please enter valid credentials .!!!  ",
          {
            extensions: {
              StatusCode: 400,
              code: "Failed ",
            },
          }
        );
      }
    },
  },

  Mutation: {
    //----------------------------------------------- VIRTUAL MACHINE-----------------------------------------------//

    //////for Create VM/////

    async createVM(root, input, context) {
      try {
        //for Image
        const path = "app/VM_image/" + Date.now() + ".jpeg";
        const VM_Image = input["input"]["vmImage"];
        //  console.log("HELLO", VM_Image);
        if (VM_Image) {
          var base64Data = await VM_Image.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ""
          );
          //console.log("ABC", base64Data);
          fs.writeFileSync(path, base64Data, { encoding: "base64" });
          console.log(path);
        }

        //for token
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        console.log("hello", input.userId.id);
        console.log((input.userId = decoded));

        if (decoded_id) {
          const VM_create = await prisma.virtualMachine.create({
            data: {
              userId: decoded_id,
              VirtualMachine_Name: input["input"]["virtualMachineName"],
              Title: input["input"]["Title"],
              Description: input["input"]["Description"],
              Status: input["input"]["Status"],
              VM_Image: path,
              Config: input["input"]["Config"],
            },
            select: {
              id: true,
              GU_ID: true,
              VirtualMachine_Name: true,
              Status: true,
              Description: true,
              Status: true,
              Config: true,
              VM_Image: true,
            },
          });
          console.log(VM_create);
          return VM_create;
          //}
        }
      } catch (error) {
        // console.log(error);
        //return error;
        throw new GraphQLError("Failed to Create", {
          extensions: {
            StatusCode: 400,
            code: "Failed ",
          },
        });
      }
    },

    //////for Update VM/////

    async upadteVM(root, input) {
      try {
        // for image
        const path = "app/VM_image/" + Date.now() + ".jpeg";
        const VM_Image = input["input"]["vmImage"];
        //  console.log("HELLO", VM_Image);
        if (VM_Image) {
          var base64Data = await VM_Image.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ""
          );
          fs.writeFileSync(path, base64Data, { encoding: "base64" });
          console.log(path);
        }
        //for token
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;
        console.log("hello", input.userId.id);
        console.log((input.userId = decoded));

        if (decoded_id) {
          const id = input["input"]["id"];
          const for_updating_vm = await prisma.virtualMachine.findUnique({
            where: {
              id: id,
            },
            select: {
              id: true,
              VirtualMachine_Name: true,
              user: {
                select: {
                  id: true,
                  Email: true,
                },
              },
            },
          });

          if (
            for_updating_vm.user.id == decoded_id ||
            decoded.userType == "admin"
          ) {
            const for_Update = await prisma.virtualMachine.update({
              where: {
                id: input["input"]["id"],
              },
              data: {
                VirtualMachine_Name: input["input"]["virtualMachineName"],
                Title: input["input"]["Title"],
                Description: input["input"]["Description"],
                Status: input["input"]["Status"],
                userId: input["input"]["userId"],
                Config: input["input"]["Config"],
                VM_Image: path,
              },
              select: {
                id: true,
                VirtualMachine_Name: true,
                Description: true,
                Status: true,
                Config: true,
                Title: true,
                VM_Image: true,
              },
            });
            console.log(for_Update);
            return for_Update;
          } else {
            throw new Error("Error");
          }
        }
      } catch (error) {
        // console.log(error);
        // return error;
        throw new GraphQLError("Failed to Update", {
          extensions: {
            StatusCode: 404,
            code: "Failed ",
          },
        });
      }
    },

    ///// For Delete Virtual Machine //////////////
    async deleteVM(root, input) {
      try {
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;

        if (decoded_id) {
          const id = input["input"]["id"];
          console.log(id.length);
          //for (var i = id.length - 1; i >= 0; i++) {
          const for_delete_vm = await prisma.virtualMachine.findMany({
            where: {
              //  user: decoded_id,
              id: { in: id },
              userId: decoded_id,
            },
            select: {
              id: true,
              VirtualMachine_Name: true,
              user: {
                select: {
                  id: true,
                  Email: true,
                },
              },
              Notification: {
                select: {
                  id: true,
                  // message: true
                },
              },
            },
          });
          console.log(for_delete_vm);
          console.log(for_delete_vm.length);
          //}
          // console.log(decoded_id);
          for (var i = for_delete_vm.length; i >= 0; i++) {
            console.log({ in: id });
            console.log(i);
            if (
              for_delete_vm
              //.user.id == decoded_id ||
              // decoded.userType == "admin"
            ) {
              const for_not = await prisma.notification.deleteMany({
                where: {
                  vm_id: { in: id },
                  userId: decoded_id,
                },
              });
              console.log(for_not);
              const delete_vm_id = await prisma.virtualMachine.deleteMany({
                where: {
                  id: { in: id },
                  userId: decoded_id,
                },
              });
              console.log(delete_vm_id);
              if (delete_vm_id) {
                console.log("del");
              }
              return "VM_Deleted";
            } else {
              throw new Error("ERROR");
            }
          }
        }
      } catch (error) {
        // console.log(error);
        // return error;
        throw new GraphQLError("Failed to Delete", {
          extensions: {
            StatusCode: 404,
            code: "Failed ",
          },
        });
      }
    },

    async Upload_Image(root, input) {
      try {
        const path = "app/VM_image/" + Date.now() + ".jpeg";
        const VM_Image = input["input"]["VM_Image"];
        var base64Data = VM_Image.replace(/^data:([A-Za-z-+/]+);base64,/, "");
        const buffer = new Buffer.from(base64Data, "base64");
        fs.writeFileSync("new-path.jpg", buffer);
        console.log(fs.writeFileSync("new-path.jpg", buffer));
        fs.writeFileSync(path, base64Data, { encoding: "base64" });
        console.log(path);
        return path;
      } catch (error) {
        console.log(error);
      }
    },

    async forStatus(root, input) {
      try {
        token = input["input"]["token"];
        const decoded = jwt.verify(token, config.TOKEN_KEY);
        input.userId = decoded;
        const decoded_id = input.userId.id;

        if (decoded_id) {
          const id = input["input"]["id"];
          const button = input["input"]["button"];
          const for_find_status_id = await prisma.virtualMachine.findUnique({
            where: {
              id: id,
            },
          });
          if (for_find_status_id.userId == decoded_id) {
            if (button == true) {
              const change_status = await prisma.virtualMachine.update({
                where: {
                  id: for_find_status_id.id,
                },
                data: {
                  Status: true,
                },
              });
              console.log("change_status");

              return "Status Updated";
            }

            if (button == false) {
              const off_status = await prisma.virtualMachine.update({
                where: {
                  id: for_find_status_id.id,
                },
                data: {
                  Status: false,
                },
              });
              console.log(off_status);
              return "Status Updated";
            }
          } else {
            throw new Error("Invalid Token");
          }
        }
      } catch (error) {
        console.log(error);
        // return error;
        throw new GraphQLError("Failed to Update", {
          extensions: {
            StatusCode: 404,
            code: "Failed ",
          },
        });
      }
    },
  },
};
module.exports = vm_resolvers;
