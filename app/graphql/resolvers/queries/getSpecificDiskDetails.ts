import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
// import AuthForBoth from '../../../services/isAuthForBoth.js'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forSpecificDiskDetail = {
  Query: {
    getSpecificDiskDetails: async (root, input) => {
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
        // }
      } catch (error) {
        console.log(error)
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
