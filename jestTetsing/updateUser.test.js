import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import forUpdateUser from '../app/graphql/resolvers/mutations/updateUser.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forUpdateUser function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        password: bcrypt.hashSync('12345', 10),
        userType: 'user',
        lastName: 'fiza',
        firstName: 'syeda',
        eMail: 'fizzafatima642@gmail.com',
        deleted: false,
        userImage: null,
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs'
      }
    }
    jest.mock('../app/services/isAuthForBoth.js', () => {
      return jest.fn().mockImplementation(() => ({
        id: 'e1019b2a-804e-4280-a65d-79791f892207'
      }))
    })
  }
  )
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  test('updatw new User in the database', async () => {
    const forresult = await forUpdateUser.Mutation.updateUser(null, mockInput)
    expect(forresult).toEqual({
      id: 'e1019b2a-804e-4280-a65d-79791f892207',
      password: expect.any(String),
      userType: 'user',
      lastName: 'fiza',
      firstName: 'syeda',
      eMail: 'fizzafatima642@gmail.com',
      deleted: false,
      userImage: expect.any(String),
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs'
    })
    const createUser = await prisma.user.findUnique({
      where: {
        id: forresult.id
      }
    })
    expect(createUser).toEqual({
      id: 'e1019b2a-804e-4280-a65d-79791f892207',
      password: expect.any(String),
      userType: 'user',
      lastName: 'fiza',
      firstName: 'syeda',
      eMail: 'fizzafatima642@gmail.com',
      deleted: false,
      userImage: expect.any(String),
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs'
    })
  })
  test('if any error. throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await forUpdateUser.Mutation.updateUser(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
