import { PrismaClient } from '@prisma/client'
import isAuth from '../../../services/isAuth.js'
import logger from '../../../../logger.js'
import { GraphQLError } from 'graphql'
const prisma = new PrismaClient()

const forUsersList = {
  Query: {
    getUserList: async (parent, input) => {
      try {
        const token = input.input.token
        const search = input.input.search
        const foradmin = isAuth(token)
        if (foradmin) {
          const page = input.input.page
          const forGetUserList = await prisma.user.findMany({
            where: {
              deleted: false,
              userType: 'user'
            },
            orderBy: {
              firstName: 'asc'
            },
            take: 5,
            skip: (page - 1) * 5
          })
          if (search && foradmin) {
            const searchToFind = await prisma.user.findMany({
              where: {
                deleted: false,
                userType: 'user',
                firstName: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            })
            return searchToFind
          }
          const count = await prisma.user.count({
            where: {
              deleted: false,
              userType: 'user'
            }
          })
          const totalPages = Math.ceil(count / 5)
          console.log(totalPages)
          return forGetUserList
        }
      } catch (error) {
        logger.error(error)
        throw new GraphQLError('Something went wrong please check again', {
          extensions: {
            StatusCode: 500
          }
        })
      }
    }
  }
}

export default forUsersList
