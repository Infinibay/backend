import { PrismaClient } from '@prisma/client'
import forUpdateStorage from '../app/graphql/resolvers/mutations/updateStorage.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forUpdateStorage function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs',
        id: '091d13a4-f76f-4f01-97ef-21e517596d35',
        storageName: 'myneww',
        storageType: 'fast',
        storageSize: 1
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
  test('should create a new storage in the database', async () => {
    const result = await forUpdateStorage.Mutation.updateStorage(null, mockInput)
    expect(result).toEqual({
      id: '091d13a4-f76f-4f01-97ef-21e517596d35',
      storageName: 'myneww',
      storageType: 'fast',
      storageSize: 1,
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
    const createdStorage = await prisma.storage.findUnique({
      where: { id: result.id }
    })
    expect(createdStorage).toEqual({
      id: '091d13a4-f76f-4f01-97ef-21e517596d35',
      storageName: 'myneww',
      storageType: 'fast',
      storageSize: 1,
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.storage, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await forUpdateStorage.Mutation.updateStorage(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('mockError')
    }
  })
})
