import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import {
  Machine,
  MachineOrderBy,
  CreateMachineInputType,
  GraphicConfigurationType,
  SuccessType,
  MachineStatus,
  CommandExecutionResponseType,
  UpdateMachineHardwareInput
} from './type'
import { UserType } from '../user/type'
import { MachineTemplateType } from '../machine_template/type'
import { DepartmentType } from '../department/type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@main/utils/context'
import { GraphicPortService } from '@utils/VirtManager/graphicPortService'
import { Connection, Machine as VirtualMachine, Error, NwFilter } from 'libvirt-node'
import { Debugger } from '@utils/debug'
import { MachineLifecycleService } from '../../../services/machineLifecycleService'
import { getEventManager } from '../../../services/EventManager'
import { VMOperationsService } from '../../../services/VMOperationsService'
import { getSocketService } from '../../../services/SocketService'
import { Machine as PrismaMachine, User as PrismaUser, MachineTemplate as PrismaMachineTemplate, Department as PrismaDepartment, MachineConfiguration, PrismaClient } from '@prisma/client'

type MachineWithRelations = PrismaMachine & {
  configuration?: MachineConfiguration | null
  department?: PrismaDepartment | null
  template?: PrismaMachineTemplate | null
  user?: PrismaUser | null
}

async function transformMachine (prismaMachine: MachineWithRelations, prisma: PrismaClient): Promise<Machine> {
  // TODO: fix n+1 problem
  const user = prismaMachine.userId ? await prisma.user.findUnique({ where: { id: prismaMachine.userId } }) : null
  const template = prismaMachine.templateId ? await prisma.machineTemplate.findUnique({ where: { id: prismaMachine.templateId } }) : null
  const department = prismaMachine.departmentId ? await prisma.department.findUnique({ where: { id: prismaMachine.departmentId } }) : null
  const graphicHost = (prismaMachine.configuration?.graphicHost) || process.env.GRAPHIC_HOST || 'localhost'
  let graphicPort
  // Only try to get the graphic port if the VM is running
  if (prismaMachine.status === 'running') {
    try {
      const protocol = prismaMachine.configuration?.graphicProtocol || 'vnc'
      graphicPort = await new GraphicPortService().getGraphicPort(prismaMachine.internalName, protocol)
    } catch (e) {
      console.log(`Could not get graphic port for VM ${prismaMachine.internalName}:`, e)
    }
  }

  return {
    ...prismaMachine,
    userId: prismaMachine.userId || null,
    departmentId: prismaMachine.departmentId || null, // Explicitly include departmentId
    templateId: prismaMachine.templateId || null,
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
        id: template.id,
        name: template.name,
        description: template.description,
        cores: template.cores,
        ram: template.ram,
        storage: template.storage,
        createdAt: template.createdAt
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
    configuration: prismaMachine.configuration
      ? {
        graphic: prismaMachine.configuration.graphicProtocol + '://' + prismaMachine.configuration.graphicPassword + '@' + graphicHost + ':' + graphicPort
      }
      : null,
    status: prismaMachine.status as MachineStatus
  }
}

@Resolver()
export class MachineQueries {
  private debug = new Debugger('machine-queries')

  @Query(() => Machine, { nullable: true })
  @Authorized('USER')
  async machine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine | null> {
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: user?.id }
    const prismaMachine = await prisma.machine.findFirst({
      where: whereClause,
      include: { configuration: true, department: true, template: true, user: true }
    })
    return prismaMachine ? await transformMachine(prismaMachine, prisma) : null
  }

  @Query(() => [Machine])
  @Authorized('USER')
  async machines (
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
    @Arg('orderBy', { nullable: true }) orderBy: MachineOrderBy,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine[]> {
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? {} : { userId: user?.id }
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
  @Authorized('USER')
  async graphicConnection (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<GraphicConfigurationType | null> {
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: user?.id }
    const machine = await prisma.machine.findFirst({
      where: whereClause,
      include: { configuration: true, department: true, template: true, user: true }
    })

    if (!machine || !machine.configuration) return null

    const port = await new GraphicPortService().getGraphicPort(machine.internalName, machine.configuration.graphicProtocol || 'vnc')
    return {
      link: `${machine.configuration.graphicProtocol}://${machine.configuration.graphicHost || process.env.GRAPHIC_HOST || 'localhost'}:${port}`,
      password: machine.configuration.graphicPassword || '',
      protocol: machine.configuration.graphicProtocol || 'vnc'
    }
  }
}

@Resolver()
export class MachineMutations {
  private debug = new Debugger('machine-mutations')

  @Mutation(() => Machine)
  @Authorized('ADMIN')
  async createMachine (
    @Arg('input') input: CreateMachineInputType,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine> {
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const newMachine = await lifecycleService.createMachine(input)

    // Trigger real-time event for VM creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'create', newMachine, user?.id)
      console.log(`🎯 Triggered real-time event: vms:create for machine ${newMachine.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    // Transform the machine to include all necessary fields
    return transformMachine(newMachine, prisma)
  }

  @Mutation(() => Machine)
  @Authorized('ADMIN')
  async updateMachineHardware (
    @Arg('input') input: UpdateMachineHardwareInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine> {
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const updatedMachine = await lifecycleService.updateMachineHardware(input)

    // Trigger real-time event for VM hardware update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      console.log(`🎯 Triggered real-time event: vms:update for machine ${input.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => SuccessType)
  @Authorized('USER')
  async powerOn (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'powerOn', 'running')
  }

  @Mutation(() => SuccessType)
  @Authorized('USER')
  async powerOff (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'shutdown', 'off')
  }

  @Mutation(() => SuccessType)
  @Authorized('USER')
  async suspend (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    return this.changeMachineState(id, prisma, user, 'suspend', 'suspended')
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
  @Authorized('USER')
  async destroyMachine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    const lifecycleService = new MachineLifecycleService(prisma, user)
    const result = await lifecycleService.destroyMachine(id)

    // Trigger real-time event for VM deletion if successful
    if (result.success) {
      try {
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'delete', { id }, user?.id)
        console.log(`🎯 Triggered real-time event: vms:delete for machine ${id}`)
      } catch (eventError) {
        console.error('Failed to trigger real-time event:', eventError)
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
  @Authorized('ADMIN')
  async executeCommand (
    @Arg('id') id: string,
    @Arg('command') command: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<CommandExecutionResponseType> {
    let libvirtConnection: Connection | null = null
    try {
      // Retrieve the machine from the database
      const machine = await prisma.machine.findFirst({ where: { id } })
      if (!machine) {
        return { success: false, message: 'Machine not found' }
      }

      // Establish connection to libvirt
      libvirtConnection = Connection.open('qemu:///system')
      if (!libvirtConnection) {
        throw new UserInputError('Libvirt not connected')
      }

      // Look up the virtual machine (domain) in libvirt
      const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName)
      if (!domain) {
        throw new UserInputError(`Machine ${machine.internalName} not found in libvirt`)
      }
      const jsonCommand = {
        execute: command
      }

      // Execute the command inside the VM
      // TODO: qemuAgentCommand is not yet implemented in libvirt-node
      // const result = await domain.qemuAgentCommand(JSON.stringify(jsonCommand), 0, 0)
      // if (!result) {
      //   throw new UserInputError(`Error executing command: ${command}`)
      // }

      // return { success: true, message: 'Command executed successfully', response: result }

      // Temporary: Return not implemented
      return { success: false, message: 'QEMU Agent command execution is not yet implemented in libvirt-node' }
    } catch (error) {
      // Log the error and return a failure response
      this.debug.log(`Error executing command: ${error}`)
      return { success: false, message: (error as Error).message || 'Error executing command' }
    } finally {
      // Ensure the libvirt connection is closed, even if an error occurred
      if (libvirtConnection) {
        libvirtConnection.close()
      }
    }
  }

  /**
   * Changes the state of a virtual machine.
   *
   * @param id - The ID of the machine to change state.
   * @param prisma - The Prisma client for database operations.
   * @param user - The user requesting the state change.
   * @param action - The action to perform: 'powerOn', 'destroy', or 'suspend'.
   * @param newStatus - The new status to set: 'running', 'off', or 'suspended'.
   * @returns A SuccessType object indicating the result of the operation.
   */
  private async changeMachineState (
    id: string,
    prisma: PrismaClient,
    user: PrismaUser | null,
    action: 'powerOn' | 'destroy' | 'shutdown' | 'suspend',
    newStatus: 'running' | 'off' | 'suspended'
  ): Promise<SuccessType> {
    let libvirtConnection: Connection | null = null
    try {
      // Check if the user is an admin or the owner of the machine
      const isAdmin = user?.role === 'ADMIN'
      const whereClause = isAdmin ? { id } : { id, userId: user?.id }

      // Retrieve the machine from the database
      const machine = await prisma.machine.findFirst({ where: whereClause })
      if (!machine) {
        return { success: false, message: 'Machine not found' }
      }

      // Establish connection to libvirt
      libvirtConnection = Connection.open('qemu:///system')
      if (!libvirtConnection) {
        throw new UserInputError('Libvirt not connected')
      }

      // Look up the virtual machine (domain) in libvirt
      const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName)
      if (!domain) {
        throw new UserInputError(`Machine ${machine.internalName} not found in libvirt`)
      }

      // Perform the requested action on the domain
      let result
      switch (action) {
      case 'powerOn':
        result = await domain.create() || 0
        break
      case 'destroy':
        try {
          result = await domain.destroy() || 0
        } catch (error) {
          console.log(error)
          result = 0
          // result = await domain.destroy(libvirt.VIR_DOMAIN_DESTROY_GRACEFUL);
        }
        break
      case 'shutdown':
        result = await this.performShutdownWithTimeout(domain, machine.internalName)
        break
      case 'suspend':
        result = await domain.suspend() || 0
        break
      default:
        throw new UserInputError(`Invalid action: ${action}`)
      }

      // Check if the action was successful
      if (result !== 0) {
        throw new UserInputError(`Error performing ${action} on machine ${result}`)
      }

      // Update the machine's status in the database
      const updatedMachine = await prisma.machine.update({
        where: { id },
        data: { status: newStatus },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })

      // Trigger real-time event for VM state change
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
        console.log(`🎯 Triggered real-time event: vms:${eventAction} for machine ${id}`)
      } catch (eventError) {
        console.error('Failed to trigger real-time event:', eventError)
        // Don't fail the main operation if event triggering fails
      }

      return { success: true, message: `Machine ${newStatus}` }
    } catch (error) {
      // Log the error and return a failure response
      this.debug.log(`Error changing machine state: ${error}`)
      return { success: false, message: (error as Error).message || 'Error changing machine state' }
    } finally {
      // Ensure the libvirt connection is closed, even if an error occurred
      if (libvirtConnection) {
        libvirtConnection.close()
      }
    }
  }

  /**
   * Performs a shutdown operation with timeout and fallback mechanisms.
   *
   * @param domain - The libvirt domain to shutdown
   * @param machineName - The name of the machine for logging
   * @returns Promise<number> - 0 on success, non-zero on failure
   */
  private async performShutdownWithTimeout (domain: VirtualMachine, machineName: string): Promise<number> {
    const SHUTDOWN_TIMEOUT = 30000 // 30 seconds timeout
    const FORCE_DESTROY_TIMEOUT = 10000 // Additional 10 seconds for force destroy

    this.debug.log(`Starting graceful shutdown for machine: ${machineName}`)

    try {
      // Try graceful shutdown with timeout
      const shutdownPromise = new Promise<number>((resolve, reject) => {
        // Use setImmediate to ensure the operation doesn't block the event loop
        setImmediate(() => {
          try {
            this.debug.log(`Calling domain.shutdown() for machine: ${machineName}`)
            const result = domain.shutdown()
            this.debug.log(`domain.shutdown() returned: ${result} for machine: ${machineName}`)

            if (result !== null && result !== undefined) {
              resolve(0) // Success
            } else {
              reject(new UserInputError('Shutdown returned null/undefined'))
            }
          } catch (err) {
            this.debug.log(`domain.shutdown() threw error for machine ${machineName}: ${err}`)
            reject(err)
          }
        })
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          this.debug.log(`Shutdown timeout reached for machine: ${machineName}`)
          reject(new UserInputError('Shutdown timeout'))
        }, SHUTDOWN_TIMEOUT)
      })

      const result = await Promise.race([shutdownPromise, timeoutPromise])
      this.debug.log(`Graceful shutdown successful for machine: ${machineName}`)
      return result
    } catch (error) {
      this.debug.log(`Graceful shutdown failed for machine ${machineName}: ${error}`)

      // If graceful shutdown fails or times out, try force destroy
      try {
        this.debug.log(`Attempting force destroy for machine: ${machineName}`)
        const destroyPromise = new Promise<number>((resolve, reject) => {
          setImmediate(() => {
            try {
              this.debug.log(`Calling domain.destroy() for machine: ${machineName}`)
              const result = domain.destroy()
              this.debug.log(`domain.destroy() returned: ${result} for machine: ${machineName}`)

              if (result !== null && result !== undefined) {
                resolve(0) // Success
              } else {
                reject(new UserInputError('Force destroy returned null/undefined'))
              }
            } catch (err) {
              this.debug.log(`domain.destroy() threw error for machine ${machineName}: ${err}`)
              reject(err)
            }
          })
        })

        const forceTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            this.debug.log(`Force destroy timeout reached for machine: ${machineName}`)
            reject(new UserInputError('Force destroy timeout'))
          }, FORCE_DESTROY_TIMEOUT)
        })

        const destroyResult = await Promise.race([destroyPromise, forceTimeoutPromise])
        this.debug.log(`Force destroy successful for machine: ${machineName}`)
        return destroyResult
      } catch (destroyError) {
        this.debug.log(`Force destroy also failed for machine ${machineName}: ${destroyError}`)
        throw new UserInputError(`Failed to shutdown machine ${machineName}: graceful shutdown and force destroy both failed`)
      }
    }
  }

  @Mutation(() => Machine)
  @Authorized('ADMIN')
  async moveMachine (
    @Arg('id') id: string,
    @Arg('departmentId') departmentId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine> {
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

    // Update machine's department
    const updatedMachine = await prisma.machine.update({
      where: { id },
      data: {
        departmentId
      },
      include: { configuration: true, department: true, template: true, user: true }
    })

    // Trigger real-time event for VM department move
    try {
      const eventManager = getEventManager()
      // Send the full updated machine so clients receive fresh department info without refetch
      await eventManager.dispatchEvent('vms', 'update', updatedMachine, user?.id)
      console.log(`🎯 Triggered real-time event: vms:update for machine move ${id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return transformMachine(updatedMachine, prisma)
  }

  @Mutation(() => SuccessType)
  @Authorized('USER')
  async restartMachine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Check if the user is an admin or the owner of the machine
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: user?.id }

    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: whereClause })
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

            console.log(`📡 Emitted vm:restarting and vm:restarted events for machine ${id}`)
          }
        } catch (eventError) {
          console.error('Failed to emit WebSocket event:', eventError)
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
  @Authorized('USER')
  async forcePowerOff (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Check if the user is an admin or the owner of the machine
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: user?.id }

    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: whereClause })
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

            console.log(`📡 Emitted vm:forced:poweroff event for machine ${id}`)
          }
        } catch (eventError) {
          console.error('Failed to emit WebSocket event:', eventError)
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
  @Authorized('USER')
  async resetMachine (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<SuccessType> {
    // Check if the user is an admin or the owner of the machine
    const isAdmin = user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: user?.id }

    // Retrieve the machine from the database
    const machine = await prisma.machine.findFirst({ where: whereClause })
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

            console.log(`📡 Emitted vm:reset event for machine ${id}`)
          }
        } catch (eventError) {
          console.error('Failed to emit WebSocket event:', eventError)
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
