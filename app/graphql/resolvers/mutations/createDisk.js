import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const createDisk = {
  Mutation: {
    async createDisk (root, input) {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        const forCreateDisk = await prisma.disk.create({
          data: {
            userId: forId,
            diskName: input.input.diskName,
            diskSize: input.input.diskSize,
            storageId: input.input.storageId
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            userId: true,
            storageId: true

          }
        })
        return forCreateDisk
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
export default createDisk
