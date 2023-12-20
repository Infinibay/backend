import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const forGetListofStorage = {
  Query: {
    getListOfStorageDetails: async (root, input) => {
      try {
        const forgetList = await prisma.disk.findMany({
          where: {
            storageId: input.input.storageId
          },
          select: {
            id: true,
            diskName: true,
            diskSize: true,
            storageId: true
          }
        })
        console.log(forgetList)
        return forgetList
      } catch (error) {
        console.log(error)
      }
    }
  }
}
export default forGetListofStorage
