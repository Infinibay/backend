import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { IdentityProviderType, PrismaClient, UserRole } from '@prisma/client'

import { IdentityProviderService } from '../../../app/services/identity/IdentityProviderService'

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

// Minimal AD-style provider row. No bindDn so syncProvider skips the bind step
// and goes straight to the user search we control below.
const baseProvider = {
  id: 'provider-1',
  name: 'Corporate AD',
  providerType: IdentityProviderType.ACTIVE_DIRECTORY,
  status: 'CONNECTED',
  enabled: true,
  domain: 'example.com',
  host: 'ad.example.com',
  port: 636,
  useTls: true,
  baseDn: 'DC=example,DC=com',
  bindDn: null,
  bindPasswordSecret: null,
  userFilter: '(objectClass=user)',
  // groupFilter null => syncProvider skips the second (group) search entirely.
  groupFilter: null,
  attributes: null,
  lastTestAt: null,
  lastSyncAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date()
}

describe('IdentityProviderService.syncProvider', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: IdentityProviderService

  // Wire up the prisma calls that every run makes (run/provider bookkeeping,
  // group-role mappings). Per-test we override user.* and the search entries.
  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new IdentityProviderService(prisma)
    mockUnbind.mockResolvedValue(undefined as never)

    prisma.identityProvider.findUnique.mockResolvedValue(baseProvider as never)
    prisma.identitySyncRun.create.mockResolvedValue({ id: 'sync-1' } as never)
    prisma.identitySyncRun.update.mockResolvedValue({ id: 'sync-1' } as never)
    prisma.identityProvider.update.mockResolvedValue(baseProvider as never)
    prisma.identityGroupRoleMapping.findMany.mockResolvedValue([] as never)
    // Default: no linked users to deprovision unless a test overrides it.
    prisma.user.findMany.mockResolvedValue([] as never)
    prisma.user.update.mockResolvedValue({ id: 'updated' } as never)
    prisma.user.create.mockResolvedValue({ id: 'created' } as never)
  })

  it('does not hijack an email-matched local user that is already linked to another provider, but adopts an unlinked one', async () => {
    // No row is linked to THIS provider by externalId for either entry.
    prisma.user.findFirst.mockResolvedValue(null as never)

    // First entry's email belongs to a user already linked to a DIFFERENT
    // provider; second entry's email belongs to a truly unlinked local user.
    prisma.user.findUnique.mockImplementation((async (args: any) => {
      if (args.where.email === 'linked@example.com') {
        return {
          id: 'user-linked',
          email: 'linked@example.com',
          role: UserRole.USER,
          identityProviderId: 'other-provider',
          externalId: 'other-ext-id'
        }
      }
      if (args.where.email === 'unlinked@example.com') {
        return {
          id: 'user-unlinked',
          email: 'unlinked@example.com',
          role: UserRole.USER,
          identityProviderId: null,
          externalId: null
        }
      }
      return null
    }) as never)

    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Linked,OU=Users,DC=example,DC=com',
          mail: 'linked@example.com',
          givenName: 'Linked',
          sn: 'User',
          objectGUID: Buffer.from('guid-linked')
        },
        {
          dn: 'CN=Unlinked,OU=Users,DC=example,DC=com',
          mail: 'unlinked@example.com',
          givenName: 'Unlinked',
          sn: 'User',
          objectGUID: Buffer.from('guid-unlinked')
        }
      ],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)

    const updateCalls = prisma.user.update.mock.calls
    // The already-linked row must NEVER be re-pointed by the email key.
    expect(updateCalls.some(([call]: any) => call.where.id === 'user-linked')).toBe(false)
    // The unlinked row IS adopted (updated and pointed at this provider).
    const adopt = updateCalls.find(([call]: any) => call.where.id === 'user-unlinked')
    expect(adopt).toBeDefined()
    // Adopted: pointed at THIS provider with an externalId derived from the
    // entry (objectGUID is binary, so the impl stores its hex encoding — we only
    // assert it was set, not its exact encoding).
    expect((adopt as any[])[0].data).toMatchObject({ identityProviderId: 'provider-1' })
    expect((adopt as any[])[0].data.externalId).toBeTruthy()
  })

  it('keeps an existing ADMIN user at ADMIN when the entry reports no memberOf (no role downgrade)', async () => {
    // The entry matches an existing linked ADMIN via externalId.
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-admin',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      identityProviderId: 'provider-1',
      externalId: 'guid-admin'
    } as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Admin,OU=Users,DC=example,DC=com',
          mail: 'admin@example.com',
          givenName: 'Admin',
          sn: 'User',
          objectGUID: Buffer.from('guid-admin')
          // intentionally no memberOf attribute
        }
      ],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)
    const updateCall = prisma.user.update.mock.calls
      .find(([call]: any) => call.where.id === 'user-admin') as any[]
    expect(updateCall).toBeDefined()
    // role must be left untouched (not written down to USER).
    expect(updateCall[0].data.role).toBeUndefined()
    expect(updateCall[0].data).not.toMatchObject({ role: UserRole.USER })
  })

  it('soft-deletes a previously-linked user whose externalId is absent from a non-empty run', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    // One fresh user is seen this run (externalId guid-seen).
    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Seen,OU=Users,DC=example,DC=com',
          mail: 'seen@example.com',
          givenName: 'Seen',
          sn: 'User',
          objectGUID: Buffer.from('guid-seen')
        }
      ],
      searchReferences: []
    } as never)

    // A previously-linked user (guid-stale) was NOT in this run's entries.
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-stale', externalId: 'guid-stale' }
    ] as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)
    const deprovision = prisma.user.update.mock.calls
      .find(([call]: any) => call.where.id === 'user-stale') as any[]
    expect(deprovision).toBeDefined()
    expect(deprovision[0].data).toMatchObject({ deleted: true })
    expect(result.usersDisabled).toBeGreaterThanOrEqual(1)
  })

  it('does NOT mass-disable users when the directory search returns zero entries', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    mockSearch.mockResolvedValue({
      searchEntries: [],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)
    // The deprovision pass is guarded by searchEntries.length > 0, so the
    // linked-users query must never run and nothing gets disabled.
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(result.usersDisabled).toBe(0)
  })

  it('soft-deletes a user whose entry has the ACCOUNTDISABLE bit (0x2) set and counts it disabled', async () => {
    // Existing linked user so we take the update path.
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-disabled',
      email: 'disabled@example.com',
      role: UserRole.USER,
      identityProviderId: 'provider-1',
      externalId: 'guid-disabled'
    } as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Disabled,OU=Users,DC=example,DC=com',
          mail: 'disabled@example.com',
          givenName: 'Disabled',
          sn: 'User',
          objectGUID: Buffer.from('guid-disabled'),
          // 0x2 (ACCOUNTDISABLE) set => 514 = 0x202
          userAccountControl: '514'
        }
      ],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)
    const updateCall = prisma.user.update.mock.calls
      .find(([call]: any) => call.where.id === 'user-disabled') as any[]
    expect(updateCall).toBeDefined()
    expect(updateCall[0].data).toMatchObject({ deleted: true })
    expect(result.usersDisabled).toBe(1)
    expect(result.usersUpdated).toBe(0)
  })

  it('continues the run when one entry fails (P2002) and still processes the others', async () => {
    prisma.user.findFirst.mockResolvedValue(null as never)
    prisma.user.findUnique.mockResolvedValue(null as never)

    // First create rejects with a unique-constraint style error; second succeeds.
    prisma.user.create
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) as never)
      .mockResolvedValueOnce({ id: 'user-ok' } as never)

    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Boom,OU=Users,DC=example,DC=com',
          mail: 'boom@example.com',
          givenName: 'Boom',
          sn: 'User',
          objectGUID: Buffer.from('guid-boom')
        },
        {
          dn: 'CN=Fine,OU=Users,DC=example,DC=com',
          mail: 'fine@example.com',
          givenName: 'Fine',
          sn: 'User',
          objectGUID: Buffer.from('guid-fine')
        }
      ],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    // Per-entry try/catch keeps the whole run alive: it completes successfully.
    expect(result.success).toBe(true)
    // Both entries were attempted; the failing one did not abort the loop.
    expect(prisma.user.create).toHaveBeenCalledTimes(2)
    // The surviving entry was created.
    expect(result.usersCreated).toBe(1)
    // The run still finishes as SUCCESS (entry-level failures don't error the run).
    const runUpdate = prisma.identitySyncRun.update.mock.calls
      .find(([call]: any) => call.data.status) as any[]
    expect(runUpdate[0].data.status).toBe('SUCCESS')
  })
})
