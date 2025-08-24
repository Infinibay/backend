import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { FirewallSimplifierService, FirewallTemplate as ServiceFirewallTemplate } from '@services/FirewallSimplifierService'
import {
  SimplifiedFirewallRule,
  VMFirewallState,
  FirewallTemplateInfo,
  FirewallTemplate,
  CreateSimplifiedFirewallRuleInput,
  ApplyFirewallTemplateInput
} from '../types/SimplifiedFirewallType'
import { SimplifiedRule } from '@services/FirewallSimplifierService'
import { getSocketService } from '@services/SocketService'
import Debug from 'debug'

const debug = Debug('infinibay:firewall-resolver')

@Resolver()
export class SimplifiedFirewallResolver {
  private firewallSimplifierService: FirewallSimplifierService

  constructor() {
    // Service will be initialized per request with the request's prisma instance
    this.firewallSimplifierService = null as any
  }

  private getService(prisma: any): FirewallSimplifierService {
    if (!this.firewallSimplifierService) {
      this.firewallSimplifierService = new FirewallSimplifierService(prisma)
    }
    return this.firewallSimplifierService
  }

  @Query(() => [SimplifiedFirewallRule])
  @Authorized('USER')
  async getSimplifiedFirewallRules(
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SimplifiedFirewallRule[]> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    return await service.getSimplifiedRules(machineId)
  }

  @Query(() => VMFirewallState)
  @Authorized('USER')
  async getVMFirewallState(
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    return await service.getVMFirewallState(machineId)
  }

  @Query(() => [FirewallTemplateInfo])
  @Authorized('USER')
  async getAvailableFirewallTemplates(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FirewallTemplateInfo[]> {
    const service = this.getService(prisma)
    return service.getAvailableTemplates()
  }

  @Query(() => FirewallTemplateInfo, { nullable: true })
  @Authorized('USER')
  async getFirewallTemplateInfo(
    @Arg('template', () => FirewallTemplate) template: FirewallTemplate,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FirewallTemplateInfo | undefined> {
    const service = this.getService(prisma)
    return service.getTemplateInfo(template as ServiceFirewallTemplate)
  }

  @Mutation(() => VMFirewallState)
  @Authorized('USER')
  async applyFirewallTemplate(
    @Arg('input') input: ApplyFirewallTemplateInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: input.machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    const result = await service.applyFirewallTemplate(
      input.machineId,
      input.template as ServiceFirewallTemplate
    )
    
    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:template:applied', {
          data: {
            machineId: input.machineId,
            template: input.template,
            state: result
          }
        })
        debug(`📡 Emitted vm:firewall:template:applied event for machine ${input.machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }
    
    return result
  }

  @Mutation(() => VMFirewallState)
  @Authorized('USER')
  async removeFirewallTemplate(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('template', () => FirewallTemplate) template: FirewallTemplate,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    const result = await service.removeFirewallTemplate(
      machineId,
      template as ServiceFirewallTemplate
    )
    
    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:template:removed', {
          data: {
            machineId,
            template,
            state: result
          }
        })
        debug(`📡 Emitted vm:firewall:template:removed event for machine ${machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }
    
    return result
  }

  @Mutation(() => VMFirewallState)
  @Authorized('USER')
  async toggleFirewallTemplate(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('template', () => FirewallTemplate) template: FirewallTemplate,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    return await service.toggleFirewallTemplate(
      machineId,
      template as ServiceFirewallTemplate
    )
  }

  @Mutation(() => VMFirewallState)
  @Authorized('USER')
  async createSimplifiedFirewallRule(
    @Arg('input') input: CreateSimplifiedFirewallRuleInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: input.machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    const service = this.getService(prisma)
    const rule: SimplifiedRule = {
      port: input.port,
      protocol: input.protocol,
      direction: input.direction as 'in' | 'out' | 'inout',
      action: input.action as 'accept' | 'drop' | 'reject',
      description: input.description
    }

    const result = await service.addCustomRule(input.machineId, rule)
    
    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:rule:created', {
          data: {
            machineId: input.machineId,
            rule,
            state: result
          }
        })
        debug(`📡 Emitted vm:firewall:rule:created event for machine ${input.machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }
    
    return result
  }

  @Mutation(() => VMFirewallState)
  @Authorized('USER')
  async removeSimplifiedFirewallRule(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('ruleId', () => ID) ruleId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    // Check if user has access to this machine
    const machine = await prisma.machine.findFirst({
      where: {
        id: machineId,
        ...(user?.role !== 'ADMIN' ? { userId: user?.id } : {})
      }
    })

    if (!machine) {
      throw new UserInputError('Machine not found or access denied')
    }

    // Get current state
    const service = this.getService(prisma)
    const state = await service.getVMFirewallState(machineId)
    
    // Remove the custom rule with the given ID
    const updatedCustomRules = state.customRules.filter(r => r.id !== ruleId)
    
    // Update the firewall state in the database
    await prisma.machine.update({
      where: { id: machineId },
      data: {
        firewallTemplates: {
          appliedTemplates: state.appliedTemplates,
          customRules: updatedCustomRules as any,
          lastSync: new Date().toISOString()
        }
      }
    })

    // Return updated state
    const result = await service.getVMFirewallState(machineId)
    
    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:rule:removed', {
          data: {
            machineId,
            ruleId,
            state: result
          }
        })
        debug(`📡 Emitted vm:firewall:rule:removed event for machine ${machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }
    
    return result
  }
}