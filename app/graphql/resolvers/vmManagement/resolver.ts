import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import { InfinibayContext } from '@utils/context'
import { VirtManager } from '@utils/VirtManager'
import {
  ServiceInfo,
  PackageInfo,
  VMSnapshot,
  ServiceActionInput,
  PackageActionInput,
  CreateSnapshotInput,
  CommandResult
} from './types'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'

// Interface for service data returned from InfiniService
interface InfiniServiceData {
  // Common fields
  name?: string
  Name?: string
  display_name?: string
  DisplayName?: string
  description?: string
  Description?: string
  status?: string
  Status?: string
  startup_type?: string
  StartType?: string
  // Capability flags
  can_start?: boolean
  can_stop?: boolean
  can_restart?: boolean
}

// Interface for package data returned from InfiniService
interface InfiniPackageData {
  name?: string
  Name?: string
  version?: string
  Version?: string
  description?: string
  Description?: string
  publisher?: string
  Publisher?: string
  source?: string
  install_date?: string
  size?: number
}

@Resolver()
export class VMManagementResolver {
  constructor (
    private virtManager: VirtManager,
    private virtioSocketWatcher: VirtioSocketWatcherService
  ) {}

  @Query(() => [ServiceInfo])
  @Authorized()
  async listVMServices (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ServiceInfo[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // Use InfiniService to get service list
      const result = await this.virtioSocketWatcher.sendSafeCommand(
        vm.id,
        { action: 'ServiceList' },
        30000
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to list services')
      }

      // Parse the service data from InfiniService response
      const services = (Array.isArray(result.data) ? result.data : []) as InfiniServiceData[]

      return services.map((svc: InfiniServiceData) => ({
        name: svc.name || svc.Name || '',
        displayName: svc.display_name || svc.DisplayName || svc.name || svc.Name || '',
        status: svc.status || svc.Status || '',
        description: svc.description || svc.Description || '',
        canStart: svc.can_start !== undefined ? svc.can_start : (svc.status || svc.Status) !== 'running',
        canStop: svc.can_stop !== undefined ? svc.can_stop : (svc.status || svc.Status) === 'running',
        canRestart: svc.can_restart !== undefined ? svc.can_restart : (svc.status || svc.Status) === 'running',
        startupType: svc.startup_type || svc.StartType || 'unknown'
      }))
    } catch (error) {
      console.error('Error listing VM services:', error)
      throw new UserInputError('Failed to list VM services')
    }
  }

  @Query(() => [PackageInfo])
  @Authorized()
  async listVMPackages (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<PackageInfo[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // Use InfiniService to get package list
      const result = await this.virtioSocketWatcher.sendPackageCommand(
        vm.id,
        'PackageList',
        undefined,
        45000
      )

      if (!result.success) {
        throw new Error(result.error || 'Failed to list packages')
      }

      // Parse the package data from InfiniService response
      const packages = (Array.isArray(result.data) ? result.data : []) as InfiniPackageData[]

      return packages.map((pkg: InfiniPackageData) => ({
        name: pkg.name || pkg.Name || '',
        version: pkg.version || pkg.Version || 'unknown',
        description: pkg.description || pkg.Description || '',
        publisher: pkg.publisher || pkg.Publisher || '',
        installDate: pkg.install_date || '',
        size: pkg.size || 0,
        source: pkg.source || 'unknown'
      }))
    } catch (error) {
      console.error('Error listing VM packages:', error)
      throw new UserInputError('Failed to list VM packages')
    }
  }

  @Query(() => [VMSnapshot])
  @Authorized()
  async listVMSnapshots (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<VMSnapshot[]> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // TODO: Implement listSnapshots in VirtManager
      throw new Error('Snapshot listing not implemented')
      /* Original code - needs implementation
      const snapshots = await this.virtManager.listSnapshots(vm.name)
      return snapshots.map((snapshot: {name: string, description?: string, createdAt: Date, state: string, current: boolean, parent?: string}) => ({
        name: snapshot.name,
        description: snapshot.description || '',
        createdAt: snapshot.createdAt,
        state: snapshot.state,
        current: snapshot.current,
        parent: snapshot.parent || undefined
      }))
      */
    } catch (error) {
      console.error('Error listing VM snapshots:', error)
      throw new UserInputError('Failed to list VM snapshots')
    }
  }

  @Mutation(() => CommandResult)
  @Authorized()
  async controlVMService (
    @Arg('input') input: ServiceActionInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<CommandResult> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // Use InfiniService to control service
      const result = await this.virtioSocketWatcher.sendSafeCommand(
        vm.id,
        {
          action: 'ServiceControl',
          params: {
            service_name: input.serviceName,
            action: input.action
          }
        },
        30000
      )

      return {
        success: result.success,
        output: result.stdout || '',
        error: result.error || result.stderr || '',
        exitCode: result.exit_code || 0
      }
    } catch (error: unknown) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Failed to control service',
        exitCode: 1
      }
    }
  }

  @Mutation(() => CommandResult)
  @Authorized()
  async manageVMPackage (
    @Arg('input') input: PackageActionInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<CommandResult> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // Map action to InfiniService package command
      let packageAction: 'PackageInstall' | 'PackageRemove' | 'PackageUpdate'

      switch (input.action) {
      case 'install':
        packageAction = 'PackageInstall'
        break
      case 'remove':
        packageAction = 'PackageRemove'
        break
      case 'update':
        packageAction = 'PackageUpdate'
        break
      default:
        throw new UserInputError('Invalid package action')
      }

      // Use InfiniService to manage package
      const result = await this.virtioSocketWatcher.sendPackageCommand(
        vm.id,
        packageAction,
        input.packageName,
        60000 // 60 seconds timeout for package operations
      )

      return {
        success: result.success,
        output: result.stdout || '',
        error: result.error || result.stderr || '',
        exitCode: result.exit_code || 0
      }
    } catch (error: unknown) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Failed to manage package',
        exitCode: 1
      }
    }
  }

  @Mutation(() => VMSnapshot)
  @Authorized()
  async createVMSnapshot (
    @Arg('input') input: CreateSnapshotInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<VMSnapshot> {
    const vm = await prisma.machine.findUnique({
      where: { id: input.vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // TODO: Implement createSnapshot in VirtManager
      throw new Error('Snapshot creation not implemented')
      /* Original code - needs implementation
      const snapshot = await this.virtManager.createSnapshot(
        vm.name,
        input.name,
        input.description
      )

      return {
        name: snapshot.name,
        description: snapshot.description || '',
        createdAt: new Date(),
        state: 'disk-snapshot',
        current: true,
        parent: undefined
      }
      */
    } catch (error: unknown) {
      console.error('Error creating VM snapshot:', error)
      throw new UserInputError(error instanceof Error ? error.message : 'Failed to create snapshot')
    }
  }

  @Mutation(() => Boolean)
  @Authorized()
  async revertVMSnapshot (
    @Arg('vmId', () => ID) vmId: string,
    @Arg('snapshotName') snapshotName: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // TODO: Implement revertSnapshot in VirtManager
      throw new Error('Snapshot revert not implemented')
      /* Original code - needs implementation
      await this.virtManager.revertSnapshot(vm.name, snapshotName)
      return true
      */
    } catch (error: unknown) {
      console.error('Error reverting VM snapshot:', error)
      throw new UserInputError(error instanceof Error ? error.message : 'Failed to revert snapshot')
    }
  }

  @Mutation(() => Boolean)
  @Authorized()
  async deleteVMSnapshot (
    @Arg('vmId', () => ID) vmId: string,
    @Arg('snapshotName') snapshotName: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    const vm = await prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!vm) {
      throw new UserInputError('VM not found')
    }

    try {
      // TODO: Implement deleteSnapshot in VirtManager
      throw new Error('Snapshot deletion not implemented')
      /* Original code - needs implementation
      await this.virtManager.deleteSnapshot(vm.name, snapshotName)
      return true
      */
    } catch (error: unknown) {
      console.error('Error deleting VM snapshot:', error)
      throw new UserInputError(error instanceof Error ? error.message : 'Failed to delete snapshot')
    }
  }
}
