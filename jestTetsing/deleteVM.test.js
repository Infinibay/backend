import { PrismaClient } from '@prisma/client'
import deleteVMResolvers from '../app/graphql/resolvers/mutations/deleteVM.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('deleteVMResolvers function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgwODUxNTU3LCJleHAiOjE3NjcyNTE1NTd9.8mRP4L-iWLBtHKr51ZBoYGdPYBHLP6C27aGu8KnH4HQ',
        id: '1b54760b-8885-4a79-aa02-413a623c271f'
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
  test('should delete a vm in database', async () => {
    const result = await deleteVMResolvers.Mutation.deleteVM(null, mockInput)
    expect(result).toEqual(undefined)

    const deleteVM = await prisma.virtualMachine.findUnique({ where: { id: mockInput.input.id } })
    expect(deleteVM).toBeNull()
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.virtualMachine, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await deleteVMResolvers.Mutation.deleteVM(null, mockInput)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Failed to Delete')
    }
  })
})
