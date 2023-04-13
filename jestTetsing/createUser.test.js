import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import signUp from '../app/graphql/resolvers/mutations/createUser.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('signUp function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        password: bcrypt.hashSync('12345', 10),
        userType: 'user',
        lastName: 'jerry',
        firstName: 'jerry',
        eMail: 'jerry99@gmail.com',
        deleted: false,
        userImage: null
      }
    }
  }
  )
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  test('create new User in the database', async () => {
    const forresult = await signUp.Mutation.createUser(null, mockInput)
    expect(forresult).toEqual({
      id: expect.any(String),
      password: expect.any(String),
      userType: 'user',
      lastName: 'jerry',
      firstName: 'jerry',
      eMail: 'jerry99@gmail.com',
      deleted: false,
      userImage: expect.any(String),
      token: expect.any(String)
    })
    const createUser = await prisma.user.findUnique({
      where: {
        id: forresult.id
      }
    })
    expect(createUser).toEqual({
      id: expect.any(String),
      password: expect.any(String),
      userType: 'user',
      lastName: 'jerry',
      firstName: 'jerry',
      eMail: 'jerry99@gmail.com',
      deleted: false,
      userImage: expect.any(String),
      token: expect.any(String)
    })
  })
  test('if any error. throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await signUp.Mutation.createUser(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
