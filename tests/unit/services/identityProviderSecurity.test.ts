import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'
import dns from 'dns'

import { IdentityProviderService, decryptSecret } from '../../../app/services/identity/IdentityProviderService'

const mockBind = jest.fn()
const mockSearch = jest.fn()
const mockUnbind = jest.fn()

jest.mock('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    search: mockSearch,
    unbind: mockUnbind
  }))
}))

jest.mock('dns', () => ({ lookup: jest.fn() }))

// Enabled provider used by the authenticateUser bind path.
const enabledProvider = {
  id: 'provider-1',
  enabled: true,
  host: 'ad.example.com',
  port: 636,
  useTls: true,
  tlsCa: null,
  tlsInsecureSkipVerify: false,
  bindPasswordSecret: null
}

describe('IdentityProviderService security primitives', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: IdentityProviderService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new IdentityProviderService(prisma)
    mockUnbind.mockResolvedValue(undefined as never)
  })

  describe('bind-secret encryption (encrypt/decrypt round-trip)', () => {
    it('round-trips a bind password through buildCreateData + decryptSecret', async () => {
      const data = await service.buildCreateData({
        name: 'Corporate AD',
        providerType: 'ACTIVE_DIRECTORY',
        host: 'ad.example.com',
        baseDn: 'DC=example,DC=com',
        bindDn: 'CN=Bind,DC=example,DC=com',
        bindPassword: 'S3cret!pass'
      })
      const secret = data.bindPasswordSecret as string
      expect(typeof secret).toBe('string')
      expect(secret).toMatch(/^v1:/)
      // The stored value is NOT the cleartext password.
      expect(secret).not.toContain('S3cret!pass')
      expect(decryptSecret(secret)).toBe('S3cret!pass')
    })

    it('throws (auth-tag mismatch) when the stored secret is tampered with', async () => {
      const data = await service.buildCreateData({
        name: 'Corporate AD',
        providerType: 'ACTIVE_DIRECTORY',
        host: 'ad.example.com',
        baseDn: 'DC=example,DC=com',
        bindPassword: 'S3cret!pass'
      })
      const secret = data.bindPasswordSecret as string
      // Flip the final character of the ciphertext segment to break the GCM tag.
      const tampered = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A')
      expect(() => decryptSecret(tampered)).toThrow()
    })
  })

  describe('authenticateUser', () => {
    it('returns false WITHOUT binding when the password is empty', async () => {
      const ok = await service.authenticateUser('provider-1', 'CN=User,DC=example,DC=com', '')
      expect(ok).toBe(false)
      expect(prisma.identityProvider.findUnique).not.toHaveBeenCalled()
      expect(mockBind).not.toHaveBeenCalled()
    })

    it('returns false WITHOUT binding when the userDn is empty', async () => {
      const ok = await service.authenticateUser('provider-1', '', 'somepass')
      expect(ok).toBe(false)
      expect(mockBind).not.toHaveBeenCalled()
    })

    it('returns true when the directory bind succeeds', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(enabledProvider as never)
      mockBind.mockResolvedValue(undefined as never)

      const ok = await service.authenticateUser('provider-1', 'CN=User,DC=example,DC=com', 'goodpass')

      expect(ok).toBe(true)
      expect(mockBind).toHaveBeenCalledWith('CN=User,DC=example,DC=com', 'goodpass')
    })

    it('returns false when the directory bind rejects (wrong password)', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(enabledProvider as never)
      mockBind.mockRejectedValue(new Error('invalid credentials') as never)

      const ok = await service.authenticateUser('provider-1', 'CN=User,DC=example,DC=com', 'wrongpass')

      expect(ok).toBe(false)
    })
  })

  describe('testConnection SSRF guard', () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevAllow = process.env.IDENTITY_ALLOW_PRIVATE_TARGETS

    afterEach(() => {
      process.env.NODE_ENV = prevNodeEnv
      if (prevAllow === undefined) delete process.env.IDENTITY_ALLOW_PRIVATE_TARGETS
      else process.env.IDENTITY_ALLOW_PRIVATE_TARGETS = prevAllow
    })

    it('blocks a target that resolves to a private address in production, without opening a socket', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.IDENTITY_ALLOW_PRIVATE_TARGETS
      ;(dns as unknown as { lookup: jest.Mock }).lookup.mockImplementation(
        ((_host: string, _opts: unknown, cb: (e: unknown, r: unknown) => void) =>
          cb(null, [{ address: '10.0.0.5', family: 4 }])) as never
      )

      const result = await service.testConnection({ host: 'sneaky.internal', port: 389, useTls: false })

      expect(result.success).toBe(false)
    })
  })
})
