import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forGetAssignedDisk = {
  Query: {
    getAssignedDisk: async (root: any) => {
      try {
        const AssignedDisk = await prisma.disk.findMany({
          where: {
            storageId: {
              not: null
            }
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true
          }
        })
        return AssignedDisk
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

export default forGetAssignedDisk;