import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forUpdateaDisk = {
  Mutation: {
    async updateDisk(root: any, input: any) {
      try {
        const forUpdate = await prisma.disk.update({
          where: {
            id: input.input.id
          },
          data: {
            diskName: input.input.diskName,
            diskSize: input.input.diskSize
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true
          }
        })
        return forUpdate
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed', {
          extensions: {
            StatusCode: 400
          }
        })
      }
    }
  }
}

export default forUpdateaDisk
