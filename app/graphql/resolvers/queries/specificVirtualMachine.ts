import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import logger from '@main/logger'
import AuthForBoth from '@services/isAuthForBoth'

const prisma = new PrismaClient()

const specificVirtualMachine = {
  Query: {
    getSpecificVM: async (root: any, input: any) => {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forid = AuthForBoth(token).id
        if (forid) {
          const forSpecificVM: any = await prisma.virtualMachine.findUnique({
            where: {
              id: input.input.id
            },
            select: {
              id: true,
              userId: true,
              virtualMachineName: true,
              description: true,
              title: true,
              status: true,
              config: true,
              storageId: true,
              vmImage: true,
              guId: true,
              user: {
                select: {
                  id: true,
                  eMail: true
                }
              }
            }
          })
          if (forSpecificVM.user.id === forid) {
            return forSpecificVM
          } else {
            throw new Error('VM Not Found')
          }
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError(
          'Something went wrong....please try again.!!!  ',
          {
            extensions: {
              StatusCode: 400
            }
          }
        )
      }
    }
  }
}

export default specificVirtualMachine
