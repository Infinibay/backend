import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const allUserVMResolver = {
  Query: {
    getUserAllVM: async (_parent, input) => {
      try {
        const token = input.input.token
        const status = input.input.status
        AuthForBoth(token)
        const forUserId = AuthForBoth(token).id
        if (forUserId) {
          const forUserVM = await prisma.virtualMachine.findMany({
            where: {
              userId: forUserId
            },
            select: {
              virtualMachineName: true,
              vmImage: true,
              title: true,
              status: true,
              guId: true,
              config: true,
              description: true,
              id: true,
              user: {
                select: {
                  id: true
                }
              }
            }
          })
          if (status) {
            const forSearchWithStatus = await prisma.virtualMachine.findMany({
              where: {
                userId: forUserId,
                status: {
                  equals: status
                }
              }
            })
            return forSearchWithStatus
          }
          return forUserVM
        }
      } catch (error) {
        logger.error(error, error.message)
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
  }
}
export default allUserVMResolver
