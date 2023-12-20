import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forUpdateNotification = {
  Mutation: {

    async updateNotification (root, input) {
      try {
        await prisma.notification.updateMany({
          where: {
            userId: input.input.userId
          },
          data: {
            readed: input.input.readed
          }
        })
        return 'Updated'
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forUpdateNotification
