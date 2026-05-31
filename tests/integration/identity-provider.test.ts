import 'reflect-metadata'
import { IdentitySyncStatus } from '@prisma/client'
import { IdentityProviderResolver } from '@resolvers/identity/resolver'
import { IdentityProviderKind } from '@resolvers/identity/type'
import { UserRole } from '@resolvers/user/type'
import { InfinibayContext } from '@utils/context'
import { testPrisma } from '../setup/jest.setup'
import { createAdmin, createUser } from '../setup/db-factories'

describe('Identity provider management — real database', () => {
  const prisma = testPrisma.prisma
  let resolver: IdentityProviderResolver

  beforeEach(() => {
    resolver = new IdentityProviderResolver()
  })

  async function contextFor (role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN'): Promise<InfinibayContext> {
    const user = role === 'SUPER_ADMIN'
      ? await createAdmin(prisma, { role: 'SUPER_ADMIN' })
      : await createAdmin(prisma)

    return {
      req: {} as never,
      res: {} as never,
      user,
      prisma,
      setupMode: false
    }
  }

  it('creates and updates an AD connector without exposing the bind password', async () => {
    const ctx = await contextFor()

    const created = await resolver.createIdentityProvider({
      name: 'Corporate AD',
      providerType: IdentityProviderKind.ACTIVE_DIRECTORY,
      enabled: true,
      domain: 'corp.example.com',
      host: 'ad.corp.example.com',
      port: 636,
      useTls: true,
      baseDn: 'DC=corp,DC=example,DC=com',
      bindDn: 'CN=Bind,OU=Service Accounts,DC=corp,DC=example,DC=com',
      bindPassword: 'SecretPassword123!',
      userFilter: '(objectClass=user)',
      groupFilter: '(objectClass=group)'
    }, ctx)

    expect(created.hasBindPassword).toBe(true)
    expect(created.port).toBe(636)
    expect(created.useTls).toBe(true)

    const row = await prisma.identityProvider.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.bindPasswordSecret).toBeTruthy()
    expect(row.bindPasswordSecret).not.toContain('SecretPassword123!')

    const updated = await resolver.updateIdentityProvider(created.id, {
      name: 'Corporate Directory',
      bindPassword: ''
    }, ctx)

    expect(updated.name).toBe('Corporate Directory')
    expect(updated.hasBindPassword).toBe(false)
    await expect(prisma.identityProvider.findUniqueOrThrow({ where: { id: created.id } }))
      .resolves.toMatchObject({ bindPasswordSecret: null })
  })

  it('persists sync run history for a connector', async () => {
    const ctx = await contextFor()
    const provider = await resolver.createIdentityProvider({
      name: 'Sync History AD',
      providerType: IdentityProviderKind.ACTIVE_DIRECTORY,
      host: 'ad.corp.example.com',
      baseDn: 'DC=corp,DC=example,DC=com'
    }, ctx)

    await prisma.identitySyncRun.create({
      data: {
        providerId: provider.id,
        status: IdentitySyncStatus.SUCCESS,
        finishedAt: new Date(),
        usersCreated: 2,
        usersUpdated: 1,
        groupsSeen: 3,
        message: 'Directory sync completed'
      }
    })

    const runs = await resolver.identitySyncRuns(provider.id, ctx)

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      providerId: provider.id,
      status: IdentitySyncStatus.SUCCESS,
      usersCreated: 2,
      usersUpdated: 1,
      groupsSeen: 3
    })
  })

  it('upserts group role mappings and restricts SUPER_ADMIN mapping to SUPER_ADMIN users', async () => {
    const adminCtx = await contextFor('ADMIN')
    const superAdminCtx = await contextFor('SUPER_ADMIN')
    const provider = await resolver.createIdentityProvider({
      name: 'Role Mapping AD',
      providerType: IdentityProviderKind.ACTIVE_DIRECTORY,
      host: 'ad.corp.example.com',
      baseDn: 'DC=corp,DC=example,DC=com'
    }, adminCtx)

    const groupDn = 'CN=VDI Admins,OU=Groups,DC=corp,DC=example,DC=com'
    const mapping = await resolver.upsertIdentityGroupRoleMapping({
      providerId: provider.id,
      groupDn,
      role: UserRole.ADMIN
    }, adminCtx)

    expect(mapping).toMatchObject({
      providerId: provider.id,
      groupDn,
      groupName: 'VDI Admins',
      role: UserRole.ADMIN
    })

    await expect(
      resolver.upsertIdentityGroupRoleMapping({
        providerId: provider.id,
        groupDn,
        role: UserRole.SUPER_ADMIN
      }, adminCtx)
    ).rejects.toThrow('Only SUPER_ADMIN users can map directory groups to SUPER_ADMIN')

    const promoted = await resolver.upsertIdentityGroupRoleMapping({
      providerId: provider.id,
      groupDn,
      role: UserRole.SUPER_ADMIN
    }, superAdminCtx)

    expect(promoted.role).toBe(UserRole.SUPER_ADMIN)
    await expect(prisma.identityGroupRoleMapping.count({
      where: { providerId: provider.id, groupDn }
    })).resolves.toBe(1)
  })

  it('denies identity management when role permissions revoke identity access', async () => {
    const user = await createUser(prisma)
    const ctx: InfinibayContext = {
      req: {} as never,
      res: {} as never,
      user,
      prisma,
      setupMode: false
    }

    await expect(resolver.identityProviders(ctx)).rejects.toThrow('Not authorized to access identity')
  })
})
