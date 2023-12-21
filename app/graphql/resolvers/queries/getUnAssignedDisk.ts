import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forGetUnAssignedDisk = {
  Query: {
    getUnAssignedDisk: async (root: any, _input: any) => {
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
      } catch (error: any) {
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

export default forGetUnAssignedDisk;
