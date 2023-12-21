import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import isAuth from '@services/isAuth'
import logger from '@main/logger'

const prisma = new PrismaClient()

interface VirtualMachineWhereInput {
  virtualMachineName?: {
    contains: string;
    mode: 'insensitive';
  };
  Status?: {
    equals: string;
  };
}

interface UserSelect {
  id: true,
  firstName: true
}

interface GetAllVMInput {
  token: string;
  search?: string;
  status?: string;
}

const allVMResolver = {
  Query: {
    getAllVM: async (_root: any, input: GetAllVMInput) => {
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
                } as UserSelect
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