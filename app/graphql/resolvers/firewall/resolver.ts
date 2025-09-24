import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { getUserAccessibleDepartments, validateDepartmentAccess, validateResourceDepartmentAccess, getDepartmentScopedWhereClause } from '@utils/authChecker'
import {
  FilterType,
  GenericFilter,
  DepartmentFilter,
  VMFilter,
  FWRule,
  CreateFilterInput,
  UpdateFilterInput,
  CreateFilterRuleInput,
  UpdateFilterRuleInput
} from './types'
import { NetworkFilterService } from '@services/networkFilterService'

@Resolver()
export class FirewallResolver {

  private async checkCircularReference (
    prisma: any,
    currentFilterId: string,
    targetFilterId: string,
    visitedFilters: Set<string>
  ): Promise<boolean> {
    // If we've reached the target filter, we have a circular reference
    if (currentFilterId === targetFilterId) {
      return true
    }

    // If we've already visited this filter, avoid infinite recursion
    if (visitedFilters.has(currentFilterId)) {
      return false
    }

    visitedFilters.add(currentFilterId)

    // Get all filters that this current filter references
    const references = await prisma.filterReference.findMany({
      where: { sourceFilterId: currentFilterId }
    })

    // Recursively check each referenced filter
    for (const reference of references) {
      const hasCircle = await this.checkCircularReference(
        prisma,
        reference.targetFilterId,
        targetFilterId,
        visitedFilters
      )
      if (hasCircle) {
        return true
      }
    }

    return false
  }

  @Query(() => [GenericFilter])
  @Authorized('USER')
  async listFilters (
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('departmentId', () => ID, { nullable: true }) departmentId?: string | null,
    @Arg('vmId', () => ID, { nullable: true }) vmId?: string | null
  ): Promise<GenericFilter[]> {
    if (departmentId && vmId) {
      // Error
      throw new UserInputError('Both departmentId and vmId cannot be specified')
    }

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN' && departmentId) {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate VM access for non-admin users
    if (user && user.role !== 'ADMIN' && vmId) {
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, vmId, 'vm')
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this VM')
      }
    }

    let filters: any[] = []
    let baseWhere: any = {}

    if (departmentId) {
      baseWhere = {
        departments: {
          some: {
            departmentId: departmentId
          }
        }
      }
    } else if (vmId) {
      baseWhere = {
        vms: {
          some: {
            vmId: vmId
          }
        }
      }
    }

    const whereClause = await getDepartmentScopedWhereClause(prisma, user, 'filter', baseWhere)

    filters = await prisma.nWFilter.findMany({
      include: {
        vms: true,
        departments: true,
        rules: true,
        references: true
      },
      where: whereClause
    })

    return filters.map((filter:any) => {
      return {
        id: filter.id,
        name: filter.name,
        description: filter.description || '',
        type: filter.type as FilterType,
        rules: filter.rules.map((rule: any) => {
          return {
            id: rule.id,
            protocol: rule.protocol,
            direction: rule.direction,
            action: rule.action,
            priority: rule.priority,
            ipVersion: rule.ipVersion,
            srcMacAddr: rule.srcMacAddr,
            srcIpAddr: rule.srcIpAddr,
            srcIpMask: rule.srcIpMask,
            dstIpAddr: rule.dstIpAddr,
            dstIpMask: rule.dstIpMask,
            srcPortStart: rule.srcPortStart,
            srcPortEnd: rule.srcPortEnd,
            dstPortStart: rule.dstPortStart,
            dstPortEnd: rule.dstPortEnd,
            state: rule.state,
            comment: rule.comment,
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt
          } as FWRule
        }),
        references: filter.references.map((ref:any) => ref.targetFilterId),
        createdAt: filter.createdAt,
        updatedAt: filter.updatedAt
      }
    })
  }

  @Query(() => GenericFilter, { nullable: true })
  @Authorized('USER')
  async getFilter (
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<GenericFilter | null> {
    // Check department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, id, 'filter', { includeGeneric: true })
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this filter')
      }
    }

    const result = await prisma.nWFilter.findUnique({
      where: { id },
      include: {
        rules: true,
        references: true
      }
    })

    if (!result) {
      return null
    }
    return {
      id: result.id,
      name: result.name,
      description: result.description || '',
      type: result.type as FilterType,
      rules: result.rules.map((rule: any) => {
        return {
          id: rule.id,
          protocol: rule.protocol,
          direction: rule.direction,
          action: rule.action,
          priority: rule.priority,
          ipVersion: rule.ipVersion,
          srcMacAddr: rule.srcMacAddr,
          srcIpAddr: rule.srcIpAddr,
          srcIpMask: rule.srcIpMask,
          dstIpAddr: rule.dstIpAddr,
          dstIpMask: rule.dstIpMask,
          srcPortStart: rule.srcPortStart,
          srcPortEnd: rule.srcPortEnd,
          dstPortStart: rule.dstPortStart,
          dstPortEnd: rule.dstPortEnd,
          state: rule.state,
          comment: rule.comment,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt
        } as FWRule
      }),
      references: result.references.map((ref:any) => ref.targetFilterId),
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }
  }

  @Query(() => [FWRule])
  @Authorized('USER')
  async listFilterRules (
    @Arg('filterId', () => ID, { nullable: true }) filterId: string | null,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<FWRule[]> {
    // Check department access for non-admin users when filterId is specified
    if (user && user.role !== 'ADMIN' && filterId) {
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, filterId, 'filter', { includeGeneric: true })
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this filter')
      }
    }

    if (!filterId) {
      // Get all filter IDs that user can access using consolidated scoping logic
      const filterWhereClause = await getDepartmentScopedWhereClause(prisma, user, 'filter')
      const accessibleFilters = await prisma.nWFilter.findMany({
        where: filterWhereClause,
        select: { id: true }
      })

      const filterIds = accessibleFilters.map(f => f.id)
      if (filterIds.length === 0) {
        return []
      }

      return (await prisma.fWRule.findMany({
        where: {
          nwFilterId: {
            in: filterIds
          }
        }
      })).map(rule => ({
        ...rule
        // Ensure all fields match the FWRule type definition
      } as unknown as FWRule))
    }
    return (await prisma.fWRule.findMany({
      where: { nwFilterId: filterId }
    })).map(rule => ({
      ...rule
      // Ensure all fields match the FWRule type definition
    } as unknown as FWRule))
  }

  @Mutation(() => GenericFilter)
  @Authorized('ADMIN')
  async createFilter (
    @Arg('input') input: CreateFilterInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<GenericFilter> {
    const networkFilterService = new NetworkFilterService(ctx.prisma)
    const filter = await networkFilterService.createFilter(
      input.name,
      input.description,
      input.chain || 'root',
      input.type
    )

    // If departmentId is provided and type is DEPARTMENT, create the relationship
    if (input.departmentId && input.type === FilterType.DEPARTMENT) {
      await ctx.prisma.departmentNWFilter.create({
        data: {
          departmentId: input.departmentId,
          nwFilterId: filter.id
        }
      })
    }

    return {
      id: filter.id,
      name: filter.name,
      description: filter.description || undefined,
      type: filter.type as FilterType,
      rules: [],
      references: [],
      createdAt: filter.createdAt,
      updatedAt: filter.updatedAt
    }
  }

  @Mutation(() => GenericFilter)
  @Authorized('ADMIN')
  async updateFilter (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateFilterInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GenericFilter> {
    const networkFilterService = new NetworkFilterService(prisma)
    const result:any = await networkFilterService.updateFilter(id, {
      name: input.name,
      description: input.description,
      chain: input.chain,
      type: input.type
    })
    result.rules = (await prisma.fWRule.findMany({
      where: { nwFilterId: id }
    })).map((rule: any) => {
      return {
        id: rule.id,
        protocol: rule.protocol,
        direction: rule.direction,
        action: rule.action,
        priority: rule.priority,
        ipVersion: rule.ipVersion,
        srcMacAddr: rule.srcMacAddr,
        srcIpAddr: rule.srcIpAddr,
        srcIpMask: rule.srcIpMask,
        dstIpAddr: rule.dstIpAddr,
        dstIpMask: rule.dstIpMask,
        srcPortStart: rule.srcPortStart,
        srcPortEnd: rule.srcPortEnd,
        dstPortStart: rule.dstPortStart,
        dstPortEnd: rule.dstPortEnd,
        state: rule.state,
        comment: rule.comment,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
      } as FWRule
    })
    result.references = (await prisma.filterReference.findMany({
      where: { targetFilterId: id }
    })).map((ref: any) => ref.sourceFilterId)
    return result
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteFilter (
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    return (await prisma.nWFilter.delete({
      where: { id }
    })) !== null
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async createFilterRule (
    @Arg('filterId', () => ID) filterId: string,
    @Arg('input') input: CreateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    const networkFilterService = new NetworkFilterService(prisma)
    const rule = await networkFilterService.createRule(
      filterId,
      input.action,
      input.direction,
      input.priority,
      input.protocol || 'all',
      undefined, // port parameter
      {
        srcPortStart: input.srcPortStart,
        srcPortEnd: input.srcPortEnd,
        dstPortStart: input.dstPortStart,
        dstPortEnd: input.dstPortEnd,
        comment: input.comment,
        ipVersion: input.ipVersion,
        state: input.state
      }
    )

    // Cast to FWRule to handle null vs undefined differences
    return rule as unknown as FWRule
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async updateFilterRule (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    const rule = await prisma.fWRule.findUnique({
      where: { id },
      include: { nwFilter: true }
    })

    if (!rule) {
      throw new UserInputError(`Rule with id ${id} not found`)
    }

    const updatedRule = await prisma.fWRule.update({
      where: { id },
      data: {
        action: input.action,
        direction: input.direction,
        priority: input.priority,
        protocol: input.protocol || undefined,
        srcPortStart: input.srcPortStart || undefined,
        srcPortEnd: input.srcPortEnd || undefined,
        dstPortStart: input.dstPortStart || undefined,
        dstPortEnd: input.dstPortEnd || undefined,
        comment: input.comment || undefined,
        ipVersion: input.ipVersion || undefined,
        state: input.state ? JSON.parse(input.state) : undefined
      }
    })

    // Flush the parent filter after rule update
    const networkFilterService = new NetworkFilterService(prisma)
    await networkFilterService.flushNWFilter(rule.nwFilterId)

    return updatedRule as unknown as FWRule
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteFilterRule (
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const rule = await prisma.fWRule.findUnique({
      where: { id },
      include: { nwFilter: true }
    })

    if (!rule) {
      throw new UserInputError(`Rule with id ${id} not found`)
    }

    const deleted = await prisma.fWRule.delete({
      where: { id }
    })

    // Flush the parent filter after rule deletion
    const networkFilterService = new NetworkFilterService(prisma)
    await networkFilterService.flushNWFilter(rule.nwFilterId)

    return deleted !== null
  }

  @Mutation(() => Boolean, { description: 'Apply a network filter inmediatly' })
  @Authorized('ADMIN')
  async flushFilter (
    @Arg('filterId', () => ID) filterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const filter = prisma.nWFilter.findUnique({
      where: { id: filterId }
    })

    if (!filter) {
      throw new UserInputError(`Filter with id ${filterId} not found`)
    }

    const networkFilterService = new NetworkFilterService(prisma)
    return networkFilterService.flushNWFilter(filterId)
  }

  @Mutation(() => Boolean, { description: 'Add a filter reference for template application' })
  @Authorized('ADMIN')
  async addFilterReference (
    @Arg('sourceFilterId', () => ID) sourceFilterId: string,
    @Arg('targetFilterId', () => ID) targetFilterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const sourceFilter = await prisma.nWFilter.findUnique({
      where: { id: sourceFilterId }
    })

    const targetFilter = await prisma.nWFilter.findUnique({
      where: { id: targetFilterId }
    })

    if (!sourceFilter) {
      throw new UserInputError(`Source filter with id ${sourceFilterId} not found`)
    }

    if (!targetFilter) {
      throw new UserInputError(`Target filter with id ${targetFilterId} not found`)
    }

    // Check for existing filter reference to make this operation idempotent
    const existingReference = await prisma.filterReference.findFirst({
      where: {
        sourceFilterId,
        targetFilterId
      }
    })

    if (existingReference) {
      // Reference already exists, return true (idempotent)
      return true
    }

    // Check for cyclic references by traversing from targetFilterId back to sourceFilterId
    const visitedFilters = new Set<string>()
    const hasCircularReference = await this.checkCircularReference(
      prisma,
      targetFilterId,
      sourceFilterId,
      visitedFilters
    )

    if (hasCircularReference) {
      throw new UserInputError(`Adding this filter reference would create a circular dependency`)
    }

    await prisma.filterReference.create({
      data: {
        sourceFilterId,
        targetFilterId
      }
    })

    // TODO: Enforce unique composite constraint at DB level for (sourceFilterId, targetFilterId)

    // Flush the source filter to apply the changes immediately
    const networkFilterService = new NetworkFilterService(prisma)
    await networkFilterService.flushNWFilter(sourceFilterId)

    return true
  }

  @Mutation(() => Boolean, { description: 'Remove a filter reference' })
  @Authorized('ADMIN')
  async removeFilterReference (
    @Arg('sourceFilterId', () => ID) sourceFilterId: string,
    @Arg('targetFilterId', () => ID) targetFilterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const reference = await prisma.filterReference.findFirst({
      where: {
        sourceFilterId,
        targetFilterId
      }
    })

    if (!reference) {
      throw new UserInputError(`Filter reference not found`)
    }

    await prisma.filterReference.delete({
      where: { id: reference.id }
    })

    // Flush the source filter to apply the changes immediately
    const networkFilterService = new NetworkFilterService(prisma)
    await networkFilterService.flushNWFilter(sourceFilterId)

    return true
  }

}
