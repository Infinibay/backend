import { Arg, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'
import { IdentityGroupRoleMapping, IdentityProvider as PrismaIdentityProvider, IdentitySyncRun, PrismaClient } from '@prisma/client'
import { UserInputError } from '@utils/errors'
import { InfinibayContext } from '@utils/context'
import {
  CreateIdentityProviderInput,
  IdentityGroupRoleMappingType,
  IdentityProviderKind,
  IdentityProviderConnectionResultType,
  IdentityProviderSyncResultType,
  IdentityProviderState,
  IdentityProviderType,
  IdentitySyncRunType,
  UpsertIdentityGroupRoleMappingInput,
  UpdateIdentityProviderInput
} from './type'
import { UserRole } from '../user/type'
import { IdentityProviderService } from '../../../services/identity/IdentityProviderService'
import { Can } from '@main/permissions'

function toIdentityProviderType (provider: PrismaIdentityProvider): IdentityProviderType {
  return {
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType as IdentityProviderKind,
    status: provider.status as IdentityProviderState,
    enabled: provider.enabled,
    domain: provider.domain,
    host: provider.host,
    port: provider.port,
    useTls: provider.useTls,
    baseDn: provider.baseDn,
    bindDn: provider.bindDn,
    hasBindPassword: !!provider.bindPasswordSecret,
    userFilter: provider.userFilter,
    groupFilter: provider.groupFilter,
    attributes: provider.attributes,
    lastTestAt: provider.lastTestAt,
    lastSyncAt: provider.lastSyncAt,
    lastError: provider.lastError,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  }
}

function toIdentitySyncRunType (run: IdentitySyncRun): IdentitySyncRunType {
  return {
    id: run.id,
    providerId: run.providerId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    usersCreated: run.usersCreated,
    usersUpdated: run.usersUpdated,
    usersDisabled: run.usersDisabled,
    groupsSeen: run.groupsSeen,
    message: run.message,
    error: run.error
  }
}

function groupNameFromDn (groupDn: string): string {
  const match = groupDn.match(/(?:^|,)CN=([^,]+)/i)
  return match?.[1] ? match[1].replace(/\\,/g, ',') : groupDn
}

function toIdentityGroupRoleMappingType (mapping: IdentityGroupRoleMapping): IdentityGroupRoleMappingType {
  return {
    id: mapping.id,
    providerId: mapping.providerId,
    groupDn: mapping.groupDn,
    groupName: mapping.groupName,
    role: mapping.role as UserRole,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt
  }
}

@Resolver(() => IdentityProviderType)
export class IdentityProviderResolver {
  private service (prisma: PrismaClient): IdentityProviderService {
    return new IdentityProviderService(prisma)
  }

  @Query(() => [IdentityProviderType])
  @Can('identityProvider:view')
  async identityProviders (
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderType[]> {
    const { prisma } = context
    const providers = await prisma.identityProvider.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }]
    })
    return providers.map(toIdentityProviderType)
  }

  @Query(() => IdentityProviderType, { nullable: true })
  @Can('identityProvider:view', { id: (a) => a.id })
  async identityProvider (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderType | null> {
    const { prisma } = context
    const provider = await prisma.identityProvider.findUnique({ where: { id } })
    return provider ? toIdentityProviderType(provider) : null
  }

  @Query(() => [IdentitySyncRunType])
  @Can('identityProvider:view', { id: (a) => a.providerId })
  async identitySyncRuns (
    @Arg('providerId', () => ID) providerId: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentitySyncRunType[]> {
    const { prisma } = context
    const provider = await prisma.identityProvider.findUnique({
      where: { id: providerId },
      select: { id: true }
    })
    if (!provider) throw new UserInputError('Identity provider not found')

    const runs = await prisma.identitySyncRun.findMany({
      where: { providerId },
      orderBy: { startedAt: 'desc' },
      take: 25
    })
    return runs.map(toIdentitySyncRunType)
  }

  @Query(() => [IdentityGroupRoleMappingType])
  @Can('identityProvider:view', { id: (a) => a.providerId })
  async identityGroupRoleMappings (
    @Arg('providerId', () => ID) providerId: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityGroupRoleMappingType[]> {
    const { prisma } = context
    const mappings = await prisma.identityGroupRoleMapping.findMany({
      where: { providerId },
      orderBy: { groupName: 'asc' }
    })
    return mappings.map(toIdentityGroupRoleMappingType)
  }

  @Mutation(() => IdentityProviderType)
  @Can('identityProvider:create')
  async createIdentityProvider (
    @Arg('input') input: CreateIdentityProviderInput,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderType> {
    const { prisma } = context
    try {
      const provider = await prisma.identityProvider.create({
        data: this.service(prisma).buildCreateData(input)
      })
      return toIdentityProviderType(provider)
    } catch (error) {
      throw new UserInputError((error as Error).message)
    }
  }

  @Mutation(() => IdentityProviderType)
  @Can('identityProvider:edit', { id: (a) => a.id })
  async updateIdentityProvider (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateIdentityProviderInput,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderType> {
    const { prisma } = context
    try {
      const provider = await prisma.identityProvider.update({
        where: { id },
        data: this.service(prisma).buildUpdateData(input)
      })
      return toIdentityProviderType(provider)
    } catch (error) {
      throw new UserInputError((error as Error).message)
    }
  }

  @Mutation(() => Boolean)
  @Can('identityProvider:delete', { id: (a) => a.id })
  async deleteIdentityProvider (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = context
    await prisma.identityProvider.delete({ where: { id } })
    return true
  }

  @Mutation(() => IdentityGroupRoleMappingType)
  @Can('identityProvider:assign', { id: (a) => a.input.providerId })
  async upsertIdentityGroupRoleMapping (
    @Arg('input') input: UpsertIdentityGroupRoleMappingInput,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityGroupRoleMappingType> {
    const { prisma, user } = context

    const groupDn = input.groupDn.trim()
    if (!groupDn) throw new UserInputError('Group DN is required')
    if (input.role === UserRole.SUPER_ADMIN && user?.role !== UserRole.SUPER_ADMIN) {
      throw new UserInputError('Only SUPER_ADMIN users can map directory groups to SUPER_ADMIN')
    }

    const provider = await prisma.identityProvider.findUnique({
      where: { id: input.providerId },
      select: { id: true }
    })
    if (!provider) throw new UserInputError('Identity provider not found')

    const mapping = await prisma.identityGroupRoleMapping.upsert({
      where: {
        providerId_groupDn: {
          providerId: input.providerId,
          groupDn
        }
      },
      create: {
        providerId: input.providerId,
        groupDn,
        groupName: input.groupName?.trim() || groupNameFromDn(groupDn),
        role: input.role
      },
      update: {
        groupName: input.groupName?.trim() || groupNameFromDn(groupDn),
        role: input.role
      }
    })

    return toIdentityGroupRoleMappingType(mapping)
  }

  @Mutation(() => Boolean)
  @Can('identityProvider:assign')
  async deleteIdentityGroupRoleMapping (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = context
    await prisma.identityGroupRoleMapping.delete({ where: { id } })
    return true
  }

  @Mutation(() => IdentityProviderConnectionResultType)
  @Can('identityProvider:test', { id: (a) => a.id })
  async testIdentityProvider (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderConnectionResultType> {
    const { prisma } = context
    const provider = await prisma.identityProvider.findUnique({ where: { id } })
    if (!provider) throw new UserInputError('Identity provider not found')

    const result = await this.service(prisma).testConnection({
      host: provider.host,
      port: provider.port,
      useTls: provider.useTls
    })
    const updatedProvider = await prisma.identityProvider.update({
      where: { id },
      data: {
        status: result.success ? 'CONNECTED' : 'ERROR',
        lastTestAt: new Date(),
        lastError: result.success ? null : result.message
      }
    })

    return {
      ...result,
      provider: toIdentityProviderType(updatedProvider)
    }
  }

  @Mutation(() => IdentityProviderConnectionResultType)
  @Can('identityProvider:test')
  async testIdentityProviderConfig (
    @Arg('input') input: CreateIdentityProviderInput,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderConnectionResultType> {
    const { prisma } = context
    try {
      const data = this.service(prisma).buildCreateData(input)
      return this.service(prisma).testConnection({
        host: data.host,
        port: data.port ?? (data.useTls ? 636 : 389),
        useTls: data.useTls ?? false
      })
    } catch (error) {
      return {
        success: false,
        message: (error as Error).message
      }
    }
  }

  @Mutation(() => IdentityProviderSyncResultType)
  @Can('identityProvider:test', { id: (a) => a.id })
  async syncIdentityProvider (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderSyncResultType> {
    const { prisma } = context
    const result = await this.service(prisma).syncProvider(id)
    const provider = await prisma.identityProvider.findUnique({ where: { id } })

    return {
      ...result,
      provider: provider ? toIdentityProviderType(provider) : null
    }
  }
}
