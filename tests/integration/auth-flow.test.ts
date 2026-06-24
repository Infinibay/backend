import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

import { UserResolver } from '@resolvers/user/resolver'
import { IdentityProviderService } from '@services/identity/IdentityProviderService'
import { AuthenticationError } from '@utils/errors'
import { hashToken, ACCESS_TOKEN_TTL_SECONDS } from '@services/auth/RefreshTokenService'
import type { InfinibayContext } from '@utils/context'

// These integration tests drive the login / refresh / logout resolver methods
// directly against a deeply-mocked PrismaClient so every input (directory user,
// stored refresh-token rows, etc.) is fully controlled and no real LDAP server
// or shared test DB is touched. The in-memory login rate limiter is real, so
// each test that touches it uses a UNIQUE email+ip key to stay isolated.

const TEST_SECRET = 'test-secret-key'

// A real bcrypt hash of a known password — used to prove that for a DIRECTORY
// user bcrypt is NOT consulted (login succeeds even though the supplied password
// would fail bcrypt.compare against this hash).
const PLACEHOLDER_HASH = bcrypt.hashSync('a-completely-different-password', 4)

interface MockedPrisma extends ReturnType<typeof mockDeep<PrismaClient>> {}

function buildContext (
  prisma: PrismaClient,
  overrides: Partial<InfinibayContext> = {}
): InfinibayContext {
  return {
    req: { ip: '1.2.3.4', socket: { remoteAddress: '1.2.3.4' } },
    res: {},
    user: null,
    prisma,
    setupMode: false,
    ...overrides
  } as unknown as InfinibayContext
}

function directoryUser (email: string) {
  return {
    id: 'dir-user-1',
    email,
    password: PLACEHOLDER_HASH,
    firstName: 'Dir',
    lastName: 'User',
    role: 'USER',
    deleted: false,
    identityProviderId: 'provider-1',
    externalDn: 'CN=Dir User,OU=Users,DC=example,DC=com',
    externalId: 'ext-1',
    roleId: null,
    tokenInvalidatedAt: null,
    lastDirectorySyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }
}

describe('Auth flow — login / refresh / logout (mocked prisma)', () => {
  let prisma: MockedPrisma
  let resolver: UserResolver

  beforeEach(() => {
    process.env.TOKENKEY = TEST_SECRET
    jest.restoreAllMocks()
    prisma = mockDeep<PrismaClient>() as MockedPrisma
    resolver = new UserResolver()
  })

  describe('login — directory (bind-authoritative) user', () => {
    it('authenticates a directory user via authenticateUser even though bcrypt would fail', async () => {
      const email = 'dir-bind@auth-flow.test'
      const user = directoryUser(email)

      prisma.user.findFirst.mockResolvedValue(user as never)
      prisma.user.update.mockResolvedValue(user as never)
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' } as never)

      // The directory bind succeeds...
      const authSpy = jest
        .spyOn(IdentityProviderService.prototype, 'authenticateUser')
        .mockResolvedValue(true)
      // ...but bcrypt.compare against the stored placeholder hash would FAIL.
      const bcryptSpy = jest.spyOn(bcrypt, 'compare')

      const ctx = buildContext(prisma)
      const result = await resolver.login(email, 'whatever-the-directory-accepts', ctx)

      expect(result).not.toBeNull()
      // Provider bind was the deciding factor, called with the user's externalDn.
      expect(authSpy).toHaveBeenCalledWith(
        'provider-1',
        'CN=Dir User,OU=Users,DC=example,DC=com',
        'whatever-the-directory-accepts'
      )
      // bcrypt.compare must NOT have been used to gate a directory login.
      expect(bcryptSpy).not.toHaveBeenCalled()
      // A successful directory login stamps lastDirectorySyncAt.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dir-user-1' },
          data: expect.objectContaining({ lastDirectorySyncAt: expect.any(Date) })
        })
      )
    })
  })

  describe('login — return shape', () => {
    it('returns token, a non-empty refreshToken, and a numeric expiresIn', async () => {
      const email = 'shape@auth-flow.test'
      const user = directoryUser(email)

      prisma.user.findFirst.mockResolvedValue(user as never)
      prisma.user.update.mockResolvedValue(user as never)
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-shape' } as never)

      jest
        .spyOn(IdentityProviderService.prototype, 'authenticateUser')
        .mockResolvedValue(true)

      const ctx = buildContext(prisma)
      const result = await resolver.login(email, 'pw', ctx)

      expect(result).not.toBeNull()
      // Access token: a valid JWT signed with the canonical secret.
      expect(typeof result!.token).toBe('string')
      expect(result!.token.length).toBeGreaterThan(0)
      const decoded = jwt.verify(result!.token, TEST_SECRET) as { userId: string, userRole: string }
      expect(decoded.userId).toBe('dir-user-1')
      expect(decoded.userRole).toBe('USER')
      // Refresh token: non-empty opaque string returned exactly once on issue.
      expect(typeof result!.refreshToken).toBe('string')
      expect(result!.refreshToken.length).toBeGreaterThan(0)
      // expiresIn: a number (the access-token TTL in seconds).
      expect(typeof result!.expiresIn).toBe('number')
      expect(result!.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS)
      // The persisted refresh-token row stores only the SHA-256 hash, never the raw.
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'dir-user-1',
            tokenHash: hashToken(result!.refreshToken)
          })
        })
      )
    })
  })

  describe('login — rate limiting', () => {
    it('throws AuthenticationError about too many attempts after repeated failures', async () => {
      // Dedicated email+ip so the in-memory limiter state cannot leak into or out
      // of any other test. The limiter keys on `${email}|${ip}`.
      const email = 'ratelimit-unique@auth-flow.test'
      const ctx = buildContext(prisma, {
        req: { ip: '9.9.9.9', socket: { remoteAddress: '9.9.9.9' } } as never
      })

      // No such user → each attempt records a failure (after the dummy compare).
      prisma.user.findFirst.mockResolvedValue(null as never)

      // First 6 attempts fail with "Invalid credentials". The limiter allows the
      // first 5 freely; the 6th failure arms the lockout.
      for (let i = 0; i < 6; i++) {
        await expect(resolver.login(email, 'wrong', ctx)).rejects.toThrow(AuthenticationError)
      }

      // The 7th attempt is rejected up-front by the rate limiter, with the
      // distinctive "too many" message — before any credential check.
      await expect(resolver.login(email, 'wrong', ctx)).rejects.toThrow(/too many login attempts/i)
    })
  })

  describe('refreshToken mutation', () => {
    it('rotates a valid refresh token into a fresh token + refreshToken pair', async () => {
      const rawToken = 'valid-refresh-token-raw'
      const stored = {
        id: 'rt-old',
        userId: 'dir-user-1',
        tokenHash: hashToken(rawToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date()
      }

      // rotateRefreshToken looks the token up by hash, then runs a transaction
      // (revoke old + create new). We let the real service run against the mock.
      prisma.refreshToken.findUnique.mockResolvedValue(stored as never)
      prisma.$transaction.mockResolvedValue([{}, {}] as never)
      prisma.user.findFirst.mockResolvedValue(
        { ...directoryUser('refresh@auth-flow.test') } as never
      )

      const ctx = buildContext(prisma)
      const result = await resolver.refreshToken(rawToken, ctx)

      expect(typeof result.token).toBe('string')
      expect(result.token.length).toBeGreaterThan(0)
      expect(typeof result.refreshToken).toBe('string')
      expect(result.refreshToken.length).toBeGreaterThan(0)
      // The rotated raw token differs from the one presented.
      expect(result.refreshToken).not.toBe(rawToken)
      expect(result.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS)
      // The new access token is signed with the canonical secret and carries the user.
      const decoded = jwt.verify(result.token, TEST_SECRET) as { userId: string }
      expect(decoded.userId).toBe('dir-user-1')
      // Rotation was performed atomically.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('throws AuthenticationError when the refresh token is unknown/invalid', async () => {
      // Unknown hash → rotateRefreshToken returns null → resolver rejects.
      prisma.refreshToken.findUnique.mockResolvedValue(null as never)

      const ctx = buildContext(prisma)
      await expect(resolver.refreshToken('bogus-token', ctx)).rejects.toThrow(AuthenticationError)
      await expect(resolver.refreshToken('bogus-token', ctx)).rejects.toThrow(/invalid refresh token/i)
      // A rejected refresh never starts a rotation transaction.
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('throws AuthenticationError when the refresh token is expired', async () => {
      const rawToken = 'expired-refresh-token'
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-expired',
        userId: 'dir-user-1',
        tokenHash: hashToken(rawToken),
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000), // already expired
        createdAt: new Date()
      } as never)

      const ctx = buildContext(prisma)
      await expect(resolver.refreshToken(rawToken, ctx)).rejects.toThrow(AuthenticationError)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('logout mutation', () => {
    it('stamps tokenInvalidatedAt and revokes all outstanding refresh tokens', async () => {
      const user = directoryUser('logout@auth-flow.test')
      prisma.user.update.mockResolvedValue(user as never)
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never)

      const ctx = buildContext(prisma, { user: user as never })
      const result = await resolver.logout(ctx)

      expect(result).toBe(true)
      // Access-token revocation cutoff is set on the user.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dir-user-1' },
          data: expect.objectContaining({ tokenInvalidatedAt: expect.any(Date) })
        })
      )
      // Every still-active refresh token for the user is revoked
      // (revokeAllForUser → refreshToken.updateMany where revokedAt is null).
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'dir-user-1', revokedAt: null }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) })
        })
      )
    })

    it('is a no-op returning false when there is no authenticated user', async () => {
      const ctx = buildContext(prisma, { user: null })
      const result = await resolver.logout(ctx)

      expect(result).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    })
  })
})
