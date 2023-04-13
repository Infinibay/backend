import { PrismaClient } from '@prisma/client'
import getAllUserDisk from '../app/graphql/resolvers/queries/getAllUserDisk.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('getAllUserDisk', () => {
  test('getDiskDetails', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.disk, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await getAllUserDisk.Query.getDiskDetails(null, mockInput)
    expect(result).toEqual([
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: 'fade568f-9d6f-44c3-963a-b450cfa49f16'
      },
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: '9f63379e-86f0-4b8f-b5bf-d85596180b71'
      },
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: 'fb1d5a37-8b6d-4823-8d14-37fb493076e8'
      },
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: 'ddcfcf71-39e4-4496-9a3d-978b6022691c'
      },
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: '9a7c3d01-1f08-4882-96de-a3f019e83423'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.disk, 'findMany').mockRejectedValue(new Error('mockError'))
    try {
      await getAllUserDisk.Query.getDiskDetails(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed to get Details ')
    }
  })
})
