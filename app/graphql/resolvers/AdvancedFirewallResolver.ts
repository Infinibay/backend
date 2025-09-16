import { Resolver, Mutation, Arg, ID, Ctx, Authorized, Int } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { FirewallSimplifierService, SimplifiedRule } from '@services/FirewallSimplifierService'
import { PortValidationService } from '@services/PortValidationService'
import {
  VMFirewallState,
  CreateAdvancedFirewallRuleInput,
  PortInputType
} from '../types/SimplifiedFirewallType'
import { getSocketService } from '@services/SocketService'
import Debug from 'debug'

const debug = Debug('infinibay:advanced-firewall-resolver')

/**
 * Advanced Firewall Resolver
 *
 * Provides GraphQL mutations for creating sophisticated firewall rules
 * with flexible port configurations. Supports port ranges, multiple ports,
 * and automatic rule optimization.
 *
 * Features:
 * - Flexible port syntax (single, ranges, multiple, combinations)
 * - Automatic port validation and parsing
 * - Rule optimization (merging adjacent ranges)
 * - Real-time WebSocket notifications
 * - Integration with existing firewall templates
 *
 * Authorization:
 * - Users can only modify their own machines
 * - Admins can modify any machine
 *
 * WebSocket Events:
 * - firewall:advanced:rule:created
 * - firewall:range:rule:created
 */
@Resolver()
export class AdvancedFirewallResolver {
  private portValidationService: PortValidationService

  constructor () {
    // PortValidationService will be initialized once as it has no prisma dependency
    this.portValidationService = null as any
  }

  private getFirewallService (prisma: any): FirewallSimplifierService {
    // Always return a new instance to avoid caching with stale prisma context
    return new FirewallSimplifierService(prisma)
  }

  private getPortValidationService (): PortValidationService {
    if (!this.portValidationService) {
      this.portValidationService = new PortValidationService()
    }
    return this.portValidationService
  }

  private validateProtocol (protocol: string): void {
    const allowedProtocols = ['tcp', 'udp', 'icmp']
    if (!allowedProtocols.includes(protocol.toLowerCase())) {
      throw new UserInputError(`Invalid protocol '${protocol}'. Allowed values: ${allowedProtocols.join(', ')}`)
    }
  }

  private validateDirection (direction: string): void {
    const allowedDirections = ['in', 'out', 'inout']
    if (!allowedDirections.includes(direction.toLowerCase())) {
      throw new UserInputError(`Invalid direction '${direction}'. Allowed values: ${allowedDirections.join(', ')}`)
    }
  }

  private validateAction (action: string): void {
    const allowedActions = ['accept', 'drop', 'reject']
    if (!allowedActions.includes(action.toLowerCase())) {
      throw new UserInputError(`Invalid action '${action}'. Allowed values: ${allowedActions.join(', ')}`)
    }
  }

  /**
   * Creates advanced firewall rules with flexible port configurations.
   *
   * Supports:
   * - Single ports: "80"
   * - Port ranges: "8080-8090"
   * - Multiple ports: "80,443,8080"
   * - Combinations: "80,443,8080-8090"
   * - All ports: "all"
   *
   * The mutation automatically optimizes rules by merging adjacent ranges
   * and eliminating duplicates for better performance.
   *
   * @param input - Advanced firewall rule configuration
   * @returns Updated VM firewall state with new rules
   * @throws UserInputError - Invalid port format, machine not found, or access denied
   * @requires USER authorization - User must own the machine or be an admin
   * @emits firewall:advanced:rule:created - WebSocket event with rule details
   *
   * @example
   * ```graphql
   * mutation {
   *   createAdvancedFirewallRule(input: {
   *     machineId: "vm-123"
   *     ports: {
   *       type: MULTIPLE
   *       value: "80,443,8080-8090"
   *       description: "Web services"
   *     }
   *     protocol: "tcp"
   *     direction: "in"
   *     action: "accept"
   *     description: "Allow web traffic"
   *   }) {
   *     appliedTemplates
   *     customRules { port protocol direction action }
   *     effectiveRules { port protocol direction action }
   *   }
   * }
   * ```
   */
  @Mutation(() => VMFirewallState, {
    description: 'Create advanced firewall rule with flexible port configuration'
  })
  @Authorized('USER')
  async createAdvancedFirewallRule (
    @Arg('input', () => CreateAdvancedFirewallRuleInput, {
      description: 'Advanced firewall rule configuration'
    }) input: CreateAdvancedFirewallRuleInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<VMFirewallState> {
    debug(`Creating advanced firewall rule for machine ${input.machineId}`)

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

    // Validate protocol, direction, and action
    this.validateProtocol(input.protocol)
    this.validateDirection(input.direction)
    this.validateAction(input.action)

    let rules: SimplifiedRule[]

    // Handle special case for "all" ports before validation/parsing
    if (input.ports.type === PortInputType.ALL || input.ports.value.toLowerCase() === 'all') {
      rules = [{
        port: 'all',
        protocol: input.protocol,
        direction: input.direction as 'in' | 'out' | 'inout',
        action: input.action as 'accept' | 'drop' | 'reject',
        description: input.description || input.ports.description || 'Allow all ports'
      }]
      debug('Created ALL ports rule, skipping validation and parsing')
    } else {
      // Validate port string format
      const portValidationService = this.getPortValidationService()
      const validation = portValidationService.validatePortString(input.ports.value)

      if (!validation.isValid) {
        throw new UserInputError(`Invalid port configuration: ${validation.errors.join(', ')}`)
      }

      // Parse port string to get port ranges
      const portRanges = portValidationService.parsePortString(input.ports.value)
      debug(`Parsed ${portRanges.length} port ranges from "${input.ports.value}"`)

      // Guard against empty parsed ranges
      if (portRanges.length === 0) {
        throw new UserInputError('No valid ports found')
      }

      // Convert port ranges to SimplifiedRule objects
      rules = portRanges.map((range, index) => {
        const portString = range.start === range.end ?
          range.start.toString() :
          `${range.start}-${range.end}`

        const ruleDescription = input.description ||
          (portRanges.length > 1 ? `${input.ports.description || 'Advanced rule'} (${index + 1}/${portRanges.length})` : input.ports.description)

        return {
          port: portString,
          protocol: input.protocol,
          direction: input.direction as 'in' | 'out' | 'inout',
          action: input.action as 'accept' | 'drop' | 'reject',
          description: ruleDescription
        }
      })
    }

    debug(`Creating ${rules.length} firewall rule(s)`)

    // Add rules using the service
    const firewallService = this.getFirewallService(prisma)
    const result = await firewallService.addMultipleCustomRules(input.machineId, rules)

    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        const normalizedState = {
          ...result,
          lastSync: result.lastSync instanceof Date ? result.lastSync.toISOString() : result.lastSync ?? null
        }
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:advanced:rule:created', {
          data: {
            machineId: input.machineId,
            rules,
            state: normalizedState
          }
        })
        debug(`📡 Emitted vm:firewall:advanced:rule:created event for machine ${input.machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }

    return result
  }

  /**
   * Creates a firewall rule for a specific port range using individual parameters.
   *
   * This is a simplified alternative to createAdvancedFirewallRule for cases
   * where you want to specify start and end ports directly rather than using
   * a port string format.
   *
   * @param machineId - ID of the virtual machine
   * @param startPort - Starting port number (1-65535)
   * @param endPort - Ending port number (1-65535, must be >= startPort)
   * @param protocol - Network protocol (tcp, udp, icmp)
   * @param direction - Traffic direction (in, out, inout)
   * @param action - Firewall action (accept, drop, reject)
   * @param description - Optional rule description
   * @returns Updated VM firewall state with new rule
   * @throws UserInputError - Invalid port range, machine not found, or access denied
   * @requires USER authorization - User must own the machine or be an admin
   * @emits firewall:range:rule:created - WebSocket event with rule details
   *
   * @example
   * ```graphql
   * mutation {
   *   createPortRangeRule(
   *     machineId: "vm-123"
   *     startPort: 8080
   *     endPort: 8090
   *     protocol: "tcp"
   *     direction: "in"
   *     action: "accept"
   *     description: "Application server ports"
   *   ) {
   *     appliedTemplates
   *     customRules { port protocol direction action }
   *     effectiveRules { port protocol direction action }
   *   }
   * }
   * ```
   */
  @Mutation(() => VMFirewallState, {
    description: 'Create firewall rule for a specific port range'
  })
  @Authorized('USER')
  async createPortRangeRule (
    @Arg('machineId', () => ID, { description: 'ID of the virtual machine to configure' }) machineId: string,
    @Arg('startPort', () => Int, { description: 'Starting port number (1-65535)' }) startPort: number,
    @Arg('endPort', () => Int, { description: 'Ending port number (1-65535)' }) endPort: number,
    @Arg('protocol', { defaultValue: 'tcp', description: 'Network protocol: tcp, udp, or icmp' }) protocol: string,
    @Arg('direction', { defaultValue: 'in', description: 'Traffic direction: in, out, or inout' }) direction: string,
    @Arg('action', { defaultValue: 'accept', description: 'Firewall action: accept, drop, or reject' }) action: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('description', { nullable: true, description: 'Optional description for the rule' }) description?: string
  ): Promise<VMFirewallState> {
    debug(`Creating port range rule ${startPort}-${endPort} for machine ${machineId}`)

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

    // Validate protocol, direction, and action
    this.validateProtocol(protocol)
    this.validateDirection(direction)
    this.validateAction(action)

    // Validate port range
    if (startPort < 1 || startPort > 65535) {
      throw new UserInputError('Start port must be between 1 and 65535')
    }

    if (endPort < 1 || endPort > 65535) {
      throw new UserInputError('End port must be between 1 and 65535')
    }

    if (startPort > endPort) {
      throw new UserInputError('Start port must be less than or equal to end port')
    }

    // Create the port string (single port or range)
    const portString = startPort === endPort ?
      startPort.toString() :
      `${startPort}-${endPort}`

    // Create the rule
    const rule: SimplifiedRule = {
      port: portString,
      protocol,
      direction: direction as 'in' | 'out' | 'inout',
      action: action as 'accept' | 'drop' | 'reject',
      description: description || `Port range ${portString} (${protocol}/${direction}/${action})`
    }

    debug(`Creating single firewall rule: ${JSON.stringify(rule)}`)

    // Add rule using the service
    const firewallService = this.getFirewallService(prisma)
    const result = await firewallService.addCustomRule(machineId, rule)

    // Emit WebSocket event
    if (user) {
      try {
        const socketService = getSocketService()
        const rules: SimplifiedRule[] = [rule]
        const normalizedState = {
          ...result,
          lastSync: result.lastSync instanceof Date ? result.lastSync.toISOString() : result.lastSync ?? null
        }
        socketService.sendToUser(machine.userId || user.id, 'vm', 'firewall:range:rule:created', {
          data: {
            machineId,
            startPort,
            endPort,
            rules,
            state: normalizedState
          }
        })
        debug(`📡 Emitted vm:firewall:range:rule:created event for machine ${machineId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }
    }

    return result
  }
}