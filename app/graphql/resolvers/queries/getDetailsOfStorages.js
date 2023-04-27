import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import isAuthorBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const StorageDetailsDisk = {
  Query: {
    getStorageDetailsDisk: async (root, input) => {
      try {
        const token = input.input.token
        const forUserId = isAuthorBoth(token).id
        const forStorageId = input.input.id
        if (forStorageId) {
          const forGetStorages = []
          const findByStorageId = await prisma.storage.findUnique({
            where: {
              id: input.input.id
            },
            select: {
              id: true,
              storageName: true,
              storageSize: true,
              storageType: true,
              userId: true
            }
          })
          forGetStorages.push(findByStorageId)
          const findDiskByStorageId = await prisma.disk.findMany({
            where: {
              storageId: findByStorageId.id
            },
            select: {
              id: true,
              diskName: true,
              diskSize: true
            }
          })
          if (findByStorageId.userId === forUserId) {
            return {
              storage: forGetStorages,
              disk: findDiskByStorageId
            }
          }
        } else {
          const forgetStorage = []
          const forpush = []
          const findByStorageId = await prisma.storage.findMany({
            where: {
              userId: forUserId
            },
            select: {
              id: true,
              storageName: true,
              storageSize: true,
              storageType: true,
              userId: true
            }
          })
          forgetStorage.push(...findByStorageId)
          for (const disk of findByStorageId) {
            const findDiskByStorageId = await prisma.disk.findMany({
              where: {
                storageId: disk.id
              },
              select: {
                id: true,
                diskName: true,
                diskSize: true
              }
            })
            forpush.push(...findDiskByStorageId)
          }
          console.log(forgetStorage, forpush)
          return {
            storage: forgetStorage,
            disk: forpush
          }
        }
      } catch (error) {
        console.log(error)
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

export default StorageDetailsDisk
