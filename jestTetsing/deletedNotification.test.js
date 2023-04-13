import { PrismaClient } from '@prisma/client'
import fordeleteNotification from '../app/graphql/resolvers/mutations/deleteNotification.js'
import { describe, expect, beforeEach, afterEach, afterAll, test } from '@jest/globals'
const prisma = new PrismaClient()

describe('fordeleteNotification function', () => {
  let mockInput
  beforeEach(() => {
    mockInput = {
      input: {
        id: '3f52a3fa-2b87-4d2a-8e48-e3a0e187803a'
      }
    }
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })
  test('should delete a notification in database', async () => {
    const result = await fordeleteNotification.Mutation.deleteNotification(null, mockInput)
    expect(result).toEqual('Deleted')

    const deletdNotification = await prisma.notification.findUnique({ where: { id: mockInput.input.id } })
    expect(deletdNotification).toBeNull()
  })

  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.notification, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await fordeleteNotification.Mutation.deleteNotification(null, mockInput)
    } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Failed to Delete')
    }
  })
})
