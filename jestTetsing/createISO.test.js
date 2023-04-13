import { PrismaClient } from '@prisma/client'
import forCreateISO from '../app/graphql/resolvers/mutations/createISO.js'
import { describe, expect, beforeEach, afterAll, afterEach, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forCreateISO function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        type: 'window',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTEzODY2LCJleHAiOjE3Njc1MTM4NjZ9.S9-fcSpYolFpu2a3Wgx70QcbJTq59sFJ1S_b5WZt9ME',
        size: 2,
        name: 'newww.iso'
      }
    }
    jest.mock('../app/services/isAuthForBoth.js', () => {
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

  test('create a new ISO in the database', async () => {
    const forresult = await forCreateISO.Mutation.createISO(null, mockInput)
    expect(forresult).toEqual({
      id: expect.any(String),
      createdAt: expect.any(Date),
      type: 'window',
      size: 2,
      name: 'newww.iso',
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
    const createISO = await prisma.ISO.findUnique({
      where: { id: forresult.id }
    })
    expect(createISO).toEqual({
      id: expect.any(String),
      createdAt: expect.any(Date),
      type: 'window',
      size: 2,
      name: 'newww.iso',
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
  })

  test('if any error. throw an error if the function fails', async () => {
    jest.spyOn(prisma.ISO, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await forCreateISO.Mutation.createISO(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf('Error')
      expect(error.message).toBe('mockError')
    }
  })
}

)
