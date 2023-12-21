import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import logger from '@main/logger'

const prisma = new PrismaClient()

const createStorageResolver = {
  Mutation: {
    async createStorage(root: any, input: any) {
      try {
        const token = input.input.token
        const forId = AuthForBoth(token).id
        if (token) {
          const forcreateStroage = await prisma.storage.create({
            data: {
              storageName: input.input.storageName,
              storageType: input.input.storageType,
              storageSize: input.input.storageSize,
              userId: forId
            },
            select: {
              id: true,
              storageName: true,
              storageType: true,
              storageSize: true,
              userId: true

            }
          })
          return forcreateStroage
        }
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

export default createStorageResolver
