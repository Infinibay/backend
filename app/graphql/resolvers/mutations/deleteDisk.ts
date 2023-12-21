import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forDeleteDisk = {
  Mutation: {
    async deleteDisk(root: any, input: any) {
      try {
        const forDelete = await prisma.disk.delete({
          where: {
            id: input.input.id
          }
        })
        console.log(forDelete)
        return 'Delete Disk'
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
export default forDeleteDisk
