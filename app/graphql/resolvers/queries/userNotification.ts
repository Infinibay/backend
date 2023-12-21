import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import AuthForBoth from '@services/isAuthForBoth'

const prisma = new PrismaClient()

const forUserNotification = {
  Query: {
    getUserNotification: async (root: any, input: any) => {
      try {
        const token = input.input.token
        const forid = AuthForBoth(token).id
        if (forid) {
          const userNotification = await prisma.notification.findMany({
            where: {
              userId: forid
            }
          })
          return userNotification
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Please enter valid credentials ', {
          extensions: {
            StatusCode: 401
          }
        })
      }
    }
  }
}
export default forUserNotification
