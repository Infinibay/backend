import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const userVirtualMachine = {
  Query: {
    getUserVM: async (_parent, input) => {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forID = AuthForBoth(token).id
        if (forID) {
          const forUserVM = await prisma.user.findUnique({
            where: {
              id: forID
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              eMail: true,
              userImage: true,
              userType: true,
              notification: {
                select: {
                  id: true,
                  message: true
                }
              },
              ISO: {
                select: {
                  id: true,
                  name: true
                }
              },
              VM: {
                select: {
                  virtualMachineName: true,
                  vmImage: true
                }
              },
              _count: {
                select: {
                  VM: true,
                  notification: true,
                  ISO: true
                }
              }
            }
          })
          return forUserVM
        }
      } catch (error) {
        logger.error(error)
        throw new GraphQLError('Something went wrong please check again', {
          extensions: {
            StatusCode: 500
          }
        })
      }
    }
  }
}
export default userVirtualMachine
