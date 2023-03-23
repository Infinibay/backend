import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '../../../../logger.js'
import isAuth from '../../../services/isAuth.js'
const prisma = new PrismaClient()

const forAllSO = {
  Query: {
    getAllISO: async (_root, input) => {
      try {
        const token = input.input.token
        const search = input.input.search
        const forAuth = isAuth(token).id
        if (forAuth) {
          const forFindISO = await prisma.ISO.findMany({
            select: {
              id: true,
              name: true,
              type: true,
              createdAt: true,
              userId: true,
              size: true
            }
          })
          if (search) {
            const searchToFind = await prisma.ISO.findMany({
              where: {
                Name: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            })
            return searchToFind
          }
          return forFindISO
        }
      } catch (error) {
        logger.error(error)
        throw new GraphQLError('Please enter valid credentials', {
          extensions: {
            StatusCode: 401,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forAllSO
