import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const fordeleteNotification = {
  Mutation: {
    async deleteNotification(root: any, input: any) {
      try {
        await prisma.notification.delete({
          where: {
            id: input.input.id
          }
        })
        return 'Deleted'
      } catch (error: any) {
        logger.error(error, error.message)
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
export default fordeleteNotification
