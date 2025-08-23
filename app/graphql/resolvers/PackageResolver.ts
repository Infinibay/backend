import { Resolver, Query, Mutation, Arg, Ctx, Authorized, ID } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { 
  DirectPackageManager, 
  getDirectPackageManager,
  InternalPackageInfo,
  InternalPackageManagementResult 
} from '@services/DirectPackageManager'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import {
  PackageInfo,
  PackageManagementInput,
  PackageManagementResult,
  CommandResult
} from '../types/PackageType'

@Resolver()
export class PackageResolver {
  private getPackageManager(ctx: InfinibayContext): DirectPackageManager {
    // Get the singleton instance of VirtioSocketWatcherService
    const virtioService = getVirtioSocketWatcherService()
    return getDirectPackageManager(ctx.prisma, virtioService)
  }

  /**
   * Maps internal package info to GraphQL type
   */
  private mapToGraphQLPackageInfo(internal: InternalPackageInfo): PackageInfo {
    const packageInfo = new PackageInfo()
    packageInfo.name = internal.name
    packageInfo.version = internal.version
    packageInfo.description = internal.description
    packageInfo.installed = internal.installed
    packageInfo.publisher = internal.publisher
    packageInfo.source = internal.source
    return packageInfo
  }

  /**
   * Maps internal package management result to GraphQL type
   */
  private mapToGraphQLResult(internal: InternalPackageManagementResult): PackageManagementResult {
    const result = new PackageManagementResult()
    result.success = internal.success
    result.message = internal.message
    result.stdout = internal.stdout
    result.stderr = internal.stderr
    result.error = internal.error
    if (internal.packages) {
      result.packages = internal.packages.map(pkg => this.mapToGraphQLPackageInfo(pkg))
    }
    return result
  }

  @Query(() => [PackageInfo], { 
    description: 'List all installed packages on a virtual machine' 
  })
  @Authorized('USER')
  async listInstalledPackages(
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageInfo[]> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const packageManager = this.getPackageManager(ctx)
      const internalPackages = await packageManager.listPackages(machineId)
      // Map internal types to GraphQL types
      return internalPackages.map(pkg => this.mapToGraphQLPackageInfo(pkg))
    } catch (error) {
      console.error('Error listing packages:', error)
      throw error
    }
  }

  @Query(() => [PackageInfo], { 
    description: 'Search for available packages on a virtual machine' 
  })
  @Authorized('USER')
  async searchPackages(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('query', () => String) query: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageInfo[]> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const packageManager = this.getPackageManager(ctx)
      const internalPackages = await packageManager.searchPackages(machineId, query)
      // Map internal types to GraphQL types
      return internalPackages.map(pkg => this.mapToGraphQLPackageInfo(pkg))
    } catch (error) {
      console.error('Error searching packages:', error)
      throw error
    }
  }

  @Mutation(() => PackageManagementResult, { 
    description: 'Install, remove, or update a package on a virtual machine' 
  })
  @Authorized('USER')
  async managePackage(
    @Arg('input') input: PackageManagementInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageManagementResult> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { id: true, userId: true, name: true }
      })

      if (!machine) {
        return {
          success: false,
          message: 'Machine not found',
          error: 'Machine not found'
        }
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        return {
          success: false,
          message: 'Access denied',
          error: 'You do not have permission to manage packages on this machine'
        }
      }

      // Log the action for audit purposes
      console.log(`User ${ctx.user?.email} is performing ${input.action} on package ${input.packageName} for machine ${machine.name}`)

      const packageManager = this.getPackageManager(ctx)
      const internalResult = await packageManager.managePackage(
        input.machineId,
        input.packageName,
        input.action
      )
      // Map internal type to GraphQL type
      return this.mapToGraphQLResult(internalResult)
    } catch (error) {
      console.error('Error managing package:', error)
      return {
        success: false,
        message: 'Failed to manage package',
        error: String(error)
      }
    }
  }

  @Mutation(() => CommandResult, { 
    description: 'Install a package on a virtual machine (legacy compatibility)' 
  })
  @Authorized('USER')
  async installPackage(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('packageName', () => String) packageName: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<CommandResult> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          error: 'Machine not found'
        }
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        return {
          success: false,
          error: 'Access denied to this machine'
        }
      }

      const packageManager = this.getPackageManager(ctx)
      const internalResult = await packageManager.installPackage(machineId, packageName)
      
      // Map internal result to GraphQL CommandResult type
      const result = new CommandResult()
      result.success = internalResult.success
      result.output = internalResult.message
      result.stdout = internalResult.stdout
      result.stderr = internalResult.stderr
      result.error = internalResult.error
      return result
    } catch (error) {
      console.error('Error installing package:', error)
      return {
        success: false,
        error: String(error)
      }
    }
  }

  @Mutation(() => CommandResult, { 
    description: 'Remove a package from a virtual machine (legacy compatibility)' 
  })
  @Authorized('USER')
  async removePackage(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('packageName', () => String) packageName: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<CommandResult> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          error: 'Machine not found'
        }
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        return {
          success: false,
          error: 'Access denied to this machine'
        }
      }

      const packageManager = this.getPackageManager(ctx)
      const internalResult = await packageManager.removePackage(machineId, packageName)
      
      // Map internal result to GraphQL CommandResult type
      const result = new CommandResult()
      result.success = internalResult.success
      result.output = internalResult.message
      result.stdout = internalResult.stdout
      result.stderr = internalResult.stderr
      result.error = internalResult.error
      return result
    } catch (error) {
      console.error('Error removing package:', error)
      return {
        success: false,
        error: String(error)
      }
    }
  }

  @Mutation(() => CommandResult, { 
    description: 'Update a package on a virtual machine (legacy compatibility)' 
  })
  @Authorized('USER')
  async updatePackage(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('packageName', () => String) packageName: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<CommandResult> {
    try {
      // Check if user has access to this machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          error: 'Machine not found'
        }
      }

      // Check permissions
      const isAdmin = ctx.user?.role === 'ADMIN'
      const isOwner = machine.userId === ctx.user?.id
      
      if (!isAdmin && !isOwner) {
        return {
          success: false,
          error: 'Access denied to this machine'
        }
      }

      const packageManager = this.getPackageManager(ctx)
      const internalResult = await packageManager.updatePackage(machineId, packageName)
      
      // Map internal result to GraphQL CommandResult type
      const result = new CommandResult()
      result.success = internalResult.success
      result.output = internalResult.message
      result.stdout = internalResult.stdout
      result.stderr = internalResult.stderr
      result.error = internalResult.error
      return result
    } catch (error) {
      console.error('Error updating package:', error)
      return {
        success: false,
        error: String(error)
      }
    }
  }
}