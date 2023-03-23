import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import isAuth from '../../../services/isAuth.js'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const allVMResolver = {
  Query: {
    getAllVM: async (_root, input) => {
      try {
        const token = input.input.token
        const search = input.input.search
        const status = input.input.status
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
                Status: {
                  equals: status
                }
              }
            })
            return forSearchWithStatus
          }
          return forVM
        }
      } catch (error) {
        logger.error(error)
        throw new GraphQLError(
          'Something went wrong....please enter valid credentials .!!!  ',
          {
            extensions: {
              StatusCode: 401,
              code: 'Failed '
            }
          }
        )
      }
    }
  }
}
export default allVMResolver
