import { PrismaClient } from '@prisma/client'
import forUserById from '../app/graphql/resolvers/queries/userById.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('forUserById', () => {
  test('getUserByID', async () => {
    const mockInput = { input: { id: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.user, 'findUnique').mockReturnValueOnce({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await forUserById.Query.getUserByID(null, mockInput)
    expect(result).toEqual({
      firstName: 'syeda',
      userType: 'user',
      userImage: 'app/userImage/5tf.jpeg',
      lastName: 'fiza',
      id: 'e1019b2a-804e-4280-a65d-79791f892207',
      eMail: 'fizzafatima642@gmail.com',
      deleted: false,
      _count: {
        disk: 8,
        ISO: 165,
        storage: 4,
        notification: 1,
        VM: 6
      }
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await forUserById.Query.getUserByID(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
