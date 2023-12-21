import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import AuthForBoth from '@services/isAuthForBoth'

const prisma = new PrismaClient()

const forDeleteISO = {
  Mutation: {
    async deleteISO(root: any, input: any) {
      try {
        const token = input.input.token
        const ids = input.input.id
        const forBoth = AuthForBoth(token).id
        const forUserType = AuthForBoth(token).userType
        if (forBoth) {
          if (forUserType === 'admin') {
            await prisma.iSO.deleteMany({
              where: {
                id: { in: ids }
              }
            })
            return 'ISO Deleted'
          }
          if (forUserType && forUserType === 'user') {
            const forFind = await prisma.iSO.findUnique({
              where: {
                id: input.input.id
              }
            })
            if (forFind && forBoth === forFind.userId) {
              await prisma.iSO.delete({
                where: {
                  id: forFind.id
                }
              })
              return 'ISO Deleted'
            }
          }
        }
      } catch (error: any) {
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
