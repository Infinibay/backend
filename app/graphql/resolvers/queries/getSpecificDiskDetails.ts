import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
const prisma = new PrismaClient()

const forSpecificDiskDetail = {
  Query: {
    getSpecificDiskDetails: async (root: any, input: any) => {
      try {
        const forGetSpecificDisk = await prisma.disk.findUnique({
          where: {
            id: input.input.id
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true
          }
        })
        return forGetSpecificDisk
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
export default forSpecificDiskDetail
