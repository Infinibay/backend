import { PrismaClient, NWFilter, FWRule } from '@prisma/client'
import { NetworkFilterService } from './networkFilterService'
import { DepartmentFirewallState } from '../graphql/resolvers/firewall/types'
import { NotFoundError, ConflictError, CircularDependencyError } from '@utils/errors'
import Debug from 'debug'

const debug = Debug('infinibay:department-firewall-service')

export class DepartmentFirewallService {
  constructor (
    private prisma: PrismaClient,
    private networkFilterService: NetworkFilterService
  ) {}

  private async checkCircularReference (
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
    const references = await this.prisma.filterReference.findMany({
      where: { sourceFilterId: currentFilterId }
    })

    // Recursively check each referenced filter
    for (const reference of references) {
      const hasCircle = await this.checkCircularReference(
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

  async getDepartmentFirewallState (departmentId: string): Promise<DepartmentFirewallState> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        machines: true
      }
    })

    if (!department) {
      const errorMsg = `Department with id ${departmentId} not found`
      debug(`❌ Department lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      return {
        departmentId,
        appliedTemplates: [],
        customRules: [],
        effectiveRules: [],
        vmCount: department.machines.length,
        lastSync: new Date()
      }
    }

    const appliedTemplates = await this.getAppliedTemplates(departmentId)
    const customRules = await this.getDepartmentCustomRules(departmentId)
    const effectiveRules = await this.getEffectiveRules(departmentId)

    return {
      departmentId,
      appliedTemplates: appliedTemplates.map(template => template.id),
      customRules,
      effectiveRules,
      vmCount: department.machines.length,
      lastSync: departmentFilter.updatedAt
    }
  }

  async getDepartmentFilter (departmentId: string): Promise<NWFilter | null> {
    return await this.prisma.nWFilter.findFirst({
      where: {
        type: 'department',
        departments: {
          some: {
            id: departmentId
          }
        }
      },
      include: {
        rules: true,
        references: true
      }
    })
  }

  async getVMsInDepartment (departmentId: string): Promise<any[]> {
    return await this.prisma.machine.findMany({
      where: { departmentId },
      include: {
        nwFilters: {
          where: {
            nwFilter: {
              type: 'vm'
            }
          }
        }
      }
    })
  }

  async applyTemplateToDepartment (departmentId: string, templateFilterId: string): Promise<boolean> {
    debug(`🔄 Starting template application: templateId=${templateFilterId} to departmentId=${departmentId}`)

    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      const errorMsg = `Department filter not found for department ${departmentId}`
      debug(`❌ Department filter lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    const templateFilter = await this.prisma.nWFilter.findUnique({
      where: { id: templateFilterId }
    })

    if (!templateFilter) {
      const errorMsg = `Template filter with id ${templateFilterId} not found`
      debug(`❌ Template filter lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    const existingReference = await this.prisma.filterReference.findFirst({
      where: {
        sourceFilterId: departmentFilter.id,
        targetFilterId: templateFilterId
      }
    })

    if (existingReference) {
      debug(`✅ Template already applied: templateId=${templateFilterId} to departmentId=${departmentId}`)
      return true
    }

    // Check for cyclic references before creating the new reference
    debug(`🔍 Checking for circular dependencies...`)
    const visitedFilters = new Set<string>()
    const hasCircularReference = await this.checkCircularReference(
      templateFilterId,
      departmentFilter.id,
      visitedFilters
    )

    if (hasCircularReference) {
      const errorMsg = `Applying this template would create a circular dependency`
      debug(`❌ Circular dependency detected: ${errorMsg}`)
      throw new CircularDependencyError(errorMsg)
    }

    debug(`📝 Creating filter reference...`)
    await this.prisma.filterReference.create({
      data: {
        sourceFilterId: departmentFilter.id,
        targetFilterId: templateFilterId
      }
    })

    debug(`🔄 Flushing network filter: ${departmentFilter.id}`)
    await this.networkFilterService.flushNWFilter(departmentFilter.id)

    debug(`✅ Template applied successfully: templateId=${templateFilterId} to departmentId=${departmentId}`)
    return true
  }

  /** @deprecated Use applyTemplateToDepartment */
  async applyTemplateToDepart (departmentId: string, templateFilterId: string): Promise<boolean> {
    return this.applyTemplateToDepartment(departmentId, templateFilterId)
  }

  async removeTemplateFromDepartment (departmentId: string, templateFilterId: string): Promise<boolean> {
    debug(`🔄 Starting template removal: templateId=${templateFilterId} from departmentId=${departmentId}`)

    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      const errorMsg = `Department filter not found for department ${departmentId}`
      debug(`❌ Department filter lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    const reference = await this.prisma.filterReference.findFirst({
      where: {
        sourceFilterId: departmentFilter.id,
        targetFilterId: templateFilterId
      }
    })

    if (!reference) {
      debug(`⚠️ Template reference not found: templateId=${templateFilterId} from departmentId=${departmentId}`)
      return false
    }

    debug(`📝 Deleting filter reference: ${reference.id}`)
    await this.prisma.filterReference.delete({
      where: { id: reference.id }
    })

    debug(`🔄 Flushing network filter: ${departmentFilter.id}`)
    await this.networkFilterService.flushNWFilter(departmentFilter.id)

    debug(`✅ Template removed successfully: templateId=${templateFilterId} from departmentId=${departmentId}`)
    return true
  }

  async getAppliedTemplates (departmentId: string): Promise<NWFilter[]> {
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      return []
    }

    const references = await this.prisma.filterReference.findMany({
      where: { sourceFilterId: departmentFilter.id },
      include: {
        targetFilter: true
      }
    })

    return references.map(ref => ref.targetFilter)
  }

  async addDepartmentRule (departmentId: string, rule: Partial<FWRule>): Promise<FWRule> {
    debug(`🔄 Starting rule addition to departmentId=${departmentId}: action=${rule.action || 'accept'}, direction=${rule.direction || 'inout'}`)

    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      const errorMsg = `Department filter not found for department ${departmentId}`
      debug(`❌ Department filter lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    debug(`📝 Creating rule for filter: ${departmentFilter.id}`)
    const createdRule = await this.networkFilterService.createRule(
      departmentFilter.id,
      rule.action || 'accept',
      rule.direction || 'inout',
      rule.priority || 500,
      rule.protocol || 'all',
      undefined,
      {
        srcPortStart: rule.srcPortStart ?? undefined,
        srcPortEnd: rule.srcPortEnd ?? undefined,
        dstPortStart: rule.dstPortStart ?? undefined,
        dstPortEnd: rule.dstPortEnd ?? undefined,
        comment: rule.comment ?? undefined,
        ipVersion: rule.ipVersion ?? undefined,
        state: rule.state
      }
    )

    debug(`✅ Rule added successfully: ruleId=${createdRule.id} to departmentId=${departmentId}`)
    return createdRule
  }

  async removeDepartmentRule (departmentId: string, ruleId: string): Promise<boolean> {
    debug(`🔄 Starting rule removal: ruleId=${ruleId} from departmentId=${departmentId}`)

    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      const errorMsg = `Department filter not found for department ${departmentId}`
      debug(`❌ Department filter lookup failed: ${errorMsg}`)
      throw new NotFoundError(errorMsg)
    }

    const rule = await this.prisma.fWRule.findFirst({
      where: {
        id: ruleId,
        nwFilterId: departmentFilter.id
      }
    })

    if (!rule) {
      debug(`⚠️ Rule not found: ruleId=${ruleId} in departmentId=${departmentId}`)
      return false
    }

    debug(`📝 Deleting rule: ${ruleId}`)
    await this.prisma.fWRule.delete({
      where: { id: ruleId }
    })

    debug(`🔄 Flushing network filter: ${departmentFilter.id}`)
    await this.networkFilterService.flushNWFilter(departmentFilter.id)

    debug(`✅ Rule removed successfully: ruleId=${ruleId} from departmentId=${departmentId}`)
    return true
  }

  async getDepartmentCustomRules (departmentId: string): Promise<FWRule[]> {
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      return []
    }

    return await this.prisma.fWRule.findMany({
      where: { nwFilterId: departmentFilter.id }
    })
  }

  async getEffectiveRules (departmentId: string): Promise<FWRule[]> {
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      return []
    }

    const customRules = await this.getDepartmentCustomRules(departmentId)
    const appliedTemplates = await this.getAppliedTemplates(departmentId)

    const templateRules: FWRule[] = []
    for (const template of appliedTemplates) {
      const rules = await this.prisma.fWRule.findMany({
        where: { nwFilterId: template.id }
      })
      templateRules.push(...rules)
    }

    return [...templateRules, ...customRules].sort((a, b) => a.priority - b.priority)
  }

  async refreshAllVMFilters (departmentId: string): Promise<boolean> {
    const vms = await this.getVMsInDepartment(departmentId)

    for (const vm of vms) {
      if (vm.nwFilters && vm.nwFilters.length > 0) {
        for (const filter of vm.nwFilters) {
          await this.networkFilterService.flushNWFilter(filter.id)
        }
      }
    }

    return true
  }

  async flushDepartmentToAllVMs (departmentId: string): Promise<boolean> {
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      return false
    }

    await this.networkFilterService.flushNWFilter(departmentFilter.id)
    await this.refreshAllVMFilters(departmentId)

    return true
  }

  validateRulePriority (rule: Partial<FWRule>): boolean {
    if (!rule.priority) {
      return true
    }

    return rule.priority >= 100 && rule.priority <= 1000
  }

  async calculateInheritanceImpact (departmentId: string): Promise<{
    affectedVMs: number
    totalRules: number
    estimatedApplyTime: number
  }> {
    const vms = await this.getVMsInDepartment(departmentId)
    const effectiveRules = await this.getEffectiveRules(departmentId)

    return {
      affectedVMs: vms.length,
      totalRules: effectiveRules.length,
      estimatedApplyTime: vms.length * 2
    }
  }
}