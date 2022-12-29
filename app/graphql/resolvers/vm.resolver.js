const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()
const { GraphQLError } = require('graphql')
const jwt = require('jsonwebtoken')
const config = process.env
var decoded
function Auth () {
  decoded = jwt.verify(token, config.TOKEN_KEY)
  console.log(decoded, 'details')
  console.log(decoded.id, 'getid')
}
const vmResolvers = {
  Query: {
    //------------------------------------------ FOR VIRTUAL MACHINE----------------------------------------------- //
    //////for Get Specific VM/////
    getSpecificVM: async (parent, input) => {
      try {
        token = input['input']['token']
        Auth()
        if (decoded.id && decoded.User_Type == 'user') {
          const forSpecificVM = await prisma.virtualMachine.findUnique({
            where: {
              id: input['input']['id']
            },
            select: {
              id: true,
              userId: true,
              VirtualMachine_Name: true,
              Description: true,
              Title: true,
              Status: true,
              Config: true,
              user: {
                select: {
                  id: true,
                  Email: true
                }
              }
            }
          })
          if (forSpecificVM.user.id == decoded.id) {
            console.log(forSpecificVM)
            return forSpecificVM
          } else {
            throw new Error('VM Not Found')
          }
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError(
          'Something went wrong....please try again.!!!  ',
          {
            extensions: {
              StatusCode: 400,
              code: 'Failed '
            }
          }
        )
      }
    },

    //////for get All VM/////
    getAllVM: async (root, input) => {
      try {
        token = input['input']['token']
        Search = input['input']['Search']
        Status = input['input']['Status']
        Auth()
        if (decoded.id && decoded.User_Type == 'admin') {
          const forVM = await prisma.virtualMachine.findMany({
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
                  First_Name: true
                }
              }
            }
          })
          if (Search) {
            const searchToFind = await prisma.virtualMachine.findMany({
              where: {
                VirtualMachine_Name: {
                  contains: Search,
                  mode: 'insensitive'
                }
              }
            })
            console.log(searchToFind)
            return searchToFind
          }
          if (Status) {
            const forSearchWithStatus = await prisma.virtualMachine.findMany({
              where: {
                Status: {
                  equals: Status
                }
              }
            })
            console.log(forSearchWithStatus)
            return forSearchWithStatus
          }
          return forVM
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError(
          'Something went wrong....please enter valid credentials .!!!  ',
          {
            extensions: {
              StatusCode: 401,
              code: 'Failed '
            }
          }
        )
      }
    },

    ////GET USER ALL VM
    getUserAllVM: async (parent, input) => {
      try {
        token = input['input']['token']
        Status = input['input']['Status']
        Auth()
        if (decoded.id && decoded.User_Type == 'user') {
          const forUserVM = await prisma.virtualMachine.findMany({
            where: {
              userId: decoded.id
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
                  id: true
                }
              }
            }
          })
          if (Status) {
            const forSearchWithStatus = await prisma.virtualMachine.findMany({
              where: {
                userId: decoded.id,
                Status: {
                  equals: Status
                }
              }
            })
            console.log(forSearchWithStatus)
            return forSearchWithStatus
          }

          console.log(forUserVM)
          return forUserVM
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError(
          'Something went wrong....please enter valid credentials .!!!  ',
          {
            extensions: {
              StatusCode: 400,
              code: 'Failed '
            }
          }
        )
      }
    }
  },

  Mutation: {
    //----------------------------------------------- VIRTUAL MACHINE-----------------------------------------------//
    //////for Create VM/////
    async createVM (root, input, context) {
      try {
        //for Image
        const path = 'app/VM_image/' + Date.now() + '.jpeg'
        const VM_Image = input['input']['vmImage']
        //  console.log("HELLO", VM_Image);
        if (VM_Image) {
          var base64Data = await VM_Image.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ''
          )
          fs.writeFileSync(path, base64Data, { encoding: 'base64' })
          console.log(path)
        }
        //for token
        token = input['input']['token']
        Auth()
        forID = decoded.id
        console.log(forID, 'user_id')
        if (token) {
          console.log('hajbxusc')
          const VMCreate = await prisma.virtualMachine.create({
            data: {
              userId: forID,
              VirtualMachine_Name: input['input']['virtualMachineName'],
              Title: input['input']['Title'],
              Description: input['input']['Description'],
              Status: input['input']['Status'],
              VM_Image: path,
              Config: input['input']['Config']
            },
            select: {
              id: true,
              GU_ID: true,
              VirtualMachine_Name: true,
              Status: true,
              Description: true,
              Status: true,
              Config: true,
              VM_Image: true
            }
          })
          console.log(VMCreate)
          return VMCreate
        }
      } catch (error) {
        // console.log(error);
        throw new GraphQLError('Failed to Create', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    },

    //////for Update VM/////
    async upadteVM (root, input) {
      try {
        // for image
        const path = 'app/VM_image/' + Date.now() + '.jpeg'
        const VM_Image = input['input']['vmImage']
        if (VM_Image) {
          var base64Data = await VM_Image.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ''
          )
          fs.writeFileSync(path, base64Data, { encoding: 'base64' })
          console.log(path)
        }
        //for token
        token = input['input']['token']
        Auth()
        if (decoded.id) {
          const id = input['input']['id']
          const forUpdatingVM = await prisma.virtualMachine.findUnique({
            where: {
              id: id
            },
            select: {
              id: true,
              VirtualMachine_Name: true,
              user: {
                select: {
                  id: true,
                  Email: true
                }
              }
            }
          })

          if (
            forUpdatingVM.user.id == decoded.id ||
            decoded.User_Type == 'admin'
          ) {
            const forUpdate = await prisma.virtualMachine.update({
              where: {
                id: input['input']['id']
              },
              data: {
                VirtualMachine_Name: input['input']['virtualMachineName'],
                Title: input['input']['Title'],
                Description: input['input']['Description'],
                Status: input['input']['Status'],
                userId: input['input']['userId'],
                Config: input['input']['Config'],
                VM_Image: path
              },
              select: {
                id: true,
                VirtualMachine_Name: true,
                Description: true,
                Status: true,
                Config: true,
                Title: true,
                VM_Image: true
              }
            })
            console.log(forUpdate)
            return forUpdate
          } else {
            throw new Error('Error')
          }
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    },
    ///// For Delete Virtual Machine //////////////
    async deleteVM (root, input) {
      try {
        token = input['input']['token']
        Auth()
        if (decoded.id) {
          const id = input['input']['id']
          console.log(id.length)
          const forDeleteVM = await prisma.virtualMachine.findMany({
            where: {
              id: { in: id },
              userId: decoded.id
            },
            select: {
              id: true,
              VirtualMachine_Name: true,
              user: {
                select: {
                  id: true,
                  Email: true
                }
              },
              Notification: {
                select: {
                  id: true
                }
              }
            }
          })
          console.log(forDeleteVM)
          console.log(forDeleteVM.length)
          for (var i = forDeleteVM.length; i >= 0; i++) {
            console.log({ in: id })
            console.log(i)
            if (forDeleteVM) {
              const forNot = await prisma.notification.deleteMany({
                where: {
                  vm_id: { in: id },
                  userId: decoded.id
                }
              })
              console.log(forNot)
              const deleteVMId = await prisma.virtualMachine.deleteMany({
                where: {
                  id: { in: id },
                  userId: decoded.id
                }
              })
              console.log(deleteVMId)
              if (deleteVMId) {
                console.log('del')
              }
              return 'VM_Deleted'
            } else {
              throw new Error('error')
            }
            return deleteVMId
          }
        }
      } catch (error) {
        throw new GraphQLError('Failed to Delete', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    },

    async forStatus (root, input) {
      try {
        token = input['input']['token']
        Auth()
        if (decoded.id) {
          const id = input['input']['id']
          const button = input['input']['button']
          const forFindStatusID = await prisma.virtualMachine.findUnique({
            where: {
              id: id
            }
          })
          if (forFindStatusID.userId == decoded.id) {
            if (button == true) {
              const changeStatus = await prisma.virtualMachine.update({
                where: {
                  id: forFindStatusID.id
                },
                data: {
                  Status: true
                }
              })
              console.log('changeStatus')
              return 'Status Updated'
            }
            if (button == false) {
              const offStatus = await prisma.virtualMachine.update({
                where: {
                  id: forFindStatusID.id
                },
                data: {
                  Status: false
                }
              })
              console.log(offStatus)
              return 'Status Updated'
            }
          } else {
            throw new Error('Invalid Token')
          }
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    }
  }
}
module.exports = vmResolvers
