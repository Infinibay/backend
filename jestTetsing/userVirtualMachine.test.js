import { PrismaClient } from '@prisma/client'
import userVirtualMachine from '../app/graphql/resolvers/queries/userVirtualMachine.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('userVirtualMachine', () => {
  test('getUserVM', async () => {
    const mockInput = { input: { id: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.user, 'findUnique').mockReturnValueOnce({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await userVirtualMachine.Query.getUserVM(null, mockInput)
    expect(result).toEqual({
      userType: 'user',
      userImage: 'app/userImage/5tf.jpeg',
      lastName: 'fiza',
      firstName: 'syeda',
      id: 'e1019b2a-804e-4280-a65d-79791f892207',
      _count: {
        VM: 6,
        notification: 0,
        ISO: 163
      },
      eMail: 'fizzafatima642@gmail.com'

    })
  }

  )


  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockRejectedValue(new Error('mockError'))
    try {
      await userVirtualMachine.Query.getUserVM(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
    }
  })
})
