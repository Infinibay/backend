import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { IdentityProviderType, PrismaClient, UserRole } from '@prisma/client'

import { IdentityProviderService } from '../../../app/services/identity/IdentityProviderService'

const mockBind = jest.fn()
const mockSearch = jest.fn()
const mockUnbind = jest.fn()
const mockClientConstructor = jest.fn()

jest.mock('ldapts', () => ({
  Client: jest.fn().mockImplementation((options) => {
    mockClientConstructor(options)
    return {
      bind: mockBind,
      search: mockSearch,
      unbind: mockUnbind
    }
  })
}))

describe('IdentityProviderService', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: IdentityProviderService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new IdentityProviderService(prisma)
    mockUnbind.mockResolvedValue(undefined as never)
    // syncProvider's deprovision pass queries linked users; default to none so
    // tests that drive a sync don't trip over an unmocked findMany.
    prisma.user.findMany.mockResolvedValue([] as never)
  })

  it('validates saved providers with strict bind credentials', async () => {
    const providerData = await service.buildCreateData({
      name: 'Corporate AD',
      providerType: 'ACTIVE_DIRECTORY',
      host: 'ad.example.com',
      port: 636,
      useTls: true,
      baseDn: 'DC=example,DC=com',
      bindDn: 'CN=Bind,DC=example,DC=com',
      bindPassword: 'SecretPassword123!'
    })
    const provider = {
      id: 'provider-1',
      name: 'Corporate AD',
      providerType: IdentityProviderType.ACTIVE_DIRECTORY,
      status: 'CONNECTED',
      enabled: true,
      domain: null,
      host: 'ad.example.com',
      port: 636,
      useTls: true,
      baseDn: 'DC=example,DC=com',
      bindDn: 'CN=Bind,DC=example,DC=com',
      bindPasswordSecret: providerData.bindPasswordSecret,
      userFilter: '(objectClass=user)',
      groupFilter: null,
      attributes: null,
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    prisma.identityProvider.findUnique.mockResolvedValue(provider as never)
    mockBind.mockResolvedValue(undefined as never)
    jest.spyOn(service, 'testConnection').mockResolvedValue({
      success: true,
      message: 'Directory endpoint is reachable',
      latencyMs: 12
    })

    await expect(service.testSavedProvider('provider-1', { requireBind: true }))
      .resolves.toEqual({
        success: true,
        message: 'Directory endpoint is reachable and bind credentials are valid',
        latencyMs: 12
      })
    expect(mockBind).toHaveBeenCalledWith('CN=Bind,DC=example,DC=com', 'SecretPassword123!')
  })

  it('fails strict saved-provider validation when bind DN is missing', async () => {
    prisma.identityProvider.findUnique.mockResolvedValue({
      id: 'provider-1',
      name: 'Corporate AD',
      providerType: IdentityProviderType.ACTIVE_DIRECTORY,
      status: 'CONNECTED',
      enabled: true,
      domain: null,
      host: 'ad.example.com',
      port: 636,
      useTls: true,
      baseDn: 'DC=example,DC=com',
      bindDn: null,
      bindPasswordSecret: null,
      userFilter: '(objectClass=user)',
      groupFilter: null,
      attributes: null,
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as never)
    jest.spyOn(service, 'testConnection').mockResolvedValue({
      success: true,
      message: 'Directory endpoint is reachable'
    })

    await expect(service.testSavedProvider('provider-1', { requireBind: true }))
      .resolves.toEqual({
        success: false,
        message: 'Bind DN is required for strict directory validation'
      })
  })

  it('maps LDAP group membership to an Infinibay role during sync', async () => {
    const provider = {
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
      groupFilter: null,
      attributes: null,
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    prisma.identityProvider.findUnique.mockResolvedValue(provider as never)
    prisma.identitySyncRun.create.mockResolvedValue({
      id: 'sync-1',
      providerId: 'provider-1',
      status: 'RUNNING',
      startedAt: new Date(),
      finishedAt: null,
      usersCreated: 0,
      usersUpdated: 0,
      usersDisabled: 0,
      groupsSeen: 0,
      message: 'Directory sync started',
      error: null
    } as never)
    prisma.identityGroupRoleMapping.findMany.mockResolvedValue([
      {
        id: 'mapping-1',
        providerId: 'provider-1',
        groupDn: 'CN=VDI Admins,OU=Groups,DC=example,DC=com',
        groupName: 'VDI Admins',
        role: UserRole.ADMIN,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ] as never)
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'user-1' } as never)
    prisma.identitySyncRun.update.mockResolvedValue({ id: 'sync-1' } as never)
    prisma.identityProvider.update.mockResolvedValue(provider as never)

    mockSearch.mockResolvedValue({
      searchEntries: [
        {
          dn: 'CN=Jane Doe,OU=Users,DC=example,DC=com',
          mail: 'jane@example.com',
          givenName: 'Jane',
          sn: 'Doe',
          objectGUID: Buffer.from('guid-1'),
          memberOf: ['CN=VDI Admins,OU=Groups,DC=example,DC=com']
        }
      ],
      searchReferences: []
    } as never)

    const result = await service.syncProvider('provider-1')

    expect(result.success).toBe(true)
    expect(result.usersCreated).toBe(1)
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: UserRole.ADMIN,
        identityProviderId: 'provider-1',
        externalDn: 'CN=Jane Doe,OU=Users,DC=example,DC=com'
      })
    })
  })
})
