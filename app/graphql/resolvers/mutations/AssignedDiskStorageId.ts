import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forAssignedDiskStorageID = {
  Mutation: {
    async UpdateDiskStorageId(root: any, input: any) {
      try {
        const ids = input.input.id
        const AssignDiskStorage = await prisma.disk.findMany({
          where: {
            id: { in: ids }
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true
          }
        })
        const updateList = []
        for (const forlist of AssignDiskStorage) {
          await prisma.disk.update({
            where: {
              id: forlist.id
            },
            data: {
              storageId: input.input.storageId
            },
            select: {
              diskName: true,
              id: true,
              diskSize: true,
              storageId: true
            }

          })
          updateList.push(forlist.id)
        }
        return 'Update Disk'
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
export default forAssignedDiskStorageID
