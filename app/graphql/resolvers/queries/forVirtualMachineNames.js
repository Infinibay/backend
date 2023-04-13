import { PrismaClient } from '@prisma/client'
import logger from '../../../../logger.js'
const prisma = new PrismaClient()

const forVirtualMachineName = {
  Query: {
    findVMName: async (root, input) => {
      try {
        const forFindVMName = await prisma.virtualMachine.findUnique({
          where: {
            virtualMachineName: input.input.virtualMachineName
          },
          select: {
            virtualMachineName: true
          }
        })
        if (forFindVMName) {
          return 'true'
        } else {
          return 'false'
        }
      } catch (error) {
        logger.error(error, error.message)
        return error
      }
    }
  }
}

export default forVirtualMachineName
