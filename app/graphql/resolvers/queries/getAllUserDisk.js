import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const getAllUserDisk = {
  Query: {
    getDiskDetails: async (root, input) => {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        const forGetList = await prisma.disk.findMany({
          where: {
            userId: forId
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true
          }
        })
        return forGetList
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to get Details ', {
          extensions: {
            StatusCode: 400
          }
        })
      }
    }
  }
}
export default getAllUserDisk
