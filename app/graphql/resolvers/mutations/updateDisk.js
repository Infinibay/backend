import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'//
// import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const forUpdateaDisk = {
  Mutation: {
    async updateDisk (root, input) {
      try {
        // const token = input.input.token
        // AuthForBoth(token)
        // const forId = AuthForBoth(token).id

        // const forFindUserDisk = await prisma.disk.findUnique({
        //   where: {
        //     id: input.input.id
        //   },
        //   select: {
        //     id: true,
        //     userId: true,
        //     diskName: true,
        //     diskSize: true,
        //     storageId: true
        //   }
        // })

        // if (forFindUserDisk.userId === forId) {
        const forUpdate = await prisma.disk.update({
          where: {
            id: input.input.id
          },
          data: {
            diskName: input.input.diskName,
            diskSize: input.input.diskSize
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true
          }
        })
        return forUpdate
        // } else {
        //   throw new Error('Error')
        // }
      } catch (error) {
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

export default forUpdateaDisk
