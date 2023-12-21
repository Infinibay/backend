import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import isAuthForUser from '@services/isAuthForUser'
const prisma = new PrismaClient()

const forDeleteStorage = {
  Mutation: {
    async deleteStoragePool(root: any, input: any) {
      try {
        const token = input.input.token
        const id = input.input.id
        const forId = isAuthForUser(token).id
        const forFindStorage = await prisma.storage.findFirst({
          where: {
            id
          },
          select: {
            id: true,
            userId: true
          }
        })
        if (forFindStorage && forFindStorage.userId === forId) {
          const forDeleteStorage = await prisma.storage.delete({
            where: {
              id
            }
          })
          if (forDeleteStorage !== null) {
            await prisma.disk.updateMany({
              where: {
                storageId: id
              },
              data: {
                storageId: null
              }
            })
          }
        }
        return 'deleted'
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('deleted Failed', {
          extensions: {
            StatusCode: 400
          }
        })
      }
    }
  }
}
export default forDeleteStorage
