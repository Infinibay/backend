import { PrismaClient } from '@prisma/client'
import forDeleteISO from '../app/graphql/resolvers/mutations/deleteISO.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('forDeleteISO function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgwODQwNTczLCJleHAiOjE3NjcyNDA1NzN9.5cfptEbE_QN6EazYxJ0i1mOlgJsYEwZRpXnJt4Qfm_o',
        id: '1c6b459c-d45f-4b80-b040-5d342a8ae124'
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
  test('should delete a ISO in database', async () => {
    const result = await forDeleteISO.Mutation.deleteISO(null, mockInput)
    expect(result).toEqual('ISO Deleted')

    const deletdISO = await prisma.ISO.findUnique({ where: { id: mockInput.input.id } })
    expect(deletdISO).toBeNull()
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.ISO, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await forDeleteISO.Mutation.deleteISO(null, mockInput)
    } catch (error) {
      if (error.extensions && error.extensions.status === 400) {
        expect(error.message).toBe('please enter valid credentials')
      } else {
        expect(error.message).toBe('Failed to Delete')
      }
    }
  })
})
