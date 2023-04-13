
import { PrismaClient } from '@prisma/client'
import forVirtualMachineName from '../app/graphql/resolvers/queries/forVirtualMachineNames.js'
// import logger from '../logger.js'
import { describe, expect, test, jest } from '@jest/globals'
const prisma = new PrismaClient()

describe('forVirtualMachineName', () => {
  describe('findVMName', () => {
    test('true conduction', async () => {
      const mockInput = {
        input: { virtualMachineName: 'comp99' }
      }
      jest.spyOn(prisma.virtualMachine, 'findUnique').mockReturnValueOnce({
        virtualMachineName: 'comp99'
      })
      const result = await forVirtualMachineName.Query.findVMName(null, mockInput)
      expect(result).toBe('true')
    })
    test('false condition', async () => {
      const mockInput = {
        input: { virtualMachineName: 'test-vm' }
      }
      jest.spyOn(prisma.virtualMachine, 'findUnique').mockReturnValueOnce(null)

      const result = await forVirtualMachineName.Query.findVMName(null, mockInput)

      expect(result).toBe('false')
    })

    test('should throw an error if the function fails', async () => {
      jest.spyOn(prisma.virtualMachine, 'delete').mockRejectedValue(new Error('mockError'))
      try {
        await forVirtualMachineName.Query.findVMName(null)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('deleted Failed')
      }
    })
  })
})
