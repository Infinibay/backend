import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
import { createCall } from '../Virtualization/index.js'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forStatusVMResolvers = {
  Mutation: {
    async forStatus (_root, input) {
      try {
        const token = input.input.token
        AuthForBoth(token)
        const forID = AuthForBoth(token).id
        const forUserType = AuthForBoth(token).userType
        if (forID) {
          const id = input.input.id
          const button = input.input.button
          const forFindStatusID = await prisma.virtualMachine.findUnique({
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
      } catch (error) {
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
