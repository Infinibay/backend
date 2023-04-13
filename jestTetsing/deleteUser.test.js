import { PrismaClient } from '@prisma/client'
import forDeleteUser from '../app/graphql/resolvers/mutations/deleteUser.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forDeleteUser function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUxMmQwNjc4LWRiNTAtNDU1ZS1iZDkxLTU5OWE0M2MxMjkwZiIsImVNYWlsIjoiYWRtaW5AZ21haWwuY29tIiwidXNlclR5cGUiOiJhZG1pbiIsImlhdCI6MTY4MDg0ODg1NywiZXhwIjoxNzY3MjQ4ODU3fQ.KVd2IumXET8J5xqdta9797G5OZIM0H1epl1oOTBVrho',
        id: '19e2a465-34ee-463e-91ce-9705d831f2d2'
      }
    }
    jest.mock('../app/services/isAuth.js', () => {
      return jest.fn().mockImplementation(() => ({
        id: 'e1019b2a-804e-4280-a65d-79791f892207'
      }))
    })
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('should update user in the database', async () => {
    const result = await forDeleteUser.Mutation.deleteUser(null, mockInput)
    expect(result).toEqual('Deleted')
    const deletedUser = await prisma.user.findUnique({
      where: {
        id: mockInput.input.id
      }
    })
    expect(deletedUser).toBeTruthy() 
    expect(deletedUser.deleted).toEqual(true)
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'update').mockRejectedValue(new Error('mockError'))
    try {
      await forDeleteUser.Mutation.deleteUser(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Delete User Failed..!')
    }
  })
})
