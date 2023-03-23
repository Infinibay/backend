import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import isAuth from '../../../services/isAuth.js'
const prisma = new PrismaClient()
const forDeleteUser = {
  Mutation: {
    async deleteUser (root, input) {
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
      } catch (error) {
        logger.error(error)
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
