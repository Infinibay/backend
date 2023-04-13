import { PrismaClient } from '@prisma/client'
import forAllSO from '../app/graphql/resolvers/queries/allISO.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuth.js', () => {
  return jest.fn().mockReturnValue({ id: '8fcca9c6-8d8a-43d5-a1f9-5fdacbde289e' })
})

describe('forAllSO', () => {
  test('getAllISO', async () => {
    jest.spyOn(prisma.ISO, 'findMany').mockReturnValueOnce()
    const result = await forAllSO.Query.getAllISO(null)
    expect(result).toEqual([
      {
        type: 'window',
        userId: '68d1cf60-0ad2-4581-a5c9-6b3f9c38a2ca',
        size: 9,
        name: 'new.iso',
        id: '61bd5048-747e-4c6b-be96-abd653eaccd7',
        createdAt: '2023-03-20T07:10:08.771Z'
      },
      {
        type: 'window',
        userId: '68d1cf60-0ad2-4581-a5c9-6b3f9c38a2ca',
        size: 2,
        name: 'abc.iso',
        id: 'a7b41a0c-0025-4639-b2ce-aba5c5685723',
        createdAt: '2023-03-21T09:21:51.892Z'
      },
      {
        type: 'window',
        userId: '68d1cf60-0ad2-4581-a5c9-6b3f9c38a2ca',
        size: 2,
        name: 'abcd.iso',
        id: '324f4967-3466-4422-9d25-22524eb47cf3',
        createdAt: '2023-03-21T09:22:12.745Z'
      },
      {
        type: 'window',
        userId: '68d1cf60-0ad2-4581-a5c9-6b3f9c38a2ca',
        size: 4,
        name: 'xyz.iso',
        id: '350404bc-11e8-4ab1-823d-e766e6c432cf',
        createdAt: '2023-03-22T07:26:18.688Z'
      },
      {
        type: 'Linux',
        userId: '8fcca9c6-8d8a-43d5-a1f9-5fdacbde289e',
        size: 1474873344,
        name: 'ubuntu_22_04_1_live_server_amd64.iso',
        id: '137f1ac1-cdd7-47bd-8c79-03e206fcf4b0',
        createdAt: '2023-03-22T10:38:14.544Z'
      },
      {
        type: 'Windows',
        userId: '8fcca9c6-8d8a-43d5-a1f9-5fdacbde289e',
        size: 489029632,
        name: 'en_windows_10_22h2_x64_dvd.iso',
        id: 'cbd65d54-328d-425c-addf-c75c61afd304',
        createdAt: '2023-03-22T12:51:44.160Z'
      }
    ])
  })
})
