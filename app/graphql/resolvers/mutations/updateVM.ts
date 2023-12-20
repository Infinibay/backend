import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import AuthForBoth from '../../../services/isAuthForBoth.js'
import updateVMFunctions from '../../../services/updateVMFunctions.js'
import fs from 'fs'
const prisma = new PrismaClient()
const RandomStringLength = parseInt(process.env.RANDOMSTRINGLENGTH)

const updateVMResolvers = {
  Mutation: {
    async upadteVM (_root, input) {
      try {
        const path =
          'app/VM_image/' +
          (Math.random() + 1).toString(36).substring(RandomStringLength) +
          '.jpeg'

        const vmImage = input.input.vmImage
        if (vmImage) {
          const base64Data = await vmImage.replace(
            /^data:([A-Za-z-+/]+);base64,/,
            ''
          )
          fs.writeFileSync(path, base64Data, { encoding: 'base64' })
          console.log(path)
        }
        const token = input.input.token
        const forID = AuthForBoth(token).id
        if (forID) {
          const id = input.input.id
          const forUpdatingVM = await prisma.virtualMachine.findUnique({
            where: {
              id
            },
            select: {
              id: true,
              virtualMachineName: true,
              user: {
                select: {
                  id: true,
                  eMail: true
                }
              }
            }
          })
          console.log(forUpdatingVM)
          if (vmImage) {
            const forUpdate = await prisma.virtualMachine.update({
              where: {
                id: input.input.id
              },
              data: {
                virtualMachineName: input.input.virtualMachineName,
                title: input.input.title,
                description: input.input.description,
                status: input.input.status,
                vmImage: path
              },
              select: {
                id: true,
                virtualMachineName: true,
                description: true,
                status: true,
                title: true,
                vmImage: true
              }
            })
            console.log('forUpdate')
            return forUpdate
          }

          if (vmImage === null || !vmImage) {
            const forUpdatewithoutimage =
                  await prisma.virtualMachine.update({
                    where: {
                      id: input.input.id
                    },
                    data: {
                      virtualMachineName: input.input.virtualMachineName,
                      title: input.input.title,
                      description: input.input.description,
                      status: input.input.status,
                      userId: input.input.userId

                    },
                    select: {
                      id: true,
                      virtualMachineName: true,
                      description: true,
                      status: true,

                      title: true
                    }
                  })
            console.log('forUpdatewithoutimage')
            return forUpdatewithoutimage
          }
        }
      } catch (error) {
        console.log(error)
        throw new GraphQLError('Failed to Update', {
          extensions: {
            StatusCode: 404
          }
        })
      }
    }
  }
}

export default updateVMResolvers
