import { PrismaClient } from '@prisma/client'
import forUsersList from '../app/graphql/resolvers/queries/usersList.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuth.js', () => {
  return jest.fn().mockReturnValue({ id: '512d0678-db50-455e-bd91-599a43c1290f' })
})

describe('forUsersList', () => {
  test('getUserList', async () => {
    const mockInput = { input: { id: '512d0678-db50-455e-bd91-599a43c1290f', page: 1 } }
    jest.spyOn(prisma.ISO, 'findMany').mockReturnValueOnce({ id: '512d0678-db50-455e-bd91-599a43c1290f', page: 1 })
    const result = await forUsersList.Query.getUserList(null, mockInput)
    expect(result).toEqual([
      {
        userType: 'user',
        userImage: 'app/userImage/0n.jpeg',
        lastName: 'jerry',
        firstName: 'jerry',
        id: 'f6013637-f300-40b8-bd22-d680ca00c379',
        eMail: 'jerry123@gmail.com',
        deleted: false,
        _count: null,
        password: '$2b$10$tHUBs5IdUMnnIvBA6JRFdO/2TqemH7EuUGSUpV/hCGFc9W2wgQmmm',
        token: 'null'
      },
      {
        userType: 'user',
        userImage: 'app/userImage/mw.jpeg',
        lastName: 'jerry',
        firstName: 'jerry',
        id: 'bc5171af-8535-40f1-b169-0867f802b7e7',
        eMail: 'jerry99@gmail.com',
        deleted: false,
        _count: null,
        password: '$2b$10$9td0tr6Pzuq0Xwk65gtz.uAMsrHSmqhGuBPnIYfIwDUkoIx0M2tni',
        token: 'null'
      },
      {
        userType: 'user',
        userImage: 'app/userImage/5tf.jpeg',
        lastName: 'fiza',
        firstName: 'syeda',
        id: 'e1019b2a-804e-4280-a65d-79791f892207',
        eMail: 'fizzafatima642@gmail.com',
        deleted: false,
        _count: null,
        password: '$2b$10$3YFaCIPB85JE06CfhSBTXu4ePNtKmaL4WDmHXv6Ce.pLUN/u.7tua',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImUxMDE5YjJhLTgwNGUtNDI4MC1hNjVkLTc5NzkxZjg5MjIwNyIsImVNYWlsIjoiZml6emFmYXRpbWE2NDJAZ21haWwuY29tIiwidXNlclR5cGUiOiJ1c2VyIiwiaWF0IjoxNjgxMjczNDgzLCJleHAiOjE3Njc2NzM0ODN9.aGgjg3iODvBfcdHPhURKPTubUnVW3h0dyvhp9IVzPig'
      },
      {
        userType: 'user',
        userImage: 'app/userImage/njg.jpeg',
        lastName: 'jerry',
        firstName: 'tom',
        id: 'e525bebb-c4d9-4d00-8f9e-27ea18f4e172',
        eMail: 'jerryandtom@gmail.com',
        deleted: false,
        _count: null,
        password: '$2b$10$zl2h6Rp2/NblIWMWNohh7.9JtbDkxMwuvvFYSqCaK8C5MqAJerl9u',
        token: 'null'
      },
      {
        userType: 'user',
        userImage: 'app/userImage/1h.jpeg',
        lastName: 'jerry',
        firstName: 'tom',
        id: '61314053-de2f-4c29-b5e8-26e5b7e2e1e8',
        eMail: 'tomandjerry@gmail.com',
        deleted: false,
        _count: null,
        password: '$2b$10$YvBZmBeHnu8jK/i6kybMlOdwc9u6aIz9TnK9S5yDTPXYJ1fwlOhCy',
        token: 'null'
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.user, 'delete').mockRejectedValue(new Error('mockError'))
    try {
      await forUsersList.Query.getUserList(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Something went wrong please check again')
    }
  })
})
