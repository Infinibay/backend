import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const forDeleteDisk = {
  Mutation: {
    async deleteDisk (root, input) {
      try {
        const token = input.input.token
        const id = input.input.id
        AuthForBoth(token)
        const forId = AuthForBoth(token).id
        const forFindDisk = await prisma.disk.findUnique({
          where: {
            id
          },
          select: {
            id: true,
            userId: true,
            diskName: true
          }
        })
        console.log(forFindDisk)
        if (forFindDisk.userId === forId) {
          await prisma.disk.delete({
            where: {
              id: input.input.id
            }
          })
          return 'Deleted Disk'
        } else {
          throw new GraphQLError('Failed to Delete', {
            extensions: {
              StatusCode: 400
            }
          })
        }
      } catch (error) {
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
export default forDeleteDisk
