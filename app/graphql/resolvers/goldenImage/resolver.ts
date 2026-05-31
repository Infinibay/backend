import { Arg, Authorized, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'

import {
  GoldenImage as GoldenImageGql,
  GoldenImageStatus,
  GoldenImageSourceType,
  GoldenImageOsType,
  GoldenImageResult,
  CreateGoldenImageFromTemplateInput,
  CaptureGoldenImageFromMachineInput
} from '@graphql/types/GoldenImageType'
import { GoldenImageService } from '@services/GoldenImageService'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { GoldenImage as PrismaGoldenImage } from '@prisma/client'
import { assertCanAccessResource } from '../../utils/auth'

function getService (ctx: InfinibayContext): GoldenImageService {
  if (!ctx.prisma) throw new UserInputError('Database context not available')
  const virtio = getVirtioSocketWatcherService()
  return new GoldenImageService(ctx.prisma, virtio)
}

function toGql (row: PrismaGoldenImage): GoldenImageGql {
  return {
    id: row.id,
    name: row.name,
    osType: row.osType as GoldenImageOsType,
    osVersion: row.osVersion ?? undefined,
    baseDiskPath: row.baseDiskPath,
    sizeBytes: row.sizeBytes.toString(),
    status: row.status as GoldenImageStatus,
    version: row.version,
    parentImageId: row.parentImageId ?? undefined,
    sourceType: row.sourceType as GoldenImageSourceType,
    sourceMachineId: row.sourceMachineId ?? undefined,
    sourceTemplateId: row.sourceTemplateId ?? undefined,
    hardeningApplied: (row.hardeningApplied as Record<string, unknown> | null) ?? undefined,
    notes: row.notes ?? undefined,
    createdById: row.createdById ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sealedAt: row.sealedAt ?? undefined,
    deprecatedAt: row.deprecatedAt ?? undefined
  }
}

@Resolver()
export class GoldenImageResolver {
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  @Query(() => [GoldenImageGql])
  @Authorized(['USER'])
  async goldenImages (@Ctx() ctx?: InfinibayContext): Promise<GoldenImageGql[]> {
    if (!ctx) throw new UserInputError('Context not available')
    const rows = await getService(ctx).list()
    return rows.map(toGql)
  }

  @Query(() => GoldenImageGql, { nullable: true })
  @Authorized(['USER'])
  async goldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageGql | null> {
    if (!ctx) throw new UserInputError('Context not available')
    const row = await getService(ctx).byId(id)
    return row ? toGql(row) : null
  }

  // -------------------------------------------------------------------------
  // Creation mutations — long-running; return the building row immediately
  // -------------------------------------------------------------------------

  @Mutation(() => GoldenImageResult, {
    description: 'Build a sealed golden image from a blueprint (long-running).'
  })
  @Authorized(['ADMIN'])
  async createGoldenImageFromTemplate (
    @Arg('input') input: CreateGoldenImageFromTemplateInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    try {
      const row = await getService(ctx).buildAutomated({
        templateId: input.templateId,
        name: input.name,
        notes: input.notes,
        hardeningOptions: input.hardeningOptions,
        parentImageId: input.parentImageId,
        createdById: ctx.user?.id
      })
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => GoldenImageResult, {
    description: 'Seal an existing VM into a new golden image (long-running).'
  })
  @Authorized(['ADMIN'])
  async captureGoldenImageFromMachine (
    @Arg('input') input: CaptureGoldenImageFromMachineInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    try {
      const row = await getService(ctx).captureFromMachine({
        machineId: input.machineId,
        name: input.name,
        notes: input.notes,
        hardeningOptions: input.hardeningOptions,
        sanitizeUserData: input.sanitizeUserData ?? true,
        destroySource: input.destroySource ?? false,
        parentImageId: input.parentImageId,
        createdById: ctx.user?.id
      })
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle mutations
  // -------------------------------------------------------------------------

  @Mutation(() => GoldenImageResult)
  @Authorized(['ADMIN'])
  async publishGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    try {
      const row = await getService(ctx).publish(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => GoldenImageResult)
  @Authorized(['ADMIN'])
  async deprecateGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    try {
      const row = await getService(ctx).deprecate(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => GoldenImageResult, {
    description: 'Retry a failed golden image build. Only works for automated (template-based) builds.'
  })
  @Authorized(['ADMIN'])
  async retryBuildGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    try {
      const row = await getService(ctx).retryBuild(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => Boolean)
  @Authorized(['ADMIN'])
  async deleteGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<boolean> {
    if (!ctx) throw new UserInputError('Context not available')
    await assertCanAccessResource(ctx, 'blueprints')
    return await getService(ctx).delete(id)
  }
}
