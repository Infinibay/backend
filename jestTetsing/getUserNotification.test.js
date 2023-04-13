import { PrismaClient } from '@prisma/client'
import forUserNotification from '../app/graphql/resolvers/queries/userNotification.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('forUserNotification', () => {
  test('getUserNotification', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.notification, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await forUserNotification.Query.getUserNotification(null, mockInput)
    expect(result).toEqual([
      {
        vmId: null,
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        readed: false,
        message: 'hey',
        id: '0b4281c8-5650-4375-a9d3-08b8b683982b'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.notification, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await forUserNotification.Query.getUserNotification(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
