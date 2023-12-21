
import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import AuthForBoth from '@services/isAuthForBoth'

const prisma = new PrismaClient()

interface StorageDetailsInput {
  input: {
    token: string;
  };
}

const getStorageDetails = {
  Query: {
    getStorageList: async (_root: any, input: StorageDetailsInput) => {
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
      } catch (error: any) {
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

export default getStorageDetails;
