
import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import logger from '@main/logger'
import forDeleteFunction from '@services/deleteVMFucntions'

const prisma = new PrismaClient()

const deleteVMResolvers = {
  Mutation: {
    async deleteVM(root: any, input: any) {
      try {
        const token = input.input.token
        const forID = AuthForBoth(token)
        const getId = forID.id
        if (getId) {
          /// ////-----------for Admin-----------------------////////
          if (forID.userType === 'admin') {
            const id = input.input.id
            const forDeleteVM = await prisma.virtualMachine.findMany({
              where: {
                id: { in: id }
              },
              select: {
                id: true,
                virtualMachineName: true,
                user: {
                  select: {
                    id: true,
                    eMail: true
                  }
                },
                notification: {
                  select: {
                    id: true
                  }
                }
              }
            })
            for (let i = 0; i < forDeleteVM.length; i++) {
              if (forDeleteVM[i]) {
                const forName = forDeleteVM[i].virtualMachineName
                const reqq: any = await forDeleteFunction(forName)
                if (reqq.status === true) {
                  await prisma.notification.deleteMany({
                    where: {
                      vmId: { in: id }
                    }
                  })
                  await prisma.virtualMachine.deleteMany({
                    where: {
                      id: { in: id }
                    }
                  })
                  return 'VM_Deleted'
                } else {
                  throw new GraphQLError('Failed to Delete', {
                    extensions: {
                      StatusCode: 404,
                      code: 'Failed '
                    }
                  })
                }
              }
            }
          }

          // ............for user............///
          if (forID.id && forID.userType === 'user') {
            const id = input.input.id
            const forDeleteVM = await prisma.virtualMachine.findMany({
              where: {
                id: { in: id },
                userId: forID.id
              },
              select: {
                id: true,
                virtualMachineName: true,
                user: {
                  select: {
                    id: true,
                    eMail: true
                  }
                },
                notification: {
                  select: {
                    id: true
                  }
                }
              }
            })
            for (let i = 0; i < forDeleteVM.length; i++) {
              if (forDeleteVM[i]) {
                const forName = forDeleteVM[i].virtualMachineName
                const reqq: any = await forDeleteFunction(forName)
                if (reqq.status === true) {
                  await prisma.notification.deleteMany({
                    where: {
                      vmId: { in: id },
                      userId: forID.id
                    }
                  })
                  await prisma.virtualMachine.deleteMany({
                    where: {
                      id: { in: id },
                      userId: forID.id
                    }
                  })
                  return 'VM_Deleted'
                } else {
                  throw new GraphQLError('Failed to Delete', {
                    extensions: {
                      StatusCode: 404,
                      code: 'Failed '
                    }
                  })
                }
              }
            }
          }
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Delete', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    }
  }
}

export default deleteVMResolvers
