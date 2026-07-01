import { Arg, Ctx, ID, Mutation, Query, Resolver, Int } from 'type-graphql'

import { Can } from '@main/permissions'
import {
  Pool as PoolGql,
  PoolType as PoolTypeGql,
  PoolResult,
  CreatePoolInput,
  UpdatePoolInput
} from '@graphql/types/PoolType'
import { PoolService } from '@services/PoolService'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import type { Pool as PrismaPool } from '@prisma/client'

function getService (ctx: InfinibayContext): PoolService {
  if (!ctx.prisma) throw new UserInputError('Database context not available')
  return new PoolService(ctx.prisma, ctx.user ?? null)
}

function toGql (row: PrismaPool & { currentSize: number }): PoolGql {
  return {
    id: row.id,
    name: row.name,
    templateId: row.templateId,
    goldenImageId: row.goldenImageId ?? undefined,
    departmentId: row.departmentId,
    type: row.type as PoolTypeGql,
    sizeMin: row.sizeMin,
    sizeMax: row.sizeMax,
    idleTimeoutMinutes: row.idleTimeoutMinutes ?? undefined,
    resetOnLogoff: row.resetOnLogoff,
    draining: row.draining,
    currentSize: row.currentSize,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

@Resolver()
export class PoolResolver {
  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  @Query(() => [PoolGql])
  @Can('pool:view')
  async pools (@Ctx() ctx?: InfinibayContext): Promise<PoolGql[]> {
    if (!ctx) throw new UserInputError('Context not available')
    // Narrow rows to the caller's scope. Pool has no owner column, so match by
    // department: DEPARTMENT holders see their accessible departments' pools,
    // OWN-only holders fail closed (departmentId === userId never matches → empty),
    // ANY sees all, and no grant yields the '__no_access__' sentinel.
    const where = await ctx.scopedWhere!('pool:view', {}, { ownerField: 'departmentId', deptField: 'departmentId' })
    const rows = await getService(ctx).list(where)
    return rows.map(toGql)
  }

  @Query(() => PoolGql, { nullable: true })
  @Can('pool:view', { id: (a) => a.id })
  async pool (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolGql | null> {
    if (!ctx) throw new UserInputError('Context not available')
    const row = await getService(ctx).byId(id)
    return row ? toGql(row) : null
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  @Mutation(() => PoolResult)
  // Scope the create to the target department so a DEPARTMENT-scoped grant can't
  // provision pools/VMs into a department the caller can't otherwise touch.
  @Can('pool:create', { id: (a) => a.input.departmentId, scopeVia: 'department' })
  async createPool (
    @Arg('input') input: CreatePoolInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      const pool = await getService(ctx).create({
        name: input.name,
        templateId: input.templateId,
        goldenImageId: input.goldenImageId,
        departmentId: input.departmentId,
        type: input.type as 'persistent' | 'non-persistent' | undefined,
        sizeMin: input.sizeMin,
        sizeMax: input.sizeMax,
        idleTimeoutMinutes: input.idleTimeoutMinutes,
        resetOnLogoff: input.resetOnLogoff
      })
      const row = await getService(ctx).byId(pool.id)
      return { success: true, pool: row ? toGql(row) : undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => PoolResult)
  @Can('pool:edit', { id: (a) => a.id })
  async updatePool (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdatePoolInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      await getService(ctx).update(id, input)
      const row = await getService(ctx).byId(id)
      return { success: true, pool: row ? toGql(row) : undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => PoolResult)
  @Can('pool:scale', { id: (a) => a.id })
  async scalePool (
    @Arg('id', () => ID) id: string,
    @Arg('targetSize', () => Int) targetSize: number,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      await getService(ctx).scale(id, targetSize)
      const row = await getService(ctx).byId(id)
      return { success: true, pool: row ? toGql(row) : undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => PoolResult)
  @Can('pool:drain', { id: (a) => a.id })
  async drainPool (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      await getService(ctx).drain(id)
      const row = await getService(ctx).byId(id)
      return { success: true, pool: row ? toGql(row) : undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => PoolResult)
  @Can('pool:drain', { id: (a) => a.id })
  async undrainPool (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<PoolResult> {
    if (!ctx) throw new UserInputError('Context not available')
    try {
      await getService(ctx).undrain(id)
      const row = await getService(ctx).byId(id)
      return { success: true, pool: row ? toGql(row) : undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  @Mutation(() => Boolean)
  @Can('pool:delete', { id: (a) => a.id })
  async deletePool (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<boolean> {
    if (!ctx) throw new UserInputError('Context not available')
    return await getService(ctx).delete(id)
  }

  // -----------------------------------------------------------------------
  // Connection routing (6.F foundation)
  // -----------------------------------------------------------------------

  @Mutation(() => ID, { description: 'Check out a desktop from the pool for the current user. Returns Machine.id.' })
  @Can('pool:connect', { id: (a) => a.poolId })
  async connectToPool (
    @Arg('poolId', () => ID) poolId: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<string> {
    if (!ctx?.user?.id) throw new UserInputError('User not authenticated')
    const machine = await getService(ctx).checkOutDesktopForUser(poolId, ctx.user.id)
    return machine.id
  }
}
