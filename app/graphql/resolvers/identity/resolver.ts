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
import { BackgroundTaskService } from '@services/BackgroundTaskService'
import logger from '@main/logger'

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
    tlsCa: provider.tlsCa,
    tlsInsecureSkipVerify: provider.tlsInsecureSkipVerify,
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
    // buildCreateData throws validation errors that are safe to surface verbatim.
    const data = await this.service(prisma).buildCreateData(input)
    try {
      const provider = await prisma.identityProvider.create({ data })
      return toIdentityProviderType(provider)
    } catch (error) {
      // Don't echo raw directory/database errors to the client; log them instead.
      logger.error(`Failed to create identity provider: ${(error as Error).message}`)
      throw new UserInputError('Unable to create the identity provider. Please verify the configuration.')
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
    // buildUpdateData throws validation errors that are safe to surface verbatim.
    const data = await this.service(prisma).buildUpdateData(input)
    try {
      const provider = await prisma.identityProvider.update({ where: { id }, data })
      return toIdentityProviderType(provider)
    } catch (error) {
      // Don't echo raw directory/database errors to the client; log them instead.
      logger.error(`Failed to update identity provider: ${(error as Error).message}`)
      throw new UserInputError('Unable to update the identity provider. Please verify the configuration.')
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

    const result = await this.service(prisma).testSavedProvider(id, { requireBind: true })
    const updatedProvider = await prisma.identityProvider.update({
      where: { id },
      data: {
        status: result.success ? 'CONNECTED' : 'ERROR',
        lastTestAt: new Date(),
        lastError: result.success ? null : result.message
      }
    })

    if (!result.success) {
      // Keep the detailed directory/bind error in provider.lastError and logs only;
      // return a generic message to the GraphQL client.
      logger.error(`Identity provider test failed for ${id}: ${result.message}`)
      return {
        success: false,
        message: 'Unable to validate directory connection. Check the provider configuration.',
        latencyMs: result.latencyMs,
        provider: toIdentityProviderType(updatedProvider)
      }
    }

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
      const data = await this.service(prisma).buildCreateData(input)
      const result = await this.service(prisma).testConnection({
        host: data.host,
        port: data.port ?? (data.useTls ? 636 : 389),
        useTls: data.useTls ?? false,
        tlsCa: data.tlsCa ?? null,
        tlsInsecureSkipVerify: data.tlsInsecureSkipVerify ?? false
      })
      if (!result.success) {
        // Don't echo raw directory/socket errors to the client; log them instead.
        logger.error(`Identity provider config test failed for ${data.host}: ${result.message}`)
        return {
          success: false,
          message: 'Unable to reach the directory endpoint. Check the host, port and TLS settings.',
          latencyMs: result.latencyMs
        }
      }
      return result
    } catch (error) {
      // buildCreateData throws validation errors that are safe to surface verbatim.
      return {
        success: false,
        message: (error as Error).message
      }
    }
  }

  @Mutation(() => IdentityProviderSyncResultType)
  @Can('identityProvider:sync', { id: (a) => a.id })
  async syncIdentityProvider (
    @Arg('id', () => ID) id: string,
    @Ctx() context: InfinibayContext
  ): Promise<IdentityProviderSyncResultType> {
    const { prisma } = context
    const provider = await prisma.identityProvider.findUnique({ where: { id } })
    if (!provider) throw new UserInputError('Identity provider not found')

    // Enqueue the heavy directory walk as a background task and return immediately.
    // The frontend polls identitySyncRuns for progress.
    if (context.eventManager) {
      const backgroundTasks = new BackgroundTaskService(prisma, context.eventManager)
      await backgroundTasks.queueTask(
        `identity-sync-${id}`,
        async () => {
          await this.service(prisma).syncProvider(id)
        },
        {
          onError: async (error: Error) => {
            logger.error(`Identity provider sync failed for ${id}: ${error.message}`)
          }
        }
      )
    } else {
      // Fallback: fire-and-forget if no event manager is available on the context.
      void this.service(prisma).syncProvider(id).catch((error) => {
        logger.error(`Identity provider sync failed for ${id}: ${(error as Error).message}`)
      })
    }

    return {
      success: true,
      message: 'Directory sync started',
      syncRunId: '',
      usersCreated: 0,
      usersUpdated: 0,
      usersDisabled: 0,
      groupsSeen: 0,
      provider: toIdentityProviderType(provider)
    }
  }
}
