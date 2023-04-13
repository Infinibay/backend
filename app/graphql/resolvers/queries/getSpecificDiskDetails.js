import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forSpecificDiskDetail = {
  Query: {
    getSpecificDiskDetails: async (root, input) => {
      try {
        const token = input.input.token
        const id = input.input.id
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        if (forId) {
          const forGetSpecificDisk = await prisma.disk.findMany({
            where: {
              id,
              userId: forId
            },
            select: {
              id: true,
              diskName: true,
              diskSize: true
            }
          })
          return forGetSpecificDisk
        }
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
export default forSpecificDiskDetail
