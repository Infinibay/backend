import { PrismaClient } from '@prisma/client'
import forUpdateISO from '../app/graphql/resolvers/mutations/updateISO.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forUpdateISO function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs',
        id: '0bf74093-d33e-4b78-9e91-ece64ca210a5',
        type: 'linux'

      }
    }
    jest.mock('../app/services/isAuthForUser.js', () => {
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
  test('should create a new storage in the database', async () => {
    const result = await forUpdateISO.Mutation.updateISO(null, mockInput)
    expect(result).toEqual({
      createdAt: expect.any(Date),
      id: '0bf74093-d33e-4b78-9e91-ece64ca210a5',
      size: 2,
      type: 'linux',
      name: 'newww.iso',
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
    const updatedISO = await prisma.ISO.findUnique({
      where: { id: result.id }
    })
    expect(updatedISO).toEqual({
      createdAt: expect.any(Date),
      id: '0bf74093-d33e-4b78-9e91-ece64ca210a5',
      size: 2,
      type: 'linux',
      userId: 'e1019b2a-804e-4280-a65d-79791f892207',
      name: 'newww.iso'
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.ISO, 'update').mockRejectedValue(new Error('mockError'))

    try {
      await forUpdateISO.Mutation.updateISO(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('mockError')
    }
  })
})
