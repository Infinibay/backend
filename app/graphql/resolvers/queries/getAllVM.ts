import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import isAuth from '@services/isAuth'
import logger from '@main/logger'

const prisma = new PrismaClient()

const allVMResolver = {
  Query: {
    getAllVM: async (_root: any, input: any) => {
      try {
        const { token, search, status } = input;
        const foradminID = isAuth(token).id
        if (foradminID) {
          const forVM = await prisma.virtualMachine.findMany({
            select: {
              virtualMachineName: true,
              vmImage: true,
              title: true,
              status: true,
              guId: true,
              config: true,
              description: true,
              id: true,
              user: {
                select: {
                  id: true,
                  firstName: true
                }
              }
            }
          })
          if (search) {
            const searchToFind = await prisma.virtualMachine.findMany({
              where: {
                virtualMachineName: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            })
            return searchToFind
          }
          if (status) {
            const forSearchWithStatus = await prisma.virtualMachine.findMany({
              where: {
                status: true
              }
            })
            return forSearchWithStatus
          }
          return forVM
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError(
          'Something went wrong....please enter valid credentials .!!!  ',
          {
            extensions: {
              StatusCode: 401
            }
          }
        )
      }
    }
  }
}

export default allVMResolver;