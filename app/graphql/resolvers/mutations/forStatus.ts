import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '@services/isAuthForBoth'
import { createCall } from '../Virtualization/index'
import logger from '@main/logger'
const prisma = new PrismaClient()

const forStatusVMResolvers = {
  Mutation: {
    async forStatus(root: any, input: any) {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forID = AuthForBoth(token).id
        const forUserType = AuthForBoth(token).userType
        if (forID) {
          const id = input.input.id
          const button = input.input.button
          const forFindStatusID: any = await prisma.virtualMachine.findUnique({
            where: {
              id
            }
          })
          if (forFindStatusID.userId === forID || forUserType === 'admin') {
            if (button === true) {
              await createCall('startVMCall', {
                name: forFindStatusID.virtualMachineName
              })
              await prisma.virtualMachine.update({
                where: {
                  id: forFindStatusID.id
                },
                data: {
                  status: true
                }
              })
              return 'Status Updated'
            }
            if (button === false) {
              await createCall('shutdownCall', {
                name: forFindStatusID.virtualMachineName
              })
              await prisma.virtualMachine.update({
                where: {
                  id: forFindStatusID.id
                },
                data: {
                  status: false
                }
              })
              return 'Status Updated'
            }
          } else {
            throw new Error('Invalid Token')
          }
        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 404,
            code: 'Failed '
          }
        })
      }
    }
  }
}
export default forStatusVMResolvers
