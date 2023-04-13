import { PrismaClient } from '@prisma/client'
import forSpecificDiskDetail from '../app/graphql/resolvers/queries/getSpecificDiskDetails.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})
describe('forSpecificDiskDetail', () => {
  test('getSpecificDiskDetails', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207', id: 'fade568f-9d6f-44c3-963a-b450cfa49f16' } }
    jest.spyOn(prisma.disk, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207', id: 'fade568f-9d6f-44c3-963a-b450cfa49f16' })
    const result = await forSpecificDiskDetail.Query.getSpecificDiskDetails(null, mockInput)
    expect(result).toEqual([
      {
        diskName: 'kkkk',
        diskSize: 8,
        id: 'fade568f-9d6f-44c3-963a-b450cfa49f16'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.disk, 'findMany').mockRejectedValue(new Error('mockError'))
    try {
      await forSpecificDiskDetail.Query.getSpecificDiskDetails(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed')
    }
  })
})
