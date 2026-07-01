import logger from '@main/logger'
import { Arg, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { UserInputError } from '@utils/errors'
import { sanitizeErrorForUser } from '@utils/sanitizeError'
import {
  Machine,
  MachineOrderBy,
  CreateMachineInputType,
  GraphicConfigurationType,
  SuccessType,
  MachineStatus,
  CommandExecutionResponseType,
  UpdateMachineHardwareInput,
  UpdateMachineNameInput,
  UpdateMachineUserInput,
  MachineMigrationResultType,
  DomainJoinResultType,
  JoinDomainInput
} from './type'
import { UserType } from '../user/type'
import { MachineTemplateType } from '../machine_template/type'
import { DepartmentType } from '../department/type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@main/utils/context'
import { GraphicPortService } from '@utils/VirtManager/graphicPortService'

import { MachineLifecycleService } from '../../../services/machineLifecycleService'
import { getEventManager } from '../../../services/EventManager'
import { VMOperationsService } from '../../../services/VMOperationsService'
import { isDiskOperationInProgress } from '../../../constants/machine-status'
import { getSocketService } from '../../../services/SocketService'
import { VMMoveService } from '../../../services/VMMoveService'
import { FirewallOrchestrationService } from '../../../services/firewall/FirewallOrchestrationService'
import { FirewallRuleService } from '../../../services/firewall/FirewallRuleService'
import { FirewallValidationService } from '../../../services/firewall/FirewallValidationService'
import { InfinizationFirewallService } from '../../../services/firewall/InfinizationFirewallService'
import { VMMigrationService } from '../../../services/node/VMMigrationService'
import { AgentStorageMigrationAdapter } from '../../../services/node/AgentStorageMigrationAdapter'
import { NodeDispatcher } from '../../../services/node/NodeDispatcher'
import { DomainJoinService } from '../../../services/DomainJoinService'
import { Machine as PrismaMachine, MachineTemplate as PrismaMachineTemplate, Department as PrismaDepartment, MachineConfiguration, PrismaClient } from '@prisma/client'
import { SafeUser } from '@utils/context'
import { Can } from '@main/permissions'

type MachineWithRelations = PrismaMachine & {
  configuration?: MachineConfiguration | null
  department?: PrismaDepartment | null
  template?: PrismaMachineTemplate | null
  user?: SafeUser | null
}

async function transformMachine (prismaMachine: MachineWithRelations, prisma?: PrismaClient): Promise<Machine> {
  // Use included relations from Prisma query instead of individual DB lookups (fixes N+1)
  const user = prismaMachine.user ?? null
  const template = prismaMachine.template ?? null
  const department = prismaMachine.department ?? null
  const graphicHost = (prismaMachine.configuration?.graphicHost) || process.env.GRAPHIC_HOST || 'localhost'
  let graphicPort: number | undefined

  // Get graphic port from configuration if valid, regardless of VM status
  // This allows configuration.graphic to be available based on persisted config
  if (prismaMachine.configuration) {
    const storedPort = prismaMachine.configuration.graphicPort
    const storedProtocol = prismaMachine.configuration.graphicProtocol

    // Only use the port if both protocol and port are valid
    if (storedProtocol && storedPort !== null && storedPort > 0 && storedPort <= 65535) {
      graphicPort = storedPort
    } else if (prismaMachine.status === 'running' && prisma) {
      // Fallback: try to get from GraphicPortService if VM is running
      // Only when the stored config is invalid and prisma is available
      try {
        const protocol = storedProtocol || 'vnc'
        const fetchedPort = await new GraphicPortService(prisma).getGraphicPort(prismaMachine.internalName, protocol)
        // If port is invalid (-1), log warning and leave undefined
        if (fetchedPort === -1) {
          logger.warn(`Invalid graphics port (-1) for running VM ${prismaMachine.internalName}. Configuration may be corrupted.`)
        } else {
          graphicPort = fetchedPort
        }
      } catch (e) {
        logger.info(`Could not get graphic port for VM ${prismaMachine.internalName}:`, e)
      }
    }
  }

  // Build the configuration JSON the UI reads. Surface the install/create failure
  // reason (lastError) WHENEVER it is set — not just when the VM is running — so an
  // errored VM shows WHY it failed instead of silently looking broken. The SPICE/VNC
  // `graphic` URL is only added when there is a live display (graphicPort > 0).
  let configurationField: Record<string, unknown> | null = null
  if (prismaMachine.configuration) {
    const cfg: Record<string, unknown> = {}
    if (prismaMachine.configuration.lastError) {
      // Redact host paths / raw command stderr before exposing to the (possibly
      // non-admin) VM owner — the full detail stays in the DB + server logs.
      cfg.lastError = sanitizeErrorForUser(prismaMachine.configuration.lastError)
    }
    if (graphicPort && graphicPort > 0) {
      const protocol = prismaMachine.configuration.graphicProtocol || 'vnc'
      const password = prismaMachine.configuration.graphicPassword
      // Build URL without embedding literal 'null' - omit password portion if not set
      cfg.graphic = password
        ? `${protocol}://${password}@${graphicHost}:${graphicPort}`
        : `${protocol}://${graphicHost}:${graphicPort}`
    }
    if (Object.keys(cfg).length > 0) configurationField = cfg
  }

  return {
    ...prismaMachine,
    userId: prismaMachine.userId || null,
    departmentId: prismaMachine.departmentId || null, // Explicitly include departmentId
    templateId: prismaMachine.templateId || null,
    nodeId: prismaMachine.nodeId || null,
    user: user
      ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      } as UserType
      : undefined,
    template: template
      ? {
        // Return ALL persisted fields so Apollo's normalized cache doesn't
        // overwrite the template entity with nulls when this resolver is
        // reached from createMachine / machine queries — that used to make
        // blueprints "disappear" from the wizard until a hard refresh
        // (categoryId went null → templatesByCategory grouped under null).
        id: template.id,
        name: template.name,
        description: template.description,
        cores: template.cores,
        ram: template.ram,
        storage: template.storage,
        createdAt: template.createdAt,
        categoryId: template.categoryId ?? null,
        osType: template.osType ?? null,
        wallpaperUrl: template.wallpaperUrl ?? null,
        powerPlan: template.powerPlan ?? null,
        encryptDisk: template.encryptDisk ?? null
      } as MachineTemplateType
      : undefined,
    department: department
      ? {
        id: department.id,
        name: department.name,
        createdAt: department.createdAt,
        internetSpeed: department.internetSpeed,
        ipSubnet: department.ipSubnet
      } as DepartmentType
      : undefined,
    configuration: configurationField,
    status: prismaMachine.status as MachineStatus,
    setupComplete: prismaMachine.configuration?.setupComplete ?? false
  }
}

@Resolver()
export class MachineQueries {
  private debug = logger.child({ module: 'machine-queries' })

  @Query(() => Machine, { nullable: true })
  @Can('vm:view', { id: (a) => a.id })
  async machine (
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<Machine | null> {
    const prismaMachine = await prisma.machine.findFirst({
      where: { id },
      include: { configuration: true, department: true, template: true, user: true }
    })
    return prismaMachine ? await transformMachine(prismaMachine, prisma) : null
  }

  @Query(() => [Machine])
  @Can('vm:view')
  async machines (
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
    @Arg('orderBy', { nullable: true }) orderBy: MachineOrderBy,
    @Ctx() ctx: InfinibayContext
  ): Promise<Machine[]> {
    const { prisma } = ctx
    const whereClause = await ctx.scopedWhere!('vm:view')
    const order = { [(orderBy?.fieldName ?? 'createdAt')]: orderBy?.direction ?? 'desc' }

    const prismaMachines = await prisma.machine.findMany({
      ...pagination,
      orderBy: [order],
      where: whereClause,
      include: { configuration: true, department: true, template: true, user: true }
    })

    return Promise.all(prismaMachines.map(m => transformMachine(m, prisma)))
  }

  @Query(() => GraphicConfigurationType, { nullable: true })
  @Can('vm:console', { id: (a) => a.id })
  async graphicConnection (
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GraphicConfigurationType | null> {
    const machine = await prisma.machine.findFirst({
      where: { id },
      include: { configuration: true, department: true, template: true, user: true }
    })

    if (!machine || !machine.configuration) return null

    const port = await new GraphicPortService(prisma).getGraphicPort(machine.internalName, machine.configuration.graphicProtocol || 'vnc')

    // Validate port - detect corrupted configuration
    if (port === -1) {
      this.debug.error(`Invalid graphics port for VM ${machine.id} (${machine.name}): port=-1. Configuration may be corrupted.
        - internalName: ${machine.internalName}
        - storedProtocol: ${machine.configuration.graphicProtocol}
        - storedPort: ${machine.configuration.graphicPort}
        - storedHost: ${machine.configuration.graphicHost}
        - vmStatus: ${machine.status}`)

      throw new UserInputError(
        'Graphics connection not available. The VM graphics configuration may be corrupted. Try restarting the VM or contact an administrator.'
      )
    }

    return {
      link: `${machine.configuration.graphicProtocol}://${machine.configuration.graphicHost || process.env.GRAPHIC_HOST || 'localhost'}:${port}`,
      password: machine.configuration.graphicPassword || '',
      protocol: machine.configuration.graphicProtocol || 'vnc'
    }
  }
}

@Resolver()
export class MachineMutations {
  private debug = logger.child({ module: 'machine-mutations' })

  @Mutation(() => Machine)
  @Can('vm:create')
  async createMachine (
    @Arg('input') input: CreateMachineInputType,
    @Ctx() context: InfinibayContext
  ): Promise<Machine> {
    const { prisma, user } = context
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const newMachine = await lifecycleService.createMachine(input)

    // Trigger real-time event for VM creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'create', newMachine, user?.id)
      logger.info(`🎯 Triggered real-time event: vms:create for machine ${newMachine.id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    // Transform the machine to include all necessary fields
    return transformMachine(newMachine, prisma)
  }

  @Mutation(() => Machine)
  @Can('vm:edit', { id: (a) => a.input.id, scopeVia: 'vm' })
  async updateMachineHardware (
    @Arg('input') input: UpdateMachineHardwareInput,
    @Ctx() context: InfinibayContext
  ): Promise<Machine> {
    const { prisma, user } = context
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const updatedMachine = await lifecycleService.updateMachineHardware(input)

    // Trigger real-time event for VM hardware update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      logger.info(`🎯 Triggered real-time event: vms:update for machine ${input.id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => Machine)
  @Can('vm:edit', { id: (a) => a.input.id, scopeVia: 'vm' })
  async updateMachineName (
    @Arg('input') input: UpdateMachineNameInput,
    @Ctx() context: InfinibayContext
  ): Promise<Machine> {
    const { prisma, user } = context
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const updatedMachine = await lifecycleService.updateMachineName(input)

    // Trigger real-time event for VM name update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      logger.info(`🎯 Triggered real-time event: vms:update for machine ${input.id} (name update)`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => Machine)
  @Can('vm:assign', { id: (a) => a.input.id, scopeVia: 'vm' })
  async updateMachineUser (
    @Arg('input') input: UpdateMachineUserInput,
    @Ctx() context: InfinibayContext
  ): Promise<Machine> {
    const { prisma, user } = context
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const updatedMachine = await lifecycleService.updateMachineUser(input)

    // Trigger real-time event for VM user assignment update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      logger.info(`🎯 Triggered real-time event: vms:update for machine ${input.id} (user assignment update)`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => MachineMigrationResultType)
  @Can('vm:migrate', { id: (a) => a.id, scopeVia: 'vm' })
  async migrateMachineToNode (
    @Arg('id') id: string,
    @Arg('targetNodeId') targetNodeId: string,
    @Ctx() context: InfinibayContext
  ): Promise<MachineMigrationResultType> {
    const { prisma, user } = context
    // Local (non-shared) storage: physically copy the disk to the target node over
    // the mTLS disk channel (Phase 3). Shared storage needs no copy — the disk is
    // already reachable from the target — so we skip the adapter entirely.
    const sharedStorage = ['1', 'true', 'yes'].includes((process.env.INFINIBAY_SHARED_STORAGE || '').toLowerCase())
    // The dispatcher doubles as the liveness probe (executorFor → getVMStatus on the
    // owning node) so migration refuses to move a disk out from under a live qemu.
    const livenessProbe = new NodeDispatcher(prisma)
    const migrationService = sharedStorage
      ? new VMMigrationService(prisma, { storageMode: 'shared', livenessProbe })
      : new VMMigrationService(prisma, { storageAdapter: new AgentStorageMigrationAdapter(prisma), livenessProbe })
    const result = await migrationService.migrateStoppedMachineToNode(id, targetNodeId)

    try {
      const updatedMachine = await prisma.machine.findUnique({
        where: { id },
        include: { configuration: true, department: true, template: true, user: true }
      })
      if (updatedMachine) {
        await getEventManager().dispatchEvent('vms', 'update', updatedMachine, user?.id)
      }
    } catch (eventError) {
      logger.error('Failed to trigger migration event:', eventError)
    }

    return result
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async powerOn (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'powerOn', 'running')
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async powerOff (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'shutdown', 'off')
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async suspend (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'suspend', 'suspended')
  }

  /**
   * Join a running VM to the Active Directory / LDAP domain configured on an
   * IdentityProvider. Admin-only: it changes machine identity and uses the
   * provider's bind credentials. The actual join runs inside the guest via
   * the infiniservice JoinDomain command; state is persisted on the VM's
   * configuration and surfaced over the 'vms' event channel.
   */
  @Mutation(() => DomainJoinResultType)
  @Can('vm:joinDomain', { id: (a) => a.input.machineId, scopeVia: 'vm' })
  async joinVmToDomain (
    @Arg('input') input: JoinDomainInput,
    @Ctx() context: InfinibayContext
  ): Promise<DomainJoinResultType> {
    // When the caller doesn't supply BOTH username and password, the join falls
    // back to the IdentityProvider's stored bind secret — gate that on 'use'.
    const usesStoredBindSecret = !(input.username && input.password)
    if (usesStoredBindSecret) {
      await context.assertCan!('identityProvider:use')
    }

    const service = new DomainJoinService(context.prisma)
    const result = await service.joinMachineToDomain({
      machineId: input.machineId,
      identityProviderId: input.identityProviderId,
      username: input.username,
      password: input.password,
      ou: input.ou,
      computerName: input.computerName,
      restartAfter: input.restartAfter ?? false,
      triggeredBy: context.user?.id
    })
    return result
  }

  /**
   * Destroys a virtual machine and cleans up associated resources.
   *
   * @param id - The ID of the machine to destroy.
   * @param prisma - The Prisma client for database operations.
   * @param user - The current user context.
   * @returns A SuccessType indicating the result of the operation.
   */
  @Mutation(() => SuccessType)
  @Can('vm:delete', { id: (a) => a.id, scopeVia: 'vm' })
  async destroyMachine (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<SuccessType> {
    const { prisma, user } = context
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const result = await lifecycleService.destroyMachine(id)

    // Trigger real-time event for VM deletion if successful
    if (result.success) {
      try {
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'delete', { id }, user?.id)
        logger.info(`🎯 Triggered real-time event: vms:delete for machine ${id}`)
      } catch (eventError) {
        logger.error('Failed to trigger real-time event:', eventError)
        // Don't fail the main operation if event triggering fails
      }
    }

    return result
  }

  /**
   * Executes a command inside a virtual machine.
   *
   * @param id - The ID of the machine to execute the command.
   * @param command - The command to execute inside the VM.
   * @param prisma - The Prisma client for database operations.
   * @param user - The current user context.
   * @returns A CommandExecutionResponseType indicating the result of the operation along with the command response.
   */
  @Mutation(() => CommandExecutionResponseType)
  @Can('vm:execute', { id: (a) => a.id, scopeVia: 'vm' })
  async executeCommand (
    @Arg('id') id: string,
    @Arg('command') command: string,
    @Ctx() context: InfinibayContext
  ): Promise<CommandExecutionResponseType> {
    const { prisma } = context
    try {
      // Retrieve the machine from the database
      const machine = await prisma.machine.findFirst({ where: { id } })
      if (!machine) {
        return { success: false, message: 'Machine not found' }
      }

      // Execute the command inside the VM via QEMU Guest Agent
      const vmOpsService = new VMOperationsService(prisma)
      const result = await vmOpsService.executeGuestCommand(id, command)

      // The guest command actually ran iff we got an exitCode back. In that case
      // stdout/stderr are the user's OWN command output and are safe to return.
      const commandRan = typeof result.exitCode === 'number'
      if (commandRan) {
        return {
          success: result.success,
          message: result.success ? (result.stdout ?? '') : (result.stderr ?? ''),
          response: result.stdout
        }
      }

      // The command did not run: result.error is an infinization/QGA/internal
      // string (e.g. 'QGA socket error: connect ENOENT /var/lib/.../qga.sock') that
      // discloses host paths/sockets. Log the detail server-side, return generic.
      this.debug.error(`executeCommand infra failure for machine ${id}: ${result.error}`)
      return { success: false, message: 'Failed to execute command on the virtual machine' }
    } catch (error) {
      // Unexpected exception (infinization throw, attach failure, etc.). Never
      // surface raw error text to the client — log it, return a generic message.
      this.debug.error(`Error executing command on machine ${id}:`, error)
      return { success: false, message: 'Failed to execute command on the virtual machine' }
    }
  }

  /**
   * Changes the state of a virtual machine using VMOperationsService (infinization).
   *
   * For the 'shutdown' action, this method performs additional post-operation verification
   * to confirm that the QEMU process has actually terminated. This provides a defense-in-depth
   * layer to detect edge cases where infinization reports success but the process remains alive.
   *
   * @param id - The ID of the machine to change state.
   * @param prisma - The Prisma client for database operations.
   * @param user - The user requesting the state change.
   * @param action - The action to perform: 'powerOn', 'destroy', 'shutdown', or 'suspend'.
   * @param newStatus - The new status to set: 'running', 'off', or 'suspended'.
   * @returns A SuccessType object indicating the result of the operation.
   */
  private async changeMachineState (
    id: string,
    prisma: PrismaClient,
    user: SafeUser | null,
    action: 'powerOn' | 'destroy' | 'shutdown' | 'suspend',
    newStatus: 'running' | 'off' | 'suspended'
  ): Promise<SuccessType> {
    const operationStartTime = Date.now()

    try {
      // Retrieve the machine from the database
      const machine = await prisma.machine.findFirst({ where: { id } })
      if (!machine) {
        return { success: false, message: 'Machine not found' }
      }

      // Refuse to power on a VM whose row is claimed by an in-progress disk
      // operation (backing_up / restoring / snapshotting). Starting qemu while
      // qemu-img holds the qcow2 open corrupts the image. The DB status claim set
      // by BackupService / SnapshotServiceV2 is the authoritative cross-service
      // gate (audit H1). VMOperationsService.startMachine re-checks this too;
      // this is the outer fail-closed guard at the API boundary.
      if (action === 'powerOn' && isDiskOperationInProgress(machine.status)) {
        this.debug.warn(`[changeMachineState] Refusing powerOn for ${id}: disk operation in progress (status=${machine.status})`)
        return {
          success: false,
          message: `VM has a disk operation in progress (${machine.status}). Wait for the backup/restore/snapshot to finish before powering on.`
        }
      }

      // Pre-operation logging
      this.debug.debug(`[changeMachineState] Starting operation:
        - Machine ID: ${id}
        - Machine Name: ${machine.name}
        - Current DB Status: ${machine.status}
        - Action: ${action}
        - Target Status: ${newStatus}
        - Requested by: ${user?.email || 'unknown'} (${user?.role || 'unknown'})
        - Timestamp: ${new Date().toISOString()}`)

      // Use VMOperationsService for VM operations via infinization
      const vmOpsService = new VMOperationsService(prisma)

      // Perform the requested action
      let result
      switch (action) {
      case 'powerOn':
        result = await vmOpsService.startMachine(id)
        break
      case 'destroy':
        result = await vmOpsService.forcePowerOff(id)
        break
      case 'shutdown':
        result = await vmOpsService.gracefulPowerOff(id)
        break
      case 'suspend':
        result = await vmOpsService.suspendMachine(id)
        break
      default:
        throw new UserInputError(`Invalid action: ${action}`)
      }

      // Check if the action was successful
      if (!result.success) {
        const elapsedMs = Date.now() - operationStartTime
        this.debug.debug(`[changeMachineState] Operation failed after ${elapsedMs}ms:
          - Machine ID: ${id}
          - Action: ${action}
          - Error: ${result.error || 'Unknown error'}`)
        return { success: false, message: result.error || `Error performing ${action} on machine` }
      }

      // Post-shutdown verification: Confirm QEMU process is actually dead
      // This is a defense-in-depth layer to detect edge cases where infinization
      // reports success but the process remains alive due to race conditions or partial errors
      if (action === 'shutdown' && result.success) {
        const VERIFICATION_TIMEOUT_MS = 5000

        try {
          // Use Promise.race to implement timeout for verification
          const verificationPromise = vmOpsService.getStatus(id)
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), VERIFICATION_TIMEOUT_MS)
          })

          const vmStatus = await Promise.race([verificationPromise, timeoutPromise])

          if (vmStatus === null) {
            // Timeout expired or getStatus returned null
            this.debug.debug(`[changeMachineState] Warning: Post-shutdown verification timed out or failed
              - Machine ID: ${id}
              - Timeout: ${VERIFICATION_TIMEOUT_MS}ms
              - Proceeding with assumed success based on infinization result`)
          } else if (vmStatus.processAlive) {
            // Process is still alive - this is an error condition
            const elapsedMs = Date.now() - operationStartTime
            this.debug.debug(`[changeMachineState] ERROR: VM process still alive after shutdown:
              - Machine ID: ${id}
              - DB Status: ${vmStatus.status}
              - Process Alive: ${vmStatus.processAlive}
              - Consistent: ${vmStatus.consistent}
              - Elapsed Time: ${elapsedMs}ms
              - Note: ACPI shutdown may not have been acknowledged by guest OS`)
            return {
              success: false,
              message: 'VM process is still running after shutdown attempt. Process may not have responded to ACPI shutdown.'
            }
          } else {
            // Process is dead - shutdown was successful
            const elapsedMs = Date.now() - operationStartTime

            // Log a stronger warning if state is inconsistent (e.g., DB says running but process is dead)
            if (vmStatus.consistent === false) {
              this.debug.warn(`[changeMachineState] Post-shutdown verification: Inconsistent state detected:
              - Machine ID: ${id}
              - DB Status: ${vmStatus.status}
              - Process Alive: ${vmStatus.processAlive}
              - Consistent: false
              - Elapsed Time: ${elapsedMs}ms
              - Note: Database status may not reflect actual VM state. This could indicate a sync issue.`)
            }

            this.debug.debug(`[changeMachineState] Post-shutdown verification successful:
              - Machine ID: ${id}
              - DB Status: ${vmStatus.status}
              - Process Alive: ${vmStatus.processAlive}
              - Consistent: ${vmStatus.consistent}
              - Elapsed Time: ${elapsedMs}ms`)
          }
        } catch (verificationError) {
          // Log verification error but don't fail the operation
          // The infinization operation already reported success
          this.debug.debug(`[changeMachineState] Warning: Post-shutdown verification threw error:
            - Machine ID: ${id}
            - Error: ${(verificationError as Error).message}
            - Proceeding with assumed success based on infinization result`)
        }
      }

      // Fetch updated machine for event
      const updatedMachine = await prisma.machine.findUnique({
        where: { id },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })

      // Trigger real-time event for VM state change
      if (updatedMachine) {
        try {
          const eventManager = getEventManager()
          const eventAction = action === 'powerOn'
            ? 'power_on'
            : action === 'shutdown'
              ? 'power_off'
              : action === 'destroy'
                ? 'power_off'
                : action === 'suspend' ? 'suspend' : 'update'

          await eventManager.dispatchEvent('vms', eventAction, updatedMachine, user?.id)
          logger.info(`🎯 Triggered real-time event: vms:${eventAction} for machine ${id}`)
        } catch (eventError) {
          logger.error('Failed to trigger real-time event:', eventError)
          // Don't fail the main operation if event triggering fails
        }
      }

      // Final success logging
      const totalElapsedMs = Date.now() - operationStartTime
      this.debug.debug(`[changeMachineState] Operation completed successfully:
        - Machine ID: ${id}
        - Action: ${action}
        - New Status: ${newStatus}
        - Total Elapsed Time: ${totalElapsedMs}ms`)

      return { success: true, message: `Machine ${newStatus}` }
    } catch (error) {
      // Log the error and return a failure response
      const totalElapsedMs = Date.now() - operationStartTime
      this.debug.debug(`[changeMachineState] Operation failed with exception after ${totalElapsedMs}ms:
        - Machine ID: ${id}
        - Action: ${action}
        - Error: ${(error as Error).message || error}
        - Stack: ${(error as Error).stack || 'N/A'}`)
      return { success: false, message: (error as Error).message || 'Error changing machine state' }
    }
  }

  @Mutation(() => Machine)
  @Can('vm:move', { id: (a) => a.id, scopeVia: 'vm' })
  async moveMachine (
    @Arg('id') id: string,
    @Arg('departmentId') departmentId: string,
    @Ctx() context: InfinibayContext
  ): Promise<Machine> {
    const { prisma, user } = context
    // Check if machine exists
    const machine = await prisma.machine.findUnique({
      where: { id }
    })

    if (!machine) {
      throw new UserInputError('Machine not found')
    }

    // Check if department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!department) {
      throw new UserInputError('Department not found')
    }

    // If same department, just return the machine without changes
    if (machine.departmentId === departmentId) {
      const existingMachine = await prisma.machine.findUnique({
        where: { id },
        include: { configuration: true, department: true, template: true, user: true }
      })
      if (!existingMachine) {
        throw new UserInputError('Machine not found')
      }
      return transformMachine(existingMachine, prisma)
    }

    // Initialize firewall services for VMMoveService
    const ruleService = new FirewallRuleService(prisma)
    const validationService = new FirewallValidationService()
    const infinizationFirewall = new InfinizationFirewallService(prisma)
    await infinizationFirewall.initialize()
    const firewallOrchestration = new FirewallOrchestrationService(
      prisma,
      ruleService,
      validationService,
      infinizationFirewall
    )

    // Use VMMoveService to handle the move with network/firewall hot-swap
    const moveService = new VMMoveService(prisma, firewallOrchestration)
    const result = await moveService.moveVMToDepartment(id, departmentId)

    if (!result.success) {
      throw new UserInputError(`Failed to move machine: ${result.error}`)
    }

    // Fetch updated machine
    const updatedMachine = await prisma.machine.findUnique({
      where: { id },
      include: { configuration: true, department: true, template: true, user: true }
    })

    if (!updatedMachine) {
      throw new UserInputError('Machine not found after move')
    }

    // Trigger real-time event for VM department move
    try {
      const eventManager = getEventManager()
      // Send the full updated machine so clients receive fresh department info without refetch
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      logger.info(`Triggered real-time event: vms:update for machine move ${id} ` +
        `(hotSwap=${result.hotSwapPerformed}, network=${result.networkChanged}, firewall=${result.firewallChanged})`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async restartMachine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: { id } })
    if (!machine) {
      return { success: false, message: 'Machine not found or access denied' }
    }

    // Use VMOperationsService for robust restart
    const vmOpsService = new VMOperationsService(prisma)
    try {
      const result = await vmOpsService.restartMachine(id)

      if (result.success) {
        // Emit WebSocket events
        try {
          const socketService = getSocketService()
          const userId = machine.userId || user?.id
          if (userId) {
            // Emit restarting event
            socketService.sendToUser(userId, 'vm', 'restarting', {
              data: { machineId: id }
            })

            // Emit restarted event (since the operation is complete)
            socketService.sendToUser(userId, 'vm', 'restarted', {
              data: { machineId: id, status: 'running' }
            })

            logger.info(`📡 Emitted vm:restarting and vm:restarted events for machine ${id}`)
          }
        } catch (eventError) {
          logger.error('Failed to emit WebSocket event:', eventError)
        }
      }

      return {
        success: result.success,
        message: result.message || result.error || 'Machine restart initiated'
      }
    } finally {
      await vmOpsService.close()
    }
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async forcePowerOff (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: { id } })
    if (!machine) {
      return { success: false, message: 'Machine not found or access denied' }
    }

    // Use VMOperationsService for immediate force power off
    const vmOpsService = new VMOperationsService(prisma)
    try {
      const result = await vmOpsService.forcePowerOff(id)

      // Emit WebSocket event if successful
      if (result.success) {
        try {
          const socketService = getSocketService()
          const userId = machine.userId || user?.id
          if (userId) {
            socketService.sendToUser(userId, 'vm', 'forced:poweroff', {
              data: { machineId: id, status: 'shutoff' }
            })

            logger.info(`📡 Emitted vm:forced:poweroff event for machine ${id}`)
          }
        } catch (eventError) {
          logger.error('Failed to emit WebSocket event:', eventError)
        }
      }

      return {
        success: result.success,
        message: result.message || result.error || 'Machine forcefully powered off'
      }
    } finally {
      await vmOpsService.close()
    }
  }

  @Mutation(() => SuccessType)
  @Can('vm:power', { id: (a) => a.id, scopeVia: 'vm' })
  async resetMachine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: { id } })
    if (!machine) {
      return { success: false, message: 'Machine not found or access denied' }
    }

    // Use VMOperationsService for hardware reset
    const vmOpsService = new VMOperationsService(prisma)
    try {
      const result = await vmOpsService.resetMachine(id)

      if (result.success) {
        // Emit WebSocket event
        try {
          const socketService = getSocketService()
          const userId = machine.userId || user?.id
          if (userId) {
            socketService.sendToUser(userId, 'vm', 'reset', {
              data: { machineId: id, status: 'running' }
            })

            logger.info(`📡 Emitted vm:reset event for machine ${id}`)
          }
        } catch (eventError) {
          logger.error('Failed to emit WebSocket event:', eventError)
        }
      }

      return {
        success: result.success,
        message: result.message || result.error || 'Machine reset completed'
      }
    } finally {
      await vmOpsService.close()
    }
  }
}
