import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { describe, expect, beforeAll, test } from '@jest/globals'
import login from '../app/graphql/resolvers/mutations/login.js' // import the code you want to test
const prisma = new PrismaClient()

const mockUser = {
  id: '512d0678-db50-455e-bd91-599a43c1290f',
  eMail: 'admin@gmail.com',
  password: bcrypt.hash('12345', 10),
  userType: 'admin',
  firstName: 'admin',
  deleted: undefined,
  lastName: ''
}

describe('Login', () => {
  beforeAll(async () => {
    await prisma.user.findUnique({ where: { eMail: mockUser.eMail } })
  })

  //   afterAll(async () => {
  //     await prisma.user.delete({ where: { id: mockUser.id } })
  //     await prisma.$disconnect()
  //   })

  test('returns user data and a token if valid email and password are provided', async () => {
    const input = {
      eMail: mockUser.eMail,
      password: '12345'
    }

    const result = await login.Mutation.Login(null, { input })
    expect(result.id).toBe(mockUser.id)
    expect(result.firstName).toBe(mockUser.firstName)
    expect(result.lastName).toBe(mockUser.lastName)
    expect(result.eMail).toBe(mockUser.eMail)
    expect(result.token).toBeDefined()

    const decodedToken = jwt.verify(result.token, process.env.TOKENKEY)
    expect(decodedToken.id).toBe(mockUser.id)
    expect(decodedToken.eMail).toBe(mockUser.eMail)
    expect(decodedToken.userType).toBe(mockUser.userType)
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await login.Mutation.Login(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
