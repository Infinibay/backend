import { PrismaClient } from '@prisma/client'
import logger from '../../../../logger.js'
import { GraphQLError } from 'graphql'
const prisma = new PrismaClient()

const forGetAssignedDisk = {
  Query: {
    getAssignedDisk: async (root) => {
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
        console.log(AssignedDisk)
        return AssignedDisk
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

export default forGetAssignedDisk
