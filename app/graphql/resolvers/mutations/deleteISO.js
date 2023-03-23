import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const forDeleteISO = {
  Mutation: {
    async deleteISO (_root, input) {
      try {
        const token = input.input.token

        const forBoth = AuthForBoth(token).id
        const forUserType = AuthForBoth(token).userType
        if (forBoth) {
          if (forUserType === 'admin') {
            await prisma.ISO.delete({
              where: {
                id: input.input.id
              }
            })
            return 'ISO Deleted'
          }
          if (forUserType === 'user') {
            const forFind = await prisma.ISO.findUnique({
              where: {
                id: input.input.id
              }
            })
            if (forBoth === forFind.userId) {
              await prisma.ISO.delete({
                where: {
                  id: forFind.id
                }
              })
              return 'deleted ISO'
            }
          }
        }
      } catch (error) {
        logger.error(error)
        if (error.extensions.StatusCode === 400) {
          throw new GraphQLError('please enter valid credentials', {
            extensions: {
              StatusCode: 401,
              code: 'Invalid Credentials'
            }
          })
        } else {
          throw new GraphQLError('Failed to Delete', {
            extensions: {
              StatusCode: 400,
              code: 'Failed'
            }
          })
        }
      }
    }
  }
}
export default forDeleteISO
