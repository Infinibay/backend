import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import logger from '@main/logger'

const prisma = new PrismaClient()

const userVirtualMachine = {
  Query: {
    getUserVM: async (root: any, input: any) => {
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
      } catch (error: any) {
        logger.error(error, error.message)
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
