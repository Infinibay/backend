import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import AuthForBoth from '@services/isAuthForBoth'

const prisma = new PrismaClient()

const forUpdateStorage = {
  Mutation: {
    async updateStorage(root: any, input: any) {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        const forFindUserStorage: any = await prisma.storage.findUnique({
          where: {
            id: input.input.id
          },
          select: {
            id: true,
            userId: true,
            storageName: true,
            storageSize: true,
            storageType: true
          }
        })
        if (forFindUserStorage.userId === forId) {
          const forUpdate = await prisma.storage.update({
            where: {
              id: forFindUserStorage.id
            },
            data: {
              storageName: input.input.storageName,
              storageSize: input.input.storageSize,
              storageType: input.input.storageType
            },
            select: {
              userId: true,
              storageName: true,
              storageSize: true,
              storageType: true,
              id: true
            }
          })

          return forUpdate
        } else {
          throw new Error('Error')
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

export default forUpdateStorage
