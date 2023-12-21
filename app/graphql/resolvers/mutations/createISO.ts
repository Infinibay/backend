import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import logger from '@main/logger'

const prisma = new PrismaClient()

const forCreateISO = {
  Mutation: {
    async createISO(root: any, input: any) {
      try {
        const token = input.input.token
        const forID = AuthForBoth(token).id
        if (forID) {
          const name = input.input.name
          const forName = name.endsWith('.iso')
          const parts = name.split('.')
          const names = parts.slice(0, -1).join('.')
          const filename = names.replace(/[^a-z0-9]/gi, '_').toLowerCase()
          const ext = '.' + parts.slice(-1)
          const forCon = filename + ext

          if (forName === true) {
            const forCreateISO = await prisma.iSO.create({
              data: {
                name: forCon,
                type: input.input.type,
                userId: forID,
                size: input.input.size
              },
              select: {
                id: true,
                name: true,
                userId: true,
                size: true,
                type: true,
                createdAt: true
              }

            })
            return forCreateISO
          }
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Create', {
          extensions: {
            StatusCode: 400,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forCreateISO
