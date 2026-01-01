import {
  Arg,
  Authorized,
  Ctx,
  FieldResolver,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
  Root
} from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

import { InfinibayContext } from '@utils/context'
import { Debugger } from '@utils/debug'
import { Automation, OS } from '@prisma/client'

// Services
import {
  AutomationService,
  BlockRegistry,
  getBlockRegistry,
  BlocklyCodeGenerator,
  AutomationExecutor,
  RecommendationService,
  SystemScriptService,
  CustomBlockService
} from '@services/automations'

// Types
import {
  AutomationType,
  AutomationTargetType,
  AutomationScriptType,
  AutomationExecutionType,
  AutomationRecommendationType,
  SystemScriptType,
  CustomBlockType,
  CustomBlockInputType,
  BlocklyToolboxType,
  AutomationValidationResultType,
  TestResultType,
  AutomationUserType,
  AutomationDepartmentType,
  SnoozeDuration,
  AutomationTemplateType
} from './types'

// Inputs
import {
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationFiltersInput,
  AutomationExecutionFiltersInput,
  LinkScriptToAutomationInput,
  CreateCustomBlockInput,
  UpdateCustomBlockInput,
  RecommendationFiltersInput,
  CreateSystemScriptInput,
  UpdateSystemScriptInput
} from './inputs'

const debug = new Debugger('infinibay:resolver:automation')

@Resolver(() => AutomationType)
export class AutomationResolver {
  // ============================================================================
  // AUTOMATION QUERIES
  // ============================================================================

  @Query(() => AutomationType, { nullable: true })
  @Authorized('USER')
  async automation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType | null> {
    const service = new AutomationService(ctx.prisma, ctx.user)
    const automation = await service.getAutomation(id)
    return automation as unknown as AutomationType | null
  }

  @Query(() => [AutomationType])
  @Authorized('USER')
  async automations (
    @Arg('filters', () => AutomationFiltersInput, { nullable: true }) filters: AutomationFiltersInput | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType[]> {
    const service = new AutomationService(ctx.prisma, ctx.user)
    const automations = await service.listAutomations(filters ?? undefined)
    return automations as unknown as AutomationType[]
  }

  @Query(() => [AutomationExecutionType])
  @Authorized('USER')
  async automationExecutions (
    @Arg('filters', () => AutomationExecutionFiltersInput, { nullable: true }) filters: AutomationExecutionFiltersInput | null,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 50 }) limit: number,
    @Arg('offset', () => Int, { nullable: true, defaultValue: 0 }) offset: number,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationExecutionType[]> {
    const where: Record<string, unknown> = {}

    if (filters?.automationId) where.automationId = filters.automationId
    if (filters?.machineId) where.machineId = filters.machineId
    if (filters?.status?.length) where.status = { in: filters.status }
    if (filters?.evaluationResult !== undefined) where.evaluationResult = filters.evaluationResult
    if (filters?.dateFrom || filters?.dateTo) {
      where.triggeredAt = {} as Record<string, Date>
      if (filters.dateFrom) (where.triggeredAt as Record<string, Date>).gte = filters.dateFrom
      if (filters.dateTo) (where.triggeredAt as Record<string, Date>).lte = filters.dateTo
    }

    const executions = await ctx.prisma.automationExecution.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { triggeredAt: 'desc' },
      include: {
        automation: true,
        machine: true,
        snapshot: true,
        scriptExecution: true
      }
    })

    return executions as unknown as AutomationExecutionType[]
  }

  @Query(() => AutomationExecutionType, { nullable: true })
  @Authorized('USER')
  async automationExecution (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationExecutionType | null> {
    const execution = await ctx.prisma.automationExecution.findUnique({
      where: { id },
      include: {
        automation: true,
        machine: true,
        snapshot: true,
        scriptExecution: true
      }
    })

    return execution as unknown as AutomationExecutionType | null
  }

  // ============================================================================
  // CUSTOM BLOCK QUERIES
  // ============================================================================

  @Query(() => CustomBlockType, { nullable: true })
  @Authorized('USER')
  async customBlock (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<CustomBlockType | null> {
    const service = new CustomBlockService(ctx.prisma, ctx.user?.id ?? null)
    const block = await service.getById(id)
    return block as unknown as CustomBlockType | null
  }

  @Query(() => [CustomBlockType])
  @Authorized('USER')
  async customBlocks (
    @Arg('category', () => String, { nullable: true }) category: string | null,
    @Arg('includeBuiltIn', () => Boolean, { nullable: true, defaultValue: true }) includeBuiltIn: boolean,
    @Ctx() ctx: InfinibayContext
  ): Promise<CustomBlockType[]> {
    const service = new CustomBlockService(ctx.prisma, ctx.user?.id ?? null)
    // Note: service uses isBuiltIn filter - when includeBuiltIn is false, we filter out built-in blocks
    const options: { category?: string; isBuiltIn?: boolean } = {}
    if (category) options.category = category
    if (!includeBuiltIn) options.isBuiltIn = false
    const blocks = await service.list(options)
    return blocks as unknown as CustomBlockType[]
  }

  // ============================================================================
  // TOOLBOX QUERY
  // ============================================================================

  @Query(() => BlocklyToolboxType)
  @Authorized('USER')
  async blocklyToolbox (
    @Ctx() ctx: InfinibayContext
  ): Promise<BlocklyToolboxType> {
    const registry = await getBlockRegistry(ctx.prisma)
    const categories = registry.getToolboxConfiguration()
    return { categories } as BlocklyToolboxType
  }

  // ============================================================================
  // CODE PREVIEW QUERIES
  // ============================================================================

  @Query(() => String)
  @Authorized('USER')
  async previewGeneratedCode (
    @Arg('blocklyWorkspace', () => GraphQLJSONObject) blocklyWorkspace: Record<string, unknown>,
    @Ctx() ctx: InfinibayContext
  ): Promise<string> {
    const registry = await getBlockRegistry(ctx.prisma)
    const generator = new BlocklyCodeGenerator(registry)
    return generator.generate(blocklyWorkspace)
  }

  @Query(() => AutomationValidationResultType)
  @Authorized('USER')
  async validateWorkspace (
    @Arg('blocklyWorkspace', () => GraphQLJSONObject) blocklyWorkspace: Record<string, unknown>,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationValidationResultType> {
    const registry = await getBlockRegistry(ctx.prisma)
    const generator = new BlocklyCodeGenerator(registry)

    try {
      generator.generate(blocklyWorkspace)
      return { isValid: true, errors: [], warnings: [] }
    } catch (error) {
      return {
        isValid: false,
        errors: [{ message: error instanceof Error ? error.message : 'Unknown error' }],
        warnings: []
      }
    }
  }

  // ============================================================================
  // RECOMMENDATION QUERIES
  // ============================================================================

  @Query(() => AutomationRecommendationType, { nullable: true })
  @Authorized('USER')
  async recommendation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType | null> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    const recommendation = await service.getById(id)
    return recommendation as unknown as AutomationRecommendationType | null
  }

  @Query(() => [AutomationRecommendationType])
  @Authorized('USER')
  async recommendations (
    @Arg('filters', () => RecommendationFiltersInput, { nullable: true }) filters: RecommendationFiltersInput | null,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 50 }) limit: number,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType[]> {
    const where: Record<string, unknown> = {}

    if (filters?.machineId) where.machineId = filters.machineId
    if (filters?.automationId) where.automationId = filters.automationId
    if (filters?.status?.length) where.status = { in: filters.status }
    if (filters?.severity?.length) where.severity = { in: filters.severity }

    const recommendations = await ctx.prisma.automationRecommendation.findMany({
      where,
      take: limit,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      include: {
        automation: true,
        machine: true,
        execution: true,
        actionTakenBy: true,
        script: true,
        systemScript: true,
        scriptExecution: true
      }
    })

    return recommendations as unknown as AutomationRecommendationType[]
  }

  @Query(() => [AutomationRecommendationType])
  @Authorized('USER')
  async pendingRecommendations (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType[]> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    const recommendations = await service.getPendingForMachine(machineId)
    return recommendations as unknown as AutomationRecommendationType[]
  }

  @Query(() => Int)
  @Authorized('USER')
  async pendingRecommendationCount (
    @Arg('machineId', () => ID, { nullable: true }) machineId: string | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<number> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    return service.getPendingCount(machineId ?? undefined)
  }

  // ============================================================================
  // SYSTEM SCRIPT QUERIES
  // ============================================================================

  @Query(() => SystemScriptType, { nullable: true })
  @Authorized('USER')
  async systemScript (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<SystemScriptType | null> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    const script = await service.getById(id)
    return script as unknown as SystemScriptType | null
  }

  @Query(() => [SystemScriptType])
  @Authorized('USER')
  async systemScripts (
    @Arg('category', () => String, { nullable: true }) category: string | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<SystemScriptType[]> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    const scripts = await service.list(category ?? undefined)
    return scripts as unknown as SystemScriptType[]
  }

  @Query(() => [String])
  @Authorized('USER')
  async systemScriptCategories (
    @Ctx() ctx: InfinibayContext
  ): Promise<string[]> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    return service.getCategories()
  }

  // ============================================================================
  // AUTOMATION TEMPLATE QUERIES
  // ============================================================================

  @Query(() => [AutomationTemplateType])
  @Authorized('USER')
  async automationTemplates (
    @Arg('category', () => String, { nullable: true }) category: string | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationTemplateType[]> {
    const where: Record<string, unknown> = { isEnabled: true }
    if (category) where.category = category

    const templates = await ctx.prisma.automationTemplate.findMany({
      where,
      orderBy: [{ category: 'asc' }, { usageCount: 'desc' }, { name: 'asc' }]
    })

    return templates as unknown as AutomationTemplateType[]
  }

  @Query(() => AutomationTemplateType, { nullable: true })
  @Authorized('USER')
  async automationTemplate (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationTemplateType | null> {
    const template = await ctx.prisma.automationTemplate.findUnique({
      where: { id }
    })

    return template as unknown as AutomationTemplateType | null
  }

  @Query(() => [String])
  @Authorized('USER')
  async automationTemplateCategories (
    @Ctx() ctx: InfinibayContext
  ): Promise<string[]> {
    const templates = await ctx.prisma.automationTemplate.findMany({
      where: { isEnabled: true },
      select: { category: true },
      distinct: ['category']
    })

    return templates.map(t => t.category)
  }

  // ============================================================================
  // AUTOMATION CRUD MUTATIONS
  // ============================================================================

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async createAutomation (
    @Arg('input') input: CreateAutomationInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.createAutomation(input)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async updateAutomation (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateAutomationInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.updateAutomation(id, input)
    return automation as unknown as AutomationType
  }

  @Mutation(() => Boolean)
  @Authorized('USER')
  async deleteAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    await service.deleteAutomation(id)
    return true
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async duplicateAutomation (
    @Arg('id', () => ID) id: string,
    @Arg('newName', () => String) newName: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const original = await service.getAutomation(id)

    if (!original) throw new Error('Automation not found')

    const automation = await service.createAutomation({
      name: newName,
      description: original.description ?? undefined,
      blocklyWorkspace: original.blocklyWorkspace as Record<string, unknown>,
      targetScope: original.targetScope,
      departmentId: original.departmentId ?? undefined,
      priority: original.priority,
      cooldownMinutes: original.cooldownMinutes,
      recommendationType: original.recommendationType ?? undefined,
      recommendationText: original.recommendationText ?? undefined,
      recommendationActionText: original.recommendationActionText ?? undefined
    })

    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async createAutomationFromTemplate (
    @Arg('templateId', () => ID) templateId: string,
    @Arg('name', () => String, { nullable: true }) name: string | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const template = await ctx.prisma.automationTemplate.findUnique({
      where: { id: templateId }
    })

    if (!template) throw new Error('Template not found')

    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)

    // Use provided name or generate one based on template
    const automationName = name ?? `${template.name} - Copy`

    const automation = await service.createAutomation({
      name: automationName,
      description: template.description ?? undefined,
      blocklyWorkspace: template.blocklyWorkspace as Record<string, unknown>,
      recommendationType: template.recommendationType ?? undefined
    })

    // Increment usage count
    await ctx.prisma.automationTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } }
    })

    return automation as unknown as AutomationType
  }

  // ============================================================================
  // AUTOMATION WORKFLOW MUTATIONS
  // ============================================================================

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async submitAutomationForApproval (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.submitForApproval(id)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('ADMIN')
  async approveAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.approveAutomation(id)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('ADMIN')
  async rejectAutomation (
    @Arg('id', () => ID) id: string,
    @Arg('reason', () => String) reason: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.rejectAutomation(id, reason)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async enableAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.enableAutomation(id)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async disableAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.disableAutomation(id)
    return automation as unknown as AutomationType
  }

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async archiveAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const automation = await ctx.prisma.automation.update({
      where: { id },
      data: { status: 'ARCHIVED', isEnabled: false }
    })
    return automation as unknown as AutomationType
  }

  // ============================================================================
  // COMPILATION MUTATION
  // ============================================================================

  @Mutation(() => AutomationType)
  @Authorized('USER')
  async compileAutomation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationType> {
    const service = new AutomationService(ctx.prisma, ctx.user, ctx.eventManager)
    const automation = await service.compileAutomation(id)
    return automation as unknown as AutomationType
  }

  // ============================================================================
  // SCRIPT LINKING MUTATIONS
  // ============================================================================

  @Mutation(() => AutomationScriptType)
  @Authorized('USER')
  async linkScriptToAutomation (
    @Arg('input') input: LinkScriptToAutomationInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationScriptType> {
    const automationScript = await ctx.prisma.automationScript.create({
      data: {
        automationId: input.automationId,
        scriptId: input.scriptId,
        systemScriptId: input.systemScriptId,
        os: input.os,
        executionOrder: input.executionOrder ?? 0
      },
      include: {
        script: true,
        systemScript: true
      }
    })

    return automationScript as unknown as AutomationScriptType
  }

  @Mutation(() => Boolean)
  @Authorized('USER')
  async unlinkScriptFromAutomation (
    @Arg('automationId', () => ID) automationId: string,
    @Arg('scriptId', () => ID, { nullable: true }) scriptId: string | null,
    @Arg('systemScriptId', () => ID, { nullable: true }) systemScriptId: string | null,
    @Arg('os', () => OS) os: OS,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    if (scriptId) {
      await ctx.prisma.automationScript.delete({
        where: {
          automationId_scriptId_os: { automationId, scriptId, os }
        }
      })
    } else if (systemScriptId) {
      await ctx.prisma.automationScript.delete({
        where: {
          automationId_systemScriptId_os: { automationId, systemScriptId, os }
        }
      })
    }

    return true
  }

  @Mutation(() => AutomationScriptType)
  @Authorized('USER')
  async updateAutomationScript (
    @Arg('id', () => ID) id: string,
    @Arg('executionOrder', () => Int, { nullable: true }) executionOrder: number | null,
    @Arg('executeOnTrigger', () => Boolean, { nullable: true }) executeOnTrigger: boolean | null,
    @Arg('isEnabled', () => Boolean, { nullable: true }) isEnabled: boolean | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationScriptType> {
    const data: Record<string, unknown> = {}
    if (executionOrder !== null) data.executionOrder = executionOrder
    if (executeOnTrigger !== null) data.executeOnTrigger = executeOnTrigger
    if (isEnabled !== null) data.isEnabled = isEnabled

    const automationScript = await ctx.prisma.automationScript.update({
      where: { id },
      data,
      include: {
        script: true,
        systemScript: true
      }
    })

    return automationScript as unknown as AutomationScriptType
  }

  // ============================================================================
  // TESTING MUTATIONS
  // ============================================================================

  @Mutation(() => AutomationExecutionType)
  @Authorized('USER')
  async testAutomation (
    @Arg('automationId', () => ID) automationId: string,
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationExecutionType> {
    const automation = await ctx.prisma.automation.findUnique({
      where: { id: automationId }
    })

    if (!automation) throw new Error('Automation not found')
    if (!automation.isCompiled) throw new Error('Automation not compiled')

    const machine = await ctx.prisma.machine.findUnique({
      where: { id: machineId }
    })

    if (!machine) throw new Error('Machine not found')

    const snapshot = await ctx.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })

    const metrics = await ctx.prisma.systemMetrics.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' }
    })

    if (!snapshot || !metrics) {
      throw new Error('No health data available for this machine')
    }

    const executor = new AutomationExecutor(ctx.prisma)
    const result = await executor.execute(automation, machine, snapshot, metrics)

    const execution = await ctx.prisma.automationExecution.create({
      data: {
        automationId,
        machineId,
        snapshotId: snapshot.id,
        triggerReason: result.triggered ? 'Test: Condition met' : 'Test: Condition not met',
        evaluationResult: result.triggered,
        status: result.error ? 'FAILED' : 'COMPLETED',
        evaluationTimeMs: result.evaluationTimeMs,
        contextSnapshot: result.contextSnapshot as object,
        error: result.error,
        evaluatedAt: new Date(),
        completedAt: new Date()
      },
      include: {
        automation: true,
        machine: true,
        snapshot: true
      }
    })

    return execution as unknown as AutomationExecutionType
  }

  @Mutation(() => TestResultType)
  @Authorized('USER')
  async testAutomationWithContext (
    @Arg('automationId', () => ID) automationId: string,
    @Arg('context', () => GraphQLJSONObject) customContext: Record<string, unknown>,
    @Ctx() ctx: InfinibayContext
  ): Promise<TestResultType> {
    const automation = await ctx.prisma.automation.findUnique({
      where: { id: automationId }
    })

    if (!automation) throw new Error('Automation not found')
    if (!automation.compiledCode) throw new Error('Automation not compiled')

    const startTime = Date.now()
    const logs: string[] = []

    try {
      const ivm = await import('isolated-vm')
      const isolate = new ivm.Isolate({ memoryLimit: 128 })
      const vmContext = await isolate.createContext()

      await vmContext.global.set('context', new ivm.ExternalCopy(customContext).copyInto())

      const script = await isolate.compileScript(automation.compiledCode)
      const result = await script.run(vmContext, { timeout: 5000 })

      isolate.dispose()

      return {
        success: true,
        result: Boolean(result),
        generatedCode: automation.generatedCode,
        evaluationTimeMs: Date.now() - startTime,
        error: undefined,
        logs
      }
    } catch (error) {
      return {
        success: false,
        result: undefined,
        generatedCode: automation.generatedCode,
        evaluationTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        logs
      }
    }
  }

  // ============================================================================
  // CUSTOM BLOCK MUTATIONS (Admin Only)
  // ============================================================================

  @Mutation(() => CustomBlockType)
  @Authorized('ADMIN')
  async createCustomBlock (
    @Arg('input') input: CreateCustomBlockInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<CustomBlockType> {
    const service = new CustomBlockService(ctx.prisma, ctx.user?.id ?? null)
    const block = await service.create({
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      blockDefinition: input.blockDefinition as unknown as import('@services/automations').BlockDefinition,
      generatorCode: input.generatorCode,
      inputs: input.inputs,
      outputType: input.outputType,
      supportedOS: input.supportedOS
    })
    return block as unknown as CustomBlockType
  }

  @Mutation(() => CustomBlockType)
  @Authorized('ADMIN')
  async updateCustomBlock (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateCustomBlockInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<CustomBlockType> {
    const service = new CustomBlockService(ctx.prisma, ctx.user?.id ?? null)
    // Cast blockDefinition to the expected type
    const serviceInput = {
      ...input,
      blockDefinition: input.blockDefinition as unknown as import('@services/automations').BlockDefinition | undefined
    }
    const block = await service.update(id, serviceInput)
    return block as unknown as CustomBlockType
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteCustomBlock (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const block = await ctx.prisma.customBlock.findUnique({ where: { id } })
    if (block?.isBuiltIn) {
      throw new Error('Cannot delete built-in blocks')
    }

    await ctx.prisma.customBlock.delete({ where: { id } })
    return true
  }

  @Mutation(() => GraphQLJSONObject)
  @Authorized('ADMIN')
  async testCustomBlock (
    @Arg('id', () => ID) id: string,
    @Arg('sampleInputs', () => GraphQLJSONObject) sampleInputs: Record<string, unknown>,
    @Arg('sampleContext', () => GraphQLJSONObject, { nullable: true }) sampleContext: Record<string, unknown> | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<Record<string, unknown>> {
    const block = await ctx.prisma.customBlock.findUnique({ where: { id } })
    if (!block) throw new Error('Block not found')

    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('inputs', 'context', block.generatorCode)
      const result = fn(sampleInputs, sampleContext ?? {})
      return { success: true, result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // ============================================================================
  // RECOMMENDATION MUTATIONS
  // ============================================================================

  @Mutation(() => AutomationRecommendationType)
  @Authorized('USER')
  async executeRecommendation (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    const recommendation = await service.executeAction(id)
    return recommendation as unknown as AutomationRecommendationType
  }

  @Mutation(() => AutomationRecommendationType)
  @Authorized('USER')
  async dismissRecommendation (
    @Arg('id', () => ID) id: string,
    @Arg('reason', () => String, { nullable: true }) reason: string | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    const recommendation = await service.dismissAction(id, reason ?? undefined)
    return recommendation as unknown as AutomationRecommendationType
  }

  @Mutation(() => AutomationRecommendationType)
  @Authorized('USER')
  async snoozeRecommendation (
    @Arg('id', () => ID) id: string,
    @Arg('duration', () => SnoozeDuration) duration: SnoozeDuration,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationRecommendationType> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    // Cast the GraphQL enum to the service's string type
    const recommendation = await service.snoozeAction(id, { duration: duration as 'PT1H' | 'PT4H' | 'PT24H' | 'P7D' })
    return recommendation as unknown as AutomationRecommendationType
  }

  @Mutation(() => Int)
  @Authorized('USER')
  async dismissAllRecommendations (
    @Ctx() ctx: InfinibayContext
  ): Promise<number> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    return service.dismissAll()
  }

  @Mutation(() => Int)
  @Authorized('USER')
  async snoozeAllRecommendations (
    @Arg('duration', () => SnoozeDuration) duration: SnoozeDuration,
    @Ctx() ctx: InfinibayContext
  ): Promise<number> {
    const service = new RecommendationService(ctx.prisma, ctx.user?.id ?? null)
    // Cast the GraphQL enum to the service's string type
    return service.snoozeAll(duration as 'PT1H' | 'PT4H' | 'PT24H' | 'P7D')
  }

  // ============================================================================
  // SYSTEM SCRIPT MUTATIONS (Admin Only)
  // ============================================================================

  @Mutation(() => SystemScriptType)
  @Authorized('ADMIN')
  async createSystemScript (
    @Arg('input') input: CreateSystemScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<SystemScriptType> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    const script = await service.create(input)
    return script as unknown as SystemScriptType
  }

  @Mutation(() => SystemScriptType)
  @Authorized('ADMIN')
  async updateSystemScript (
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateSystemScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<SystemScriptType> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    const script = await service.update(id, input)
    return script as unknown as SystemScriptType
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteSystemScript (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const service = new SystemScriptService(ctx.prisma, ctx.user?.id ?? null)
    await service.delete(id)
    return true
  }

  // ============================================================================
  // FIELD RESOLVERS
  // ============================================================================

  @FieldResolver(() => AutomationUserType, { nullable: true })
  async createdBy (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationUserType | null> {
    if (!automation.createdById) return null
    const user = await ctx.prisma.user.findUnique({
      where: { id: automation.createdById }
    })
    if (!user) return null
    return {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email
    }
  }

  @FieldResolver(() => AutomationUserType, { nullable: true })
  async approvedBy (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationUserType | null> {
    if (!automation.approvedById) return null
    const user = await ctx.prisma.user.findUnique({
      where: { id: automation.approvedById }
    })
    if (!user) return null
    return {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email
    }
  }

  @FieldResolver(() => AutomationDepartmentType, { nullable: true })
  async department (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationDepartmentType | null> {
    if (!automation.departmentId) return null
    const department = await ctx.prisma.department.findUnique({
      where: { id: automation.departmentId }
    })
    return department as AutomationDepartmentType | null
  }

  @FieldResolver(() => [AutomationScriptType])
  async automationScripts (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationScriptType[]> {
    const scripts = await ctx.prisma.automationScript.findMany({
      where: { automationId: automation.id },
      include: { script: true, systemScript: true },
      orderBy: { executionOrder: 'asc' }
    })
    return scripts as unknown as AutomationScriptType[]
  }

  @FieldResolver(() => [AutomationTargetType])
  async targets (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationTargetType[]> {
    const targets = await ctx.prisma.automationTarget.findMany({
      where: { automationId: automation.id },
      include: { machine: true }
    })
    return targets as unknown as AutomationTargetType[]
  }

  @FieldResolver(() => [AutomationExecutionType])
  async recentExecutions (
    @Root() automation: Automation,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 10 }) limit: number,
    @Ctx() ctx: InfinibayContext
  ): Promise<AutomationExecutionType[]> {
    const executions = await ctx.prisma.automationExecution.findMany({
      where: { automationId: automation.id },
      take: limit,
      orderBy: { triggeredAt: 'desc' },
      include: { machine: true }
    })
    return executions as unknown as AutomationExecutionType[]
  }

  @FieldResolver(() => Int)
  async executionCount (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<number> {
    return ctx.prisma.automationExecution.count({
      where: { automationId: automation.id }
    })
  }

  @FieldResolver(() => Date, { nullable: true })
  async lastTriggeredAt (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<Date | null> {
    const lastExecution = await ctx.prisma.automationExecution.findFirst({
      where: { automationId: automation.id, evaluationResult: true },
      orderBy: { triggeredAt: 'desc' },
      select: { triggeredAt: true }
    })
    return lastExecution?.triggeredAt ?? null
  }

  @FieldResolver(() => Number, { nullable: true })
  async triggerRate (
    @Root() automation: Automation,
    @Ctx() ctx: InfinibayContext
  ): Promise<number | null> {
    const total = await ctx.prisma.automationExecution.count({
      where: { automationId: automation.id }
    })

    if (total === 0) return 0

    const triggered = await ctx.prisma.automationExecution.count({
      where: { automationId: automation.id, evaluationResult: true }
    })

    return (triggered / total) * 100
  }
}
