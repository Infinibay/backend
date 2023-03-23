import AuthForBoth from '../../../services/isAuthForBoth.js'
import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import forDeleteFunction from './deleteVMFunctions.js'
const prisma = new PrismaClient()

const deleteVMResolvers = {
  Mutation: {
    async deleteVM (root, input) {
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
                const reqq = await forDeleteFunction(forName)
                if (reqq.data.result.status === true) {
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
                const reqq = await forDeleteFunction(forName)
                if (reqq.data.result.status === true) {
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
      } catch (error) {
        logger.error(error)
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
