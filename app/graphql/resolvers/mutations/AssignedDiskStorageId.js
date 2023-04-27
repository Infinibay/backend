import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forAssignedDiskStorageID = {
  Mutation: {
    async UpdateDiskStorageId (root, input) {
      try {
        // const token = input.input.token
        // AuthForBoth(token)
        // const forId = AuthForBoth(token).id
        // const ids = input.input.id
        // const findDiskStorage = await prisma.disk.findMany({
        //   where: {
        //     id: { in: ids }
        //   },
        //   select: {
        //     id: true,
        //     userId: true,
        //     diskName: true,
        //     diskSize: true,
        //     storageId: true
        //   }
        // })
        // console.log(findDiskStorage)
        // const updateList = []
        // for (const forlist of findDiskStorage) {
        //   if (forlist.userId === forId) {
        //     const forget = await prisma.disk.update({
        //       where: {
        //         id: forlist.id
        //       },
        //       data: {
        //         storageId: input.input.storageId
        //       },
        //       select: {
        //         id: true,
        //         userId: true,
        //         diskName: true,
        //         diskSize: true,
        //         storageId: true
        //       }
        //     })
        //     logger.log(forget)
        //     updateList.push(forlist.id)
        //   }
        // }
        // return 'Updated'

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
        console.log(AssignDiskStorage)
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
export default forAssignedDiskStorageID
