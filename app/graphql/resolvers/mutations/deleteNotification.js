import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const fordeleteNotification = {
  Mutation: {
    async deleteNotification (_root, input) {
      try {
        await prisma.notification.delete({
          where: {
            id: input.input.id
          }
        })
        return 'Deleted'
      } catch (error) {
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
