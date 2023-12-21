import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const createDisk = {
  Mutation: {
    async createDisk(root: any, input: any) {
      try {
        const forCreateDisk = await prisma.disk.create({
          data: {
            diskName: input.input.diskName,
            diskSize: input.input.diskSize,
            storageId: input.input.storageId
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true

          }
        })
        return forCreateDisk
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
export default createDisk
