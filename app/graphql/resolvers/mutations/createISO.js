import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'

import AuthForBoth from '../../../services/isAuthForBoth.js'
const prisma = new PrismaClient()

const forCreateISO = {
  Mutation: {
    async createISO (_root, input) {
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
            const forCreateISO = await prisma.ISO.create({
              data: {
                name: forCon,
                type: input.input.type,
                userId: forID,
                createdAt: input.input.createdAt,
                size: input.input.size
              }
            })
            return forCreateISO
          }
        }
      } catch (error) {
        logger.error(error)
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
