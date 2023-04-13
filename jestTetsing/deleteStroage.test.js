import { PrismaClient } from '@prisma/client'
import forDeleteStorage from '../app/graphql/resolvers/mutations/deleteStorage.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forDeleteStorage function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgwODQwNTczLCJleHAiOjE3NjcyNDA1NzN9.5cfptEbE_QN6EazYxJ0i1mOlgJsYEwZRpXnJt4Qfm_o',
        id: 'ab9be1f3-f58d-4a27-813a-0f20f7d2df7f'
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
  test('should delete a storage in database', async () => {
    const result = await forDeleteStorage.Mutation.deleteStoragePool(null, mockInput)
    expect(result).toEqual('deleted')

    const deletedStorage = await prisma.storage.findUnique({ where: { id: mockInput.input.id } })
    expect(deletedStorage).toBeNull()
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.storage, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await forDeleteStorage.Mutation.deleteStoragePool(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('deleted Failed')
    }
  })
})
