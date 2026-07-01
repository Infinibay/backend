import { Arg, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'

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
import { sanitizeErrorForUser } from '@utils/sanitizeError'
import { GoldenImage as PrismaGoldenImage } from '@prisma/client'
import { Can, LOADERS } from '@main/permissions'

function getService (ctx: InfinibayContext): GoldenImageService {
  if (!ctx.prisma) throw new UserInputError('Database context not available')
  const virtio = getVirtioSocketWatcherService()
  return new GoldenImageService(ctx.prisma, virtio)
}

/**
 * Bound the free-text name/notes before they are persisted and flow downstream
 * (name becomes a Machine.name / libvirt domain name for automated builds).
 * Rejects fast with a clean UserInputError instead of creating orphan rows and
 * failing deep in the async build. Returns the trimmed name to persist.
 */
function validateNameNotes (name: string, notes?: string): string {
  const n = (name ?? '').trim()
  if (!n) throw new UserInputError('name is required')
  if (n.length > 128) throw new UserInputError('name must be <= 128 characters')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(n)) throw new UserInputError('name contains control characters')
  if (notes != null && notes.length > 2000) throw new UserInputError('notes must be <= 2000 characters')
  return n
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
    // Stored notes can carry a raw '[build failed] <qemu-img stderr>' with absolute
    // host paths (GoldenImageService.markFailed) — sanitize before surfacing to any
    // goldenImage:view holder. Full raw text stays in the server-side debug logs.
    notes: sanitizeErrorForUser(row.notes) ?? undefined,
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
  @Can('goldenImage:view')
  async goldenImages (@Ctx() ctx?: InfinibayContext): Promise<GoldenImageGql[]> {
    if (!ctx) throw new UserInputError('Context not available')
    const rows = await getService(ctx).list()
    return rows.map(toGql)
  }

  @Query(() => GoldenImageGql, { nullable: true })
  @Can('goldenImage:view', { id: (a) => a.id })
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
  @Can('goldenImage:create')
  async createGoldenImageFromTemplate (
    @Arg('input') input: CreateGoldenImageFromTemplateInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    const name = validateNameNotes(input.name, input.notes)
    try {
      const row = await getService(ctx).buildAutomated({
        templateId: input.templateId,
        name,
        notes: input.notes,
        hardeningOptions: input.hardeningOptions,
        parentImageId: input.parentImageId,
        createdById: ctx.user?.id
      })
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: sanitizeErrorForUser((err as Error).message) ?? undefined }
    }
  }

  @Mutation(() => GoldenImageResult, {
    description: 'Seal an existing VM into a new golden image (long-running).'
  })
  @Can('goldenImage:create')
  async captureGoldenImageFromMachine (
    @Arg('input') input: CaptureGoldenImageFromMachineInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    const name = validateNameNotes(input.name, input.notes)
    // `goldenImage` is a global (scoped:false) resource, so the @Can('goldenImage:create')
    // guard above is possession-only and does NOT authorize the caller against the
    // caller-supplied, tenant-scoped target VM. Without this in-body check any
    // goldenImage:create holder (e.g. a blueprint manager with no vm:* grants) could
    // boot/seal/capture — and with destroySource archive — ANOTHER tenant's VM (IDOR).
    // vm:power/vm:delete are scoped verbs, so assertCan resolves the caller's
    // OWN/DEPARTMENT/ANY grant against this machine's owner/department.
    const destroySource = input.destroySource ?? false
    const scopeInst = await LOADERS.vm(ctx.prisma, input.machineId)
    if (!scopeInst) throw new UserInputError('Machine not found')
    await ctx.assertCan!('vm:power', scopeInst)
    // Archiving the source is destructive — require delete scope over that specific VM.
    if (destroySource) await ctx.assertCan!('vm:delete', scopeInst)
    try {
      const row = await getService(ctx).captureFromMachine({
        machineId: input.machineId,
        name,
        notes: input.notes,
        hardeningOptions: input.hardeningOptions,
        sanitizeUserData: input.sanitizeUserData ?? true,
        destroySource,
        parentImageId: input.parentImageId,
        createdById: ctx.user?.id
      })
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: sanitizeErrorForUser((err as Error).message) ?? undefined }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle mutations
  // -------------------------------------------------------------------------

  @Mutation(() => GoldenImageResult)
  @Can('goldenImage:publish', { id: (a) => a.id })
  async publishGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      const row = await getService(ctx).publish(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: sanitizeErrorForUser((err as Error).message) ?? undefined }
    }
  }

  @Mutation(() => GoldenImageResult)
  @Can('goldenImage:deprecate', { id: (a) => a.id })
  async deprecateGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      const row = await getService(ctx).deprecate(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: sanitizeErrorForUser((err as Error).message) ?? undefined }
    }
  }

  @Mutation(() => GoldenImageResult, {
    description: 'Retry a failed golden image build. Only works for automated (template-based) builds.'
  })
  @Can('goldenImage:create', { id: (a) => a.id })
  async retryBuildGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<GoldenImageResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      const row = await getService(ctx).retryBuild(id)
      return { success: true, image: toGql(row) }
    } catch (err) {
      return { success: false, error: sanitizeErrorForUser((err as Error).message) ?? undefined }
    }
  }

  @Mutation(() => Boolean)
  @Can('goldenImage:delete', { id: (a) => a.id })
  async deleteGoldenImage (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<boolean> {
    if (!ctx) throw new UserInputError('Context not available')
    return await getService(ctx).delete(id)
  }
}
