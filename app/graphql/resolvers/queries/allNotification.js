import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const allNotification = {
  Query: {
    getNotification: async () => {
      try {
        const forGetNotification = await prisma.notification.findMany({})
        return forGetNotification
      } catch (error) {
        logger.error(error)
        throw new GraphQLError('failed to get all notifications ', {
          extensions: {
            StatusCode: 500,
            code: 'Failed '
          }
        })
      }
    }
  }
}

export default allNotification
