import { PrismaClient } from '@prisma/client'
import { GraphQLError } from 'graphql'
import fs from 'fs'
import logger from 'logger'
import AuthForBoth from '@services/isAuthForBoth'
import createCallFunction from '@services/createCallFunctions'

const prisma = new PrismaClient()
const RandomStringLength = parseInt(process.env.RANDOMSTRINGLENGTH || '5')

const createVMResolvers = {
  Mutation: {
    async createVM(root: any, input: any, context: any) {
      try {
        const confii = JSON.parse(input.input.config)
        const ram = confii.getConfigFile.Memory
        const cpu = confii.getConfigFile.processor.Processors
        const storage = confii.getConfigFile.Storage
        const iso = confii.getConfigFile.IsoFile
        const tpm = confii.getConfigFile.TPM
        const name = input.input.title
        const fordata = { confii, ram, cpu, storage, iso, name, tpm }
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
        }
        const token = input.input.token
        const forID = AuthForBoth(token).id
        if (token) {
          const createCallResult: any = await createCallFunction(fordata)
          const storageId = input.input.storageId
          if (storageId) {
            input.input.storageId = storageId
          }
          if (createCallResult.status === true) {
            if (createCallResult.status === true) {
              const storageId = input.input.storageId ? input.input.storageId : null
              const VMCreate = await prisma.virtualMachine.create({
                data: {
                  userId: forID,
                  virtualMachineName: input.input.virtualMachineName,
                  title: input.input.title,
                  description: input.input.description,
                  status: input.input.status,
                  vmImage: path,
                  config: input.input.config,
                  storageId
                },
                select: {
                  id: true,
                  guId: true,
                  virtualMachineName: true,
                  status: true,
                  description: true,
                  config: true,
                  vmImage: true,
                  storageId: true,
                  title: true
                }
              })
              return VMCreate
            }
          }

        }
      } catch (error: any) {
        logger.error(error, error.message)
        throw new GraphQLError('Failed to Create', {
          extensions: {
            StatusCode: 400
          }
        })
      }
    }
  }
}
export default createVMResolvers
