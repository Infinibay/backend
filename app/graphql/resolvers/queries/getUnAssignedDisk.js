import { PrismaClient } from '@prisma/client'
import logger from '../../../../logger.js'
import { GraphQLError } from 'graphql'
const prisma = new PrismaClient()

const forGetUnAssignedDisk = {
  Query: {
    getUnAssignedDisk: async (root, input) => {
      try {
        const DiskUnAssigned = await prisma.disk.findMany({
          where: {
            storageId: null
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true

          }
        })
        return DiskUnAssigned
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('failed to get Details ', {
          extensions: {
            StatusCode: 400
          }
        })
      }
    }
  }
}

export default forGetUnAssignedDisk
