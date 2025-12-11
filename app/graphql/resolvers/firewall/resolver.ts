import { Arg, Authorized, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'
import { UserInputError } from 'apollo-server-errors'

import { getEventManager } from '@services/EventManager'
import { InfinibayContext } from '@utils/context'
import { Debugger } from '@utils/debug'

import { FirewallOrchestrationService } from '@services/firewall/FirewallOrchestrationService'
import { FirewallRuleService } from '@services/firewall/FirewallRuleService'
import { FirewallValidationService } from '@services/firewall/FirewallValidationService'
import { InfinivirtFirewallService } from '@services/firewall/InfinivirtFirewallService'

import { FirewallRule, RuleSetType } from '@prisma/client'

import { CreateFirewallRuleInput, UpdateFirewallRuleInput } from './inputs'
import {
  CleanupResultType,
  ConflictType,
  EffectiveRuleSetType,
  FirewallRuleSetType,
  FirewallRuleType,
  FlushResultType,
  NftablesChainInfoType,
  SyncResultType,
  ValidationResultType
} from './types'

const debug = new Debugger('infinibay:resolver:firewall')

@Resolver()
export class FirewallResolver {
  // Helper to convert service validation result to GraphQL type
  private convertValidationResult (serviceResult: import('@services/firewall/FirewallValidationService').ValidationResult): ValidationResultType {
    return {
      isValid: serviceResult.isValid,
      warnings: serviceResult.warnings,
      conflicts: serviceResult.conflicts.map(c => ({
        type: c.type as unknown as ConflictType,
        message: c.message,
        affectedRules: c.affectedRules as FirewallRuleType[]
      }))
    }
  }

  // Helper to create a temporary FirewallRule object from input for validation
  private createTempRuleFromInput (input: CreateFirewallRuleInput, ruleSetId: string): FirewallRule {
    return {
      id: 'temp',
      ruleSetId,
      name: input.name,
      description: input.description ?? null,
      action: input.action,
      direction: input.direction,
      priority: input.priority,
      protocol: input.protocol ?? 'all',
      srcPortStart: input.srcPortStart ?? null,
      srcPortEnd: input.srcPortEnd ?? null,
      dstPortStart: input.dstPortStart ?? null,
      dstPortEnd: input.dstPortEnd ?? null,
      srcIpAddr: input.srcIpAddr ?? null,
      srcIpMask: input.srcIpMask ?? null,
      dstIpAddr: input.dstIpAddr ?? null,
      dstIpMask: input.dstIpMask ?? null,
      connectionState: input.connectionState ?? null,
      overridesDept: input.overridesDept ?? false,
      createdAt: new Date(),
      updatedAt: new Date()
    } as FirewallRule
  }

  // Initialize services
  private async getServices (ctx: InfinibayContext) {
    const ruleService = new FirewallRuleService(ctx.prisma)
    const validationService = new FirewallValidationService()
    const infinivirtService = new InfinivirtFirewallService(ctx.prisma)
    await infinivirtService.initialize()
    const orchestrationService = new FirewallOrchestrationService(
      ctx.prisma,
      ruleService,
      validationService,
      infinivirtService
    )

    return { ruleService, validationService, infinivirtService, orchestrationService }
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  @Query(() => FirewallRuleSetType, { nullable: true })
  @Authorized('USER')
  async getDepartmentFirewallRules (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<FirewallRuleSetType | null> {
    const { ruleService } = await this.getServices(ctx)

    const ruleSet = await ruleService.getRuleSetByEntity(RuleSetType.DEPARTMENT, departmentId)

    if (!ruleSet) {
      return null
    }

    return ruleSet as FirewallRuleSetType
  }

  @Query(() => FirewallRuleSetType, { nullable: true })
  @Authorized('USER')
  async getVMFirewallRules (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<FirewallRuleSetType | null> {
    const { ruleService } = await this.getServices(ctx)

    const ruleSet = await ruleService.getRuleSetByEntity(RuleSetType.VM, vmId)

    if (!ruleSet) {
      return null
    }

    return ruleSet as FirewallRuleSetType
  }

  @Query(() => EffectiveRuleSetType)
  @Authorized('USER')
  async getEffectiveFirewallRules (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<EffectiveRuleSetType> {
    const { orchestrationService, validationService } = await this.getServices(ctx)

    // Get VM with department and rule sets
    const vm = await ctx.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: {
          include: {
            firewallRuleSet: {
              include: { rules: true }
            }
          }
        },
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    const deptRules = vm.department?.firewallRuleSet?.rules || []
    const vmRules = vm.firewallRuleSet?.rules || []

    // Get effective rules
    const effectiveRules = await orchestrationService.getEffectiveRules(vmId)

    // Validate for conflicts
    const validation = await validationService.validateRuleConflicts(effectiveRules)
    const convertedValidation = this.convertValidationResult(validation)

    return {
      vmId,
      departmentRules: deptRules as FirewallRuleType[],
      vmRules: vmRules as FirewallRuleType[],
      effectiveRules: effectiveRules as FirewallRuleType[],
      conflicts: convertedValidation.conflicts
    }
  }

  @Query(() => ValidationResultType)
  @Authorized('USER')
  async validateFirewallRule (
    @Arg('input') input: CreateFirewallRuleInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ValidationResultType> {
    const { validationService } = await this.getServices(ctx)

    // Create a temporary rule object for validation
    const tempRule = {
      ...input,
      id: 'temp',
      ruleSetId: 'temp',
      createdAt: new Date(),
      updatedAt: new Date(),
      overridesDept: input.overridesDept ?? false,
      protocol: input.protocol ?? 'all',
      description: input.description ?? null,
      srcPortStart: input.srcPortStart ?? null,
      srcPortEnd: input.srcPortEnd ?? null,
      dstPortStart: input.dstPortStart ?? null,
      dstPortEnd: input.dstPortEnd ?? null,
      srcIpAddr: input.srcIpAddr ?? null,
      srcIpMask: input.srcIpMask ?? null,
      dstIpAddr: input.dstIpAddr ?? null,
      dstIpMask: input.dstIpMask ?? null,
      connectionState: input.connectionState ?? null
    } as FirewallRule

    const validation = await validationService.validateRuleConflicts([tempRule])

    return this.convertValidationResult(validation)
  }

  @Query(() => [NftablesChainInfoType])
  @Authorized('ADMIN')
  async listInfinibayFilters (
    @Ctx() ctx: InfinibayContext
  ): Promise<NftablesChainInfoType[]> {
    const { infinivirtService } = await this.getServices(ctx)

    const vmChains = await infinivirtService.listVMChains()

    return vmChains.map(chain => ({
      chainName: chain.chainName,
      vmId: chain.vmId,
      // Deprecated fields for backward compatibility
      name: chain.chainName,
      uuid: chain.vmId
    }))
  }

  // ============================================================================
  // MUTATIONS
  // ============================================================================

  @Mutation(() => FirewallRuleType)
  @Authorized('ADMIN')
  async createDepartmentFirewallRule (
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('input') input: CreateFirewallRuleInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<FirewallRuleType> {
    const { ruleService, validationService, orchestrationService } = await this.getServices(ctx)

    // Check if department exists
    const department = await ctx.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!department) {
      throw new UserInputError('Department not found')
    }

    // Create rule set if it doesn't exist
    let ruleSet = department.firewallRuleSet
    if (!ruleSet) {
      const internalName = `department_${departmentId.substring(0, 8)}`
      ruleSet = await ruleService.createRuleSet(
        RuleSetType.DEPARTMENT,
        departmentId,
        `Firewall rules for ${department.name}`,
        internalName
      )

      // Link rule set to department
      await ctx.prisma.department.update({
        where: { id: departmentId },
        data: { firewallRuleSetId: ruleSet.id }
      })
    }

    // VM rules cannot use overridesDept in department context
    if (input.overridesDept) {
      throw new UserInputError('overridesDept can only be used for VM rules')
    }

    // Validate input before creating the rule
    const tempRule = this.createTempRuleFromInput(input, ruleSet.id)
    const inputValidation = await validationService.validateRuleInput(tempRule)

    if (!inputValidation.isValid) {
      throw new UserInputError(inputValidation.warnings.join('; '))
    }

    // Get existing department rules to validate with new rule
    const existingDeptRules = department.firewallRuleSet?.rules || []
    const allDeptRules = [...existingDeptRules, tempRule]

    // Validate department rules for conflicts and overlaps
    const deptValidation = await validationService.validateRuleConflicts(allDeptRules)

    if (!deptValidation.isValid) {
      const errorMessages = deptValidation.conflicts.map(c => c.message)
      throw new UserInputError(errorMessages.join(' '))
    }

    // Create the rule
    const rule = await ruleService.createRule(ruleSet.id, input)

    debug.log('info', `Created department rule ${rule.id} for department ${departmentId}`)

    // Emit real-time event
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('firewall', 'create', {
        id: rule.id,
        ruleSet: { entityType: ruleSet.entityType, entityId: ruleSet.entityId }
      }, ctx.user?.id)
    } catch (err) {
      debug.log('error', `Failed to emit firewall event: ${err}`)
    }

    // Apply rules to all VMs in the department
    try {
      await orchestrationService.applyDepartmentRules(departmentId)
      debug.log('info', `Applied department rules to all VMs in department ${departmentId}`)
    } catch (err) {
      debug.log('error', `Failed to apply department rules: ${err}`)
      // Don't fail the mutation, just log the error
    }

    return rule as FirewallRuleType
  }

  @Mutation(() => FirewallRuleType)
  @Authorized('ADMIN')
  async createVMFirewallRule (
    @Arg('vmId', () => ID) vmId: string,
    @Arg('input') input: CreateFirewallRuleInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<FirewallRuleType> {
    const { ruleService, validationService, orchestrationService } = await this.getServices(ctx)

    // Check if VM exists
    const vm = await ctx.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        firewallRuleSet: {
          include: { rules: true }
        }
      }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    // Create rule set if it doesn't exist
    let ruleSet = vm.firewallRuleSet
    if (!ruleSet) {
      const internalName = `vm_${vmId.substring(0, 8)}`
      ruleSet = await ruleService.createRuleSet(
        RuleSetType.VM,
        vmId,
        `Firewall rules for ${vm.name}`,
        internalName
      )

      // Link rule set to VM
      await ctx.prisma.machine.update({
        where: { id: vmId },
        data: { firewallRuleSetId: ruleSet.id }
      })
    }

    // Validate input before creating the rule
    const tempRule = this.createTempRuleFromInput(input, ruleSet.id)
    const inputValidation = await validationService.validateRuleInput(tempRule)

    if (!inputValidation.isValid) {
      throw new UserInputError(inputValidation.warnings.join('; '))
    }

    // Get existing VM rules to build effective rules with new rule
    const existingVMRules = vm.firewallRuleSet?.rules || []

    // Get department rules
    const deptRules = vm.departmentId
      ? await ctx.prisma.firewallRule.findMany({
        where: {
          ruleSet: {
            entityType: 'DEPARTMENT',
            entityId: vm.departmentId
          }
        }
      })
      : []

    // Build effective rules including the new rule
    const effectiveRules = [...deptRules, ...existingVMRules, tempRule]

    // Validate effective rules for conflicts and overlaps
    const effectiveValidation = await validationService.validateRuleConflicts(effectiveRules)

    if (!effectiveValidation.isValid) {
      const errorMessages = effectiveValidation.conflicts.map(c => c.message)
      throw new UserInputError(errorMessages.join(' '))
    }

    // Create the rule
    const rule = await ruleService.createRule(ruleSet.id, input)

    debug.log('info', `Created VM rule ${rule.id} for VM ${vmId}`)

    // Emit real-time event
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('firewall', 'create', {
        id: rule.id,
        ruleSet: { entityType: ruleSet.entityType, entityId: ruleSet.entityId }
      }, ctx.user?.id)
    } catch (err) {
      debug.log('error', `Failed to emit firewall event: ${err}`)
    }

    // Apply rules to the VM
    try {
      await orchestrationService.applyVMRules(vmId)
      debug.log('info', `Applied rules to VM ${vmId}`)
    } catch (err) {
      debug.log('error', `Failed to apply VM rules: ${err}`)
      // Don't fail the mutation, just log the error
    }

    return rule as FirewallRuleType
  }

  @Mutation(() => FirewallRuleType)
  @Authorized('ADMIN')
  async updateFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Arg('input') input: UpdateFirewallRuleInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<FirewallRuleType> {
    const { ruleService, orchestrationService } = await this.getServices(ctx)

    // Get existing rule to find associated VM/Department
    const existingRule = await ctx.prisma.firewallRule.findUnique({
      where: { id: ruleId },
      include: {
        ruleSet: true
      }
    })

    if (!existingRule) {
      throw new UserInputError('Rule not found')
    }

    // Update the rule
    const rule = await ruleService.updateRule(ruleId, input)

    debug.log('info', `Updated rule ${ruleId}`)

    // Emit real-time event
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('firewall', 'update', {
        id: rule.id,
        ruleSet: { entityType: existingRule.ruleSet.entityType, entityId: existingRule.ruleSet.entityId }
      }, ctx.user?.id)
    } catch (err) {
      debug.log('error', `Failed to emit firewall event: ${err}`)
    }

    // Re-apply rules to affected entities
    try {
      if (existingRule.ruleSet.entityType === RuleSetType.DEPARTMENT) {
        await orchestrationService.applyDepartmentRules(existingRule.ruleSet.entityId)
      } else {
        await orchestrationService.applyVMRules(existingRule.ruleSet.entityId)
      }
      debug.log('info', 'Re-applied rules after update')
    } catch (err) {
      debug.log('error', 'Failed to re-apply rules:', String(err))
    }

    return rule as FirewallRuleType
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteFirewallRule (
    @Arg('ruleId', () => ID) ruleId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { ruleService, orchestrationService } = await this.getServices(ctx)

    // Get existing rule to find associated VM/Department
    const existingRule = await ctx.prisma.firewallRule.findUnique({
      where: { id: ruleId },
      include: {
        ruleSet: true
      }
    })

    if (!existingRule) {
      throw new UserInputError('Rule not found')
    }

    // Delete the rule
    await ruleService.deleteRule(ruleId)

    debug.log('info', `Deleted rule ${ruleId}`)

    // Emit real-time event
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('firewall', 'delete', {
        id: existingRule.id,
        ruleSet: { entityType: existingRule.ruleSet.entityType, entityId: existingRule.ruleSet.entityId }
      }, ctx.user?.id)
    } catch (err) {
      debug.log('error', `Failed to emit firewall event: ${err}`)
    }

    // Re-apply rules to affected entities
    try {
      if (existingRule.ruleSet.entityType === RuleSetType.DEPARTMENT) {
        await orchestrationService.applyDepartmentRules(existingRule.ruleSet.entityId)
      } else {
        await orchestrationService.applyVMRules(existingRule.ruleSet.entityId)
      }
      debug.log('info', 'Re-applied rules after deletion')
    } catch (err) {
      debug.log('error', 'Failed to re-apply rules:', String(err))
    }

    return true
  }

  @Mutation(() => FlushResultType)
  @Authorized('ADMIN')
  async flushFirewallRules (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<FlushResultType> {
    const { orchestrationService } = await this.getServices(ctx)

    const result = await orchestrationService.applyVMRules(vmId)

    return {
      success: result.success,
      vmId,
      rulesApplied: result.rulesApplied,
      chainName: result.chainName,
      // Deprecated field for backward compatibility
      libvirtFilterName: result.chainName,
      timestamp: new Date()
    }
  }

  @Mutation(() => SyncResultType)
  @Authorized('ADMIN')
  async syncFirewallToLibvirt (
    @Ctx() ctx: InfinibayContext
  ): Promise<SyncResultType> {
    const { orchestrationService } = await this.getServices(ctx)

    const result = await orchestrationService.syncAllToNftables()

    // Note: nftables always replaces chains, so there's no distinction between
    // "create" and "update". Both fields reflect the count of VMs successfully synced.
    return {
      success: result.success,
      filtersCreated: result.vmsUpdated,
      filtersUpdated: result.vmsUpdated,
      vmsUpdated: result.vmsUpdated,
      errors: result.errors
    }
  }

  @Mutation(() => CleanupResultType)
  @Authorized('ADMIN')
  async cleanupInfinibayFirewall (
    @Ctx() ctx: InfinibayContext
  ): Promise<CleanupResultType> {
    const { infinivirtService } = await this.getServices(ctx)

    const vmChains = await infinivirtService.listVMChains()

    const removed: string[] = []
    let hadErrors = false
    for (const chain of vmChains) {
      try {
        await infinivirtService.removeVMFirewall(chain.vmId)
        removed.push(chain.chainName)
      } catch (error) {
        hadErrors = true
        debug.log('error', `Failed to remove chain ${chain.chainName}: ${error}`)
      }
    }

    return {
      success: !hadErrors,
      filtersRemoved: removed.length,
      filterNames: removed
    }
  }
}
