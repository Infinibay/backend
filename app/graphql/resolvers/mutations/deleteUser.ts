import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import isAuth from '@services/isAuth'

const prisma = new PrismaClient()

const forDeleteUser = {
  Mutation: {
    async deleteUser(root: any, input: any) {
      try {
        const token = input.input.token
        const forID = isAuth(token).id
        if (forID) {
          await prisma.user.update({
            where: {
              id: input.input.id
            },
            data: {
              deleted: true
            }
          })
          return 'Deleted'
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Delete User Failed..!', {
          extensions: {
            StatusCode: 404
          }
        })
      }
    }
  }
}
export default forDeleteUser
