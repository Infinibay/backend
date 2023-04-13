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
              return 'ISO Deleted'
            }
          }
        }
      } catch (error) {
        logger.error(error, error.message)
        if (error.extensions && error.extensions.status === 400) {
          throw new GraphQLError('please enter valid credentials', { extensions: { status: 400 } })
        } else {
          throw new GraphQLError('Failed to Delete', { extensions: { status: 500 } })
        }
      }
    }
  }
}
export default forDeleteISO
