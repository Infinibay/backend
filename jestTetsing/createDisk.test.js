import { PrismaClient } from '@prisma/client'
import createDisk from '../app/graphql/resolvers/mutations/createDisk.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'

const prisma = new PrismaClient()

describe('createDisk function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgwODYwMzEzLCJleHAiOjE3NjcyNjAzMTN9.Aoe0Vo6HsMpR4jmKNgIutcElq_6qm3Ejq0x1rfDy0GU',
        storageId: '091d13a4-f76f-4f01-97ef-21e517596d35',
        diskName: 'diskName12',
        diskSize: 2
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
  test('should create a new disk in the database', async () => {
    const result = await createDisk.Mutation.createDisk(null, mockInput)
    expect(result).toEqual({
      id: expect.any(String),
      storageId: '091d13a4-f76f-4f01-97ef-21e517596d35',
      diskName: 'diskName12',
      diskSize: 2,
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
    const createdDisk = await prisma.disk.findUnique({
      where: { id: result.id }
    })
    expect(createdDisk).toEqual({
      id: expect.any(String),
      storageId: '091d13a4-f76f-4f01-97ef-21e517596d35',
      diskName: 'diskName12',
      diskSize: 2,
      userId: 'e1019b2a-804e-4280-a65d-79791f892207'
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.disk, 'create').mockRejectedValue(new Error('mockError'))
    try {
      await createDisk.Mutation.createDisk(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed')
    }
  })
})
