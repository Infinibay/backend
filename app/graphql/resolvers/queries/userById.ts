import { PrismaClient } from '@prisma/client'
import logger from '../../../../logger.js'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()
const forUserById = {
  Query: {
    getUserByID: async (_parent, input) => {
      try {
        const token = input.input.token
        const forId = AuthForBoth(token).id
        if (forId) {
          const findUserById = await prisma.user.findUnique({
            where: {
              id: forId
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              eMail: true,
              deleted: true,
              userImage: true,
              userType: true,
              _count: true
            }
          })
          return findUserById
        }
      } catch (error) {
        logger.error(error, error.message)
        throw new GraphQLError('Something went wrong please try again later', {
          extensions: {
            StatusCode: 500
          }
        })
      }
    }
  }
}
export default forUserById
