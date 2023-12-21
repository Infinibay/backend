import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const createNotification = {
  Mutation: {
    async addNotification(root: any, input: any) {
      try {
        const forNotification = await prisma.notification.create({
          data: {
            message: input.input.message,
            userId: input.input.userId,
            vmId: input.input.vmId,
            readed: input.input.readed
          }
        })
        return forNotification
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Create', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    }
  }
}

export default createNotification
