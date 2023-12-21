import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forUpdateNotification = {
  Mutation: {
    async updateNotification(root: any, input: any) {
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
      } catch (error: any) {
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
export default forUpdateNotification;