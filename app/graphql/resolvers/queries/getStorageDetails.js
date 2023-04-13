import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const getStorageDetails = {
  Query: {
    getStorageList: async (root, input) => {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        const forGetList = await prisma.storage.findMany({
          where: {
            userId: forId
          },
          select: {
            id: true,
            storageName: true,
            storageType: true,
            storageSize: true
          }
        })
        return forGetList
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed', {
          extensions: {
            StatusCode: 400,
            code: ' Failed'
          }
        })
      }
    }
  }
}
export default getStorageDetails
