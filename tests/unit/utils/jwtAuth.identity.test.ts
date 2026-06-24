import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { Request } from 'express'
import jwt from 'jsonwebtoken'

// Mock the database module - include identityProvider since the new code path calls it
const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<any>
  },
  identityProvider: {
    findUnique: jest.fn() as jest.MockedFunction<any>
  }
}

jest.mock('@utils/database', () => mockPrisma)

// Import after mocking
const { verifyRequestAuth } = jest.requireActual('@utils/jwtAuth') as typeof import('@utils/jwtAuth')

describe('JWT Authentication Identity Tests', () => {
  const testSecret = 'test-secret-key'
  const originalEnv = process.env

  // Base SafeUser-like object returned by the mocked prisma.user.findUnique select.
  // Mirrors the select clause in fetchAndValidateUser (includes tokenInvalidatedAt + identityProviderId).
  const baseUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'USER',
    deleted: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    tokenInvalidatedAt: null as Date | null,
    identityProviderId: null as string | null
  }

  const buildRequest = (token: string): Request => ({
    headers: {
      authorization: `Bearer ${token}`
    }
  } as Request)

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.TOKENKEY = testSecret

    // Default: an enabled/unlinked, non-deleted, role-matching user.
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('rejects a token signed with no exp claim (invalid_payload_exp)', async () => {
    // jwt.sign with no expiresIn adds iat but NOT exp.
    const token = jwt.sign(
      { userId: baseUser.id, userRole: 'USER' },
      testSecret
    )

    const result = await verifyRequestAuth(buildRequest(token), {
      method: 'context',
      debugAuth: false
    })

    expect(result.user).toBeNull()
    expect(result.decoded).toBeNull()
    // invalid_payload_exp maps to the 'token_invalid' status
    expect(result.meta.status).toBe('token_invalid')
  })

  it('rejects a valid token whose iat predates the user tokenInvalidatedAt (token_revoked)', async () => {
    // Sign first so iat is "now", then place the revocation cutoff in the future relative to iat.
    const token = jwt.sign(
      { userId: baseUser.id, userRole: 'USER' },
      testSecret,
      { expiresIn: '24h' }
    )

    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      // iat * 1000 < tokenInvalidatedAt  =>  token considered revoked
      tokenInvalidatedAt: new Date(Date.now() + 60_000)
    })

    const result = await verifyRequestAuth(buildRequest(token), {
      method: 'context',
      debugAuth: false
    })

    expect(result.user).toBeNull()
    expect(result.meta.status).toBe('token_invalid')
  })

  it('rejects a valid token for a user whose identity provider is disabled (provider_disabled)', async () => {
    const token = jwt.sign(
      { userId: baseUser.id, userRole: 'USER' },
      testSecret,
      { expiresIn: '24h' }
    )

    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      identityProviderId: 'provider-id'
    })
    mockPrisma.identityProvider.findUnique.mockResolvedValue({
      id: 'provider-id',
      enabled: false
    })

    const result = await verifyRequestAuth(buildRequest(token), {
      method: 'context',
      debugAuth: false
    })

    expect(result.user).toBeNull()
    expect(result.meta.status).toBe('token_invalid')
    expect(mockPrisma.identityProvider.findUnique).toHaveBeenCalled()
  })

  it('authenticates a valid token for an enabled/unlinked, non-deleted, role-matching user (happy path)', async () => {
    const token = jwt.sign(
      { userId: baseUser.id, userRole: 'USER' },
      testSecret,
      { expiresIn: '24h' }
    )

    const result = await verifyRequestAuth(buildRequest(token), {
      method: 'context',
      debugAuth: false
    })

    expect(result.user).not.toBeNull()
    expect(result.user).toMatchObject({
      id: baseUser.id,
      email: baseUser.email,
      role: 'USER',
      deleted: false
    })
    // validation-only fields are stripped from SafeUser
    expect(result.user).not.toHaveProperty('tokenInvalidatedAt')
    expect(result.user).not.toHaveProperty('identityProviderId')
    expect(result.meta.status).toBe('authenticated')
    // unlinked user => no provider lookup
    expect(mockPrisma.identityProvider.findUnique).not.toHaveBeenCalled()
  })
})
