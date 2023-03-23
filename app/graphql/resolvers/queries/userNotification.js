import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const forUserNotification = {
  Query: {
    getUserNotification: async (root, input) => {
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
      } catch (error) {
        logger.log(error)
        throw new GraphQLError('Please enter valid credentials ', {
          extensions: {
            StatusCode: 401,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forUserNotification
