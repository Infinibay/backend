import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import isAuthorBoth from '@services/isAuthForBoth'
import logger from '@main/logger'

const prisma = new PrismaClient()

async function getStorageById(id: any) {
  return await prisma.storage.findUnique({
    where: {
      id: String(id)
    },
    select: {
      id: true,
      storageName: true,
      storageSize: true,
      storageType: true,
      userId: true
    }
  });
}

async function getDisksByStorageId(storageId: any) {
  return await prisma.disk.findMany({
    where: {
      storageId: storageId || null
    },
    select: {
      id: true,
      diskName: true,
      diskSize: true
    }
  });
}

async function getStoragesByUserId(userId: any) {
  return await prisma.storage.findMany({
    where: {
      userId: userId
    },
    select: {
      id: true,
      storageName: true,
      storageSize: true,
      storageType: true,
      userId: true
    }
  });
}

const StorageDetailsDisk = {
  Query: {
    getStorageDetailsDisk: async (_root: any, input: any) => {
      try {
        const token = input.input.token
        const forUserId = isAuthorBoth(token).id
        const forStorageId = input.input.id
        if (forStorageId) {
          const forGetStorages: any[] = []
          const findByStorageId = await getStorageById(forStorageId)
          if (findByStorageId) {
            forGetStorages.push(findByStorageId);
          }
          const findDiskByStorageId = await getDisksByStorageId(findByStorageId?.id)
          if (findByStorageId && findByStorageId.userId === forUserId) {
            return {
              storage: forGetStorages,
              disk: findDiskByStorageId
            }
          }
        } else {
          const forgetStorage: any[] = []
          const forpush: any[] = []
          const findByStorageId: any = await getStoragesByUserId(forUserId)
          forgetStorage.push(...findByStorageId)
          for (const disk of findByStorageId) {
            const findDiskByStorageId = await getDisksByStorageId(disk.id)
            forpush.push(...findDiskByStorageId)
          }
          console.log(forgetStorage, forpush)
          return {
            storage: forgetStorage,
            disk: forpush
          }
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

export default StorageDetailsDisk;
