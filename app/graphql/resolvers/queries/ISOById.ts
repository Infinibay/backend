import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import logger from '@main/logger'

const prisma = new PrismaClient()

const ISOById = {
  Query: {
    getISOById: async (_parent: any, input: any) => {
      try {
        const token = input.input.token
        const search = input.input.search
        const forAuth = AuthForBoth(token).id

        if (forAuth) {
          const getISO = await prisma.iSO.findMany({
            where: {
              userId: forAuth
            },
            select: {
              id: true,
              userId: true,
              name: true,
              type: true,
              size: true
            }
          })
          if (search) {
            const forFind = await prisma.iSO.findMany({
              where: {
                userId: forAuth,
                name: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            })

            return forFind
          }
          return getISO
        } else {
          throw new Error('Login again')
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 401
          }
        })
      }
    }
  }
}

export default ISOById;