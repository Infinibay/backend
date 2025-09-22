import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { DepartmentFirewallService } from '@services/departmentFirewallService'
import { NetworkFilterService } from '@services/networkFilterService'
import {
  DepartmentFirewallState,
  ApplyDepartmentTemplateInput,
  CreateFilterRuleInput,
  UpdateFilterRuleInput,
  FWRule,
  GenericFilter
} from './firewall/types'
import { getSocketService } from '@services/SocketService'
import Debug from 'debug'

const debug = Debug('infinibay:department-firewall-resolver')

@Resolver()
export class DepartmentFirewallResolver {
  constructor () {
    // Services are instantiated per request to avoid stale prisma instances
  }

  private getDepartmentFirewallService (prisma: any): DepartmentFirewallService {
    // Always create new service instances per request to avoid stale prisma usage
    const networkFilterService = new NetworkFilterService(prisma)
    return new DepartmentFirewallService(prisma, networkFilterService)
  }

  @Query(() => DepartmentFirewallState)
  @Authorized('ADMIN')
  async getDepartmentFirewallState (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentFirewallState> {
    debug(`Getting department firewall state for department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    return await service.getDepartmentFirewallState(departmentId)
  }

  @Query(() => [FWRule])
  @Authorized('ADMIN')
  async getDepartmentFirewallRules (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule[]> {
    debug(`Getting department firewall rules for department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    return await service.getEffectiveRules(departmentId)
  }

  @Query(() => [GenericFilter])
  @Authorized('ADMIN')
  async getAvailableTemplatesForDepartment (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GenericFilter[]> {
    debug(`Getting available templates for department ${departmentId}`)

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

    return templates.map((template: any) => ({
      id: template.id,
      name: template.name,
      description: template.description || '',
      type: template.type,
      rules: template.rules,
      references: template.references.map((ref: any) => ref.targetFilterId),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    }))
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async applyDepartmentFirewallTemplate (
    @Arg('input') input: ApplyDepartmentTemplateInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Applying template ${input.templateFilterId} to department ${input.departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    const result = await service.applyTemplateToDepart(input.departmentId, input.templateFilterId)

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'templateApplied', {
        data: {
          departmentId: input.departmentId,
          templateFilterId: input.templateFilterId
        }
      })
    }

    return result
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async removeDepartmentFirewallTemplate (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('templateFilterId', () => ID) templateFilterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Removing template ${templateFilterId} from department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    const result = await service.removeTemplateFromDepartment(departmentId, templateFilterId)

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'templateRemoved', {
        data: {
          departmentId,
          templateFilterId
        }
      })
    }

    return result
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async toggleDepartmentFirewallTemplate (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('templateFilterId', () => ID) templateFilterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Toggling template ${templateFilterId} for department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    const appliedTemplates = await service.getAppliedTemplates(departmentId)
    const isApplied = appliedTemplates.some(template => template.id === templateFilterId)

    let result: boolean
    if (isApplied) {
      result = await service.removeTemplateFromDepartment(departmentId, templateFilterId)
    } else {
      result = await service.applyTemplateToDepart(departmentId, templateFilterId)
    }

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', isApplied ? 'templateRemoved' : 'templateApplied', {
        data: {
          departmentId,
          templateFilterId
        }
      })
    }

    return result
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async createDepartmentFirewallRule (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('input') input: CreateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    debug(`Creating department firewall rule for department ${departmentId}`)

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

    const socketService = getSocketService()
    socketService.sendToAdmins('departmentFirewall', 'ruleCreated', {
      data: {
        departmentId,
        ruleId: rule.id
      }
    })

    return rule
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async updateDepartmentFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Arg('input') input: UpdateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    debug(`Updating department firewall rule ${ruleId}`)

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

    const socketService = getSocketService()
    socketService.sendToAdmins('departmentFirewall', 'ruleUpdated', {
      data: {
        departmentId: rule.nwFilter.departments[0]?.id,
        ruleId
      }
    })

    return updatedRule
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteDepartmentFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Deleting department firewall rule ${ruleId}`)

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
    const service = this.getDepartmentFirewallService(prisma)
    const result = await service.removeDepartmentRule(departmentId, ruleId)

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'ruleDeleted', {
        data: {
          departmentId,
          ruleId
        }
      })
    }

    return result
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async flushDepartmentFirewall (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Flushing department firewall for department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    const result = await service.flushDepartmentToAllVMs(departmentId)

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'flushed', {
        data: {
          departmentId
        }
      })
    }

    return result
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async refreshDepartmentVMFilters (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    debug(`Refreshing VM filters for department ${departmentId}`)

    const service = this.getDepartmentFirewallService(prisma)
    const result = await service.refreshAllVMFilters(departmentId)

    if (result) {
      const socketService = getSocketService()
      socketService.sendToAdmins('departmentFirewall', 'vmFiltersRefreshed', {
        data: {
          departmentId
        }
      })
    }

    return result
  }
}