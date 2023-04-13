import { PrismaClient } from '@prisma/client'
import forUpdateaDisk from '../app/graphql/resolvers/mutations/updateDisk.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forUpdateaDisk function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMTAyNjQyLCJleHAiOjE3Njc1MDI2NDJ9.3MEr0qPeDsn2bubxFqPFXoiTN3Z-ztrQ-BtiZhiMMNs',
        id: '1c9b2a78-6aaa-476c-90a4-d451acfefda8',
        diskSize: 2,
        diskName: 'kkkk'
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
  test('should update disk in the database', async () => {
    const result = await forUpdateaDisk.Mutation.updateDisk(null, mockInput)
    expect(result).toEqual({
      userId: 'e1019b2a-804e-4280-a65d-79791f892207',
      id: '1c9b2a78-6aaa-476c-90a4-d451acfefda8',
      diskSize: 2,
      diskName: 'kkkk',
      storageId: null
    })
    const updatedDisk = await prisma.disk.findUnique({
      where: { id: result.id }
    })
    expect(updatedDisk).toEqual({
      userId: 'e1019b2a-804e-4280-a65d-79791f892207',
      id: '1c9b2a78-6aaa-476c-90a4-d451acfefda8',
      diskSize: 2,
      diskName: 'kkkk',
      storageId: null
    })
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.disk, 'update').mockRejectedValue(new Error('mockError'))
    try {
      await forUpdateaDisk.Mutation.updateDisk(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('failed')
    }
  })
})
