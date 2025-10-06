import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { PrismaClient } from '@prisma/client'
import { InfinibayContext } from '@utils/context'
import { DepartmentFirewallService } from '@services/departmentFirewallService'
import { NetworkFilterService } from '@services/networkFilterService'
import {
  DepartmentFirewallState,
  ApplyDepartmentTemplateInput,
  CreateFilterRuleInput,
  UpdateFilterRuleInput,
  FWRule,
  GenericFilter,
  FilterType
} from './firewall/types'
import { getSocketService } from '@services/SocketService'
import { validateDepartmentAccess } from '@utils/authChecker'
import { isDomainError } from '@utils/errors'
import Debug from 'debug'

const debug = Debug('infinibay:department-firewall-resolver')

@Resolver()
export class DepartmentFirewallResolver {

  private getDepartmentFirewallService (prisma: PrismaClient): DepartmentFirewallService {
    // Always create new service instances per request to avoid stale prisma usage
    const networkFilterService = new NetworkFilterService(prisma)
    return new DepartmentFirewallService(prisma, networkFilterService)
  }

  @Query(() => DepartmentFirewallState)
  @Authorized('USER', 'ADMIN')
  async getDepartmentFirewallState (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentFirewallState> {
    debug(`Getting department firewall state for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const result = await service.getDepartmentFirewallState(departmentId)
      debug(`Department firewall state retrieved successfully for department ${departmentId}`)
      return result
    } catch (error) {
      console.error(`❌ Failed to get department firewall state for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to get department firewall state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Query(() => [FWRule])
  @Authorized('USER', 'ADMIN')
  async getDepartmentFirewallRules (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<FWRule[]> {
    debug(`Getting department firewall rules for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const result = await service.getEffectiveRules(departmentId)
      debug(`Department firewall rules retrieved successfully for department ${departmentId} (${result.length} rules)`)
      return result
    } catch (error) {
      console.error(`❌ Failed to get department firewall rules for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to get department firewall rules: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Query(() => [GenericFilter])
  @Authorized('USER', 'ADMIN')
  async getAvailableTemplatesForDepartment (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<GenericFilter[]> {
    debug(`Getting available templates for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const templates = await prisma.nWFilter.findMany({
        where: {
          type: 'generic',
          OR: [
            { name: { contains: 'template' } },
            { description: { contains: 'template' } }
          ]
        },
        include: {
          rules: true,
          references: true
        }
      })

      const result = templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description || '',
        type: template.type as FilterType,
        rules: template.rules,
        references: template.references.map((ref) => ref.targetFilterId),
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      }))

      debug(`Available templates retrieved successfully for department ${departmentId} (${result.length} templates)`)
      return result
    } catch (error) {
      console.error(`❌ Failed to get available templates for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to get available templates: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async applyDepartmentFirewallTemplate (
    @Arg('input') input: ApplyDepartmentTemplateInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Applying template ${input.templateFilterId} to department ${input.departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, input.departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: input.departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${input.departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const result = await service.applyTemplateToDepartment(input.departmentId, input.templateFilterId)

      if (result) {
        debug(`Template applied successfully: templateId=${input.templateFilterId} to department ${input.departmentId}`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', 'templateApplied', {
          data: {
            departmentId: input.departmentId,
            templateFilterId: input.templateFilterId
          }
        })
      }

      return result
    } catch (error) {
      console.error(`❌ Failed to apply template ${input.templateFilterId} to department ${input.departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to apply department firewall template: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async removeDepartmentFirewallTemplate (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('templateFilterId', () => ID) templateFilterId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Removing template ${templateFilterId} from department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const result = await service.removeTemplateFromDepartment(departmentId, templateFilterId)

      if (result) {
        debug(`Template removed successfully: templateId=${templateFilterId} from department ${departmentId}`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', 'templateRemoved', {
          data: {
            departmentId,
            templateFilterId
          }
        })
      }

      return result
    } catch (error) {
      console.error(`❌ Failed to remove template ${templateFilterId} from department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to remove department firewall template: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async toggleDepartmentFirewallTemplate (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('templateFilterId', () => ID) templateFilterId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Toggling template ${templateFilterId} for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const appliedTemplates = await service.getAppliedTemplates(departmentId)
      const isApplied = appliedTemplates.some(template => template.id === templateFilterId)

      let result: boolean
      if (isApplied) {
        result = await service.removeTemplateFromDepartment(departmentId, templateFilterId)
      } else {
        result = await service.applyTemplateToDepartment(departmentId, templateFilterId)
      }

      if (result) {
        debug(`Template toggled successfully: templateId=${templateFilterId} for department ${departmentId} (${isApplied ? 'removed' : 'applied'})`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', isApplied ? 'templateRemoved' : 'templateApplied', {
          data: {
            departmentId,
            templateFilterId
          }
        })
      }

      return result
    } catch (error) {
      console.error(`❌ Failed to toggle template ${templateFilterId} for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to toggle department firewall template: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => FWRule)
  @Authorized('USER', 'ADMIN')
  async createDepartmentFirewallRule (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('input') input: CreateFilterRuleInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<FWRule> {
    debug(`Creating department firewall rule for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)

      if (!service.validateRulePriority({ priority: input.priority })) {
        throw new UserInputError('Rule priority must be between 100 and 1000 for department rules')
      }

      const rule = await service.addDepartmentRule(departmentId, {
        action: input.action,
        direction: input.direction,
        priority: input.priority,
        protocol: input.protocol,
        srcPortStart: input.srcPortStart,
        srcPortEnd: input.srcPortEnd,
        dstPortStart: input.dstPortStart,
        dstPortEnd: input.dstPortEnd,
        comment: input.comment,
        ipVersion: input.ipVersion,
        state: input.state ? JSON.parse(input.state) : undefined
      })

      debug(`Department firewall rule created successfully: ruleId=${rule.id} for department ${departmentId}`)
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'ruleCreated', {
        data: {
          departmentId,
          ruleId: rule.id
        }
      })

      return rule
    } catch (error) {
      console.error(`❌ Failed to create department firewall rule for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to create department firewall rule: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => FWRule)
  @Authorized('USER', 'ADMIN')
  async updateDepartmentFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Arg('input') input: UpdateFilterRuleInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<FWRule> {
    debug(`Updating department firewall rule ${ruleId}`)

    try {
      const rule = await prisma.fWRule.findUnique({
        where: { id: ruleId },
        include: {
          nwFilter: {
            include: {
              departments: true
            }
          }
        }
      })

      if (!rule) {
        throw new UserInputError(`Rule with id ${ruleId} not found`)
      }

      if (rule.nwFilter.type !== 'department') {
        throw new UserInputError('Rule is not a department firewall rule')
      }

      const departmentId = rule.nwFilter.departments[0]?.id

      // Only validate department access if departmentId exists
      if (departmentId) {
        // Validate department access for non-admin users
        if (user && user.role !== 'ADMIN') {
          const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
          if (!hasAccess) {
            throw new UserInputError('Unauthorized: You do not have access to this department')
          }
        }
      }

      const service = this.getDepartmentFirewallService(prisma)

      if (!service.validateRulePriority({ priority: input.priority })) {
        throw new UserInputError('Rule priority must be between 100 and 1000 for department rules')
      }

      const updatedRule = await prisma.fWRule.update({
        where: { id: ruleId },
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

      debug(`Department firewall rule updated successfully: ruleId=${ruleId} for department ${departmentId || 'no-department'}`)
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'ruleUpdated', {
        data: {
          departmentId: departmentId || undefined,
          ruleId
        }
      })

      return updatedRule
    } catch (error) {
      console.error(`❌ Failed to update department firewall rule ${ruleId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to update department firewall rule: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async deleteDepartmentFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Deleting department firewall rule ${ruleId}`)

    try {
      const rule = await prisma.fWRule.findUnique({
        where: { id: ruleId },
        include: {
          nwFilter: {
            include: {
              departments: true
            }
          }
        }
      })

      if (!rule) {
        throw new UserInputError(`Rule with id ${ruleId} not found`)
      }

      if (rule.nwFilter.type !== 'department') {
        throw new UserInputError('Rule is not a department firewall rule')
      }

      const departmentId = rule.nwFilter.departments[0]?.id

      // Only validate department access if departmentId exists
      if (departmentId) {
        // Validate department access for non-admin users
        if (user && user.role !== 'ADMIN') {
          const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
          if (!hasAccess) {
            throw new UserInputError('Unauthorized: You do not have access to this department')
          }
        }
      }

      let result: boolean
      if (departmentId) {
        // Use service method when departmentId is available
        const service = this.getDepartmentFirewallService(prisma)
        result = await service.removeDepartmentRule(departmentId, ruleId)
      } else {
        // Direct Prisma delete when no departmentId
        await prisma.fWRule.delete({
          where: { id: ruleId }
        })
        result = true
      }

      if (result) {
        debug(`Department firewall rule deleted successfully: ruleId=${ruleId} from department ${departmentId || 'no-department'}`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', 'ruleDeleted', {
          data: {
            departmentId: departmentId || undefined,
            ruleId
          }
        })
      }

      return result
    } catch (error) {
      console.error(`❌ Failed to delete department firewall rule ${ruleId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to delete department firewall rule: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async flushDepartmentFirewall (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Flushing department firewall for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const result = await service.flushDepartmentToAllVMs(departmentId)

      if (result) {
        debug(`Department firewall flushed successfully for department ${departmentId}`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', 'flushed', {
          data: {
            departmentId
          }
        })
      }

      return result
    } catch (error) {
      console.error(`❌ Failed to flush department firewall for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to flush department firewall: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('USER', 'ADMIN')
  async refreshDepartmentVMFilters (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<boolean> {
    debug(`Refreshing VM filters for department ${departmentId}`)

    // Validate department access for non-admin users
    if (user && user.role !== 'ADMIN') {
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }
    }

    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })
    if (!department) {
      throw new UserInputError(`Department with id ${departmentId} not found`)
    }

    try {
      const service = this.getDepartmentFirewallService(prisma)
      const flushedFilterIds = await service.refreshAllVMFilters(departmentId)

      if (flushedFilterIds.length > 0) {
        debug(`VM filters refreshed successfully for department ${departmentId}. Flushed ${flushedFilterIds.length} filters.`)
        const socketService = getSocketService()
        socketService.sendToAdmins('departmentFirewall', 'vmFiltersRefreshed', {
          data: {
            departmentId
          }
        })
      }

      return flushedFilterIds.length > 0
    } catch (error) {
      console.error(`❌ Failed to refresh VM filters for department ${departmentId}:`, error)
      if (error instanceof UserInputError) {
        throw error
      }
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw new UserInputError(`Failed to refresh department VM filters: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
