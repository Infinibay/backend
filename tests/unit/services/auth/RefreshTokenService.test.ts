import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

import {
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS
} from '../../../../app/services/auth/RefreshTokenService'

const DAY_MS = 24 * 60 * 60 * 1000

describe('RefreshTokenService', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
  })

  describe('hashToken', () => {
    it('produces a deterministic sha256 hex digest', () => {
      const a = hashToken('hello-world')
      const b = hashToken('hello-world')
      expect(a).toBe(b)
      // sha256 hex is 64 lowercase hex characters
      expect(a).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces different digests for different inputs', () => {
      expect(hashToken('alpha')).not.toBe(hashToken('beta'))
    })

    it('matches the known sha256 of a fixed string', () => {
      // sha256('abc') is a well-known fixed value
      expect(hashToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      )
    })
  })

  describe('ACCESS_TOKEN_TTL_SECONDS', () => {
    it('is a positive number', () => {
      expect(typeof ACCESS_TOKEN_TTL_SECONDS).toBe('number')
      expect(ACCESS_TOKEN_TTL_SECONDS).toBeGreaterThan(0)
    })
  })

  describe('issueRefreshToken', () => {
    it('creates a row whose tokenHash is the hash of the returned raw token', async () => {
      prisma.refreshToken.create.mockResolvedValue({} as never)

      const result = await issueRefreshToken(prisma, 'user-1')

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1)
      const createArg = prisma.refreshToken.create.mock.calls[0][0] as {
        data: { userId: string, tokenHash: string, expiresAt: Date }
      }
      expect(createArg.data.userId).toBe('user-1')
      expect(createArg.data.tokenHash).toBe(hashToken(result.token))
    })

    it('returns a raw token that is NOT the stored hash', async () => {
      prisma.refreshToken.create.mockResolvedValue({} as never)

      const result = await issueRefreshToken(prisma, 'user-1')

      const createArg = prisma.refreshToken.create.mock.calls[0][0] as {
        data: { tokenHash: string }
      }
      expect(result.token).not.toBe(createArg.data.tokenHash)
      expect(result.token.length).toBeGreaterThan(0)
    })

    it('sets expiresAt in the future ~REFRESH_TOKEN_TTL_DAYS away', async () => {
      prisma.refreshToken.create.mockResolvedValue({} as never)

      const before = Date.now()
      const result = await issueRefreshToken(prisma, 'user-1')
      const after = Date.now()

      expect(result.expiresAt.getTime()).toBeGreaterThan(after)
      const expectedMin = before + REFRESH_TOKEN_TTL_DAYS * DAY_MS
      const expectedMax = after + REFRESH_TOKEN_TTL_DAYS * DAY_MS
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax)
    })

    it('persists the same expiresAt it returns', async () => {
      prisma.refreshToken.create.mockResolvedValue({} as never)

      const result = await issueRefreshToken(prisma, 'user-1')

      const createArg = prisma.refreshToken.create.mock.calls[0][0] as {
        data: { expiresAt: Date }
      }
      expect(createArg.data.expiresAt.getTime()).toBe(result.expiresAt.getTime())
    })
  })

  describe('rotateRefreshToken', () => {
    beforeEach(() => {
      // $transaction receives an array of prisma promises; resolve them as-is
      prisma.$transaction.mockImplementation(((arg: unknown) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg as Array<Promise<unknown>>)
        }
        return (arg as (tx: unknown) => unknown)(prisma)
      }) as never)
    })

    it('revokes the old row, creates a new one, and returns a NEW token', async () => {
      const rawToken = 'old-raw-token'
      const existing = {
        id: 'token-row-1',
        userId: 'user-42',
        tokenHash: hashToken(rawToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 5 * DAY_MS),
        createdAt: new Date()
      }
      prisma.refreshToken.findUnique.mockResolvedValue(existing as never)
      // Rotation is now an atomic compare-and-set: the old row is revoked via a
      // conditional updateMany that must match exactly one row (count === 1).
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never)
      prisma.refreshToken.create.mockResolvedValue({} as never)

      const result = await rotateRefreshToken(prisma, rawToken)

      expect(result).not.toBeNull()
      expect(result?.userId).toBe('user-42')
      // returned token is brand new, not the presented one
      expect(result?.token).not.toBe(rawToken)
      expect(result?.expiresAt.getTime()).toBeGreaterThan(Date.now())

      // looked up by hash of presented token
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashToken(rawToken) }
      })

      // old row revoked via the atomic conditional updateMany (only flips a still
      // -valid, non-revoked row → revokedAt Date), redeeming the token exactly once
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1)
      const updateArg = prisma.refreshToken.updateMany.mock.calls[0][0] as {
        where: { id: string, revokedAt: null, expiresAt: { gt: Date } }
        data: { revokedAt: Date }
      }
      expect(updateArg.where).toEqual({
        id: 'token-row-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      })
      expect(updateArg.data.revokedAt).toBeInstanceOf(Date)

      // new row created with hash of the returned token
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1)
      const createArg = prisma.refreshToken.create.mock.calls[0][0] as {
        data: { userId: string, tokenHash: string, expiresAt: Date }
      }
      expect(createArg.data.userId).toBe('user-42')
      expect(createArg.data.tokenHash).toBe(hashToken(result!.token))

      // the rotation went through a transaction
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('returns null when the hash is not found', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null as never)

      const result = await rotateRefreshToken(prisma, 'missing-token')

      expect(result).toBeNull()
      expect(prisma.refreshToken.update).not.toHaveBeenCalled()
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns null when the row is already revoked', async () => {
      const rawToken = 'revoked-token'
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-row-2',
        userId: 'user-7',
        tokenHash: hashToken(rawToken),
        revokedAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 5 * DAY_MS),
        createdAt: new Date()
      } as never)

      const result = await rotateRefreshToken(prisma, rawToken)

      expect(result).toBeNull()
      expect(prisma.refreshToken.update).not.toHaveBeenCalled()
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns null when the row is expired', async () => {
      const rawToken = 'expired-token'
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'token-row-3',
        userId: 'user-9',
        tokenHash: hashToken(rawToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date()
      } as never)

      const result = await rotateRefreshToken(prisma, rawToken)

      expect(result).toBeNull()
      expect(prisma.refreshToken.update).not.toHaveBeenCalled()
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('revokeAllForUser', () => {
    it('calls updateMany scoped to non-revoked tokens for the user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 } as never)

      await revokeAllForUser(prisma, 'user-99')

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1)
      const arg = prisma.refreshToken.updateMany.mock.calls[0][0] as {
        where: { userId: string, revokedAt: null }
        data: { revokedAt: Date }
      }
      expect(arg.where).toEqual({ userId: 'user-99', revokedAt: null })
      expect(arg.data.revokedAt).toBeInstanceOf(Date)
    })
  })
})
