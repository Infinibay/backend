import { PrismaClient } from '@prisma/client'
import getStorageDetails from '../app/graphql/resolvers/queries/getStorageDetails.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('function', () => {
  test('getStorageList', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.storage, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await getStorageDetails.Query.getStorageList(null, mockInput)
    expect(result).toEqual([
      {
        storageSize: 1,
        storageName: 'myneww',
        id: '091d13a4-f76f-4f01-97ef-21e517596d35',
        storageType: 'fast'
      },
      {
        storageSize: 4,
        storageName: 'newStorage',
        id: '8066f2ff-453e-4e4f-b145-58d07caf77f5',
        storageType: 'fats'
      },
      {
        storageSize: 4,
        storageName: 'newStorage',
        id: '1634ec5c-ca03-49cb-9575-2424f14868a5',
        storageType: 'fast45'
      },
      {
        storageSize: 4,
        storageName: 'newStorage',
        id: 'f8735472-c28d-44c8-9542-3b89924697b2',
        storageType: 'slow'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.storage, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await getStorageDetails.Query.getStorageList(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
