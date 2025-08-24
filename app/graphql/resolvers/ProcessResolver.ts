import { Resolver, Query, Mutation, Arg, Int, Ctx } from 'type-graphql'
import { PrismaClient } from '@prisma/client'
import { ProcessManager, InternalProcessInfo, InternalProcessControlResult, ProcessSortBy as InternalProcessSortBy } from '@services/ProcessManager'
import { ProcessInfo, ProcessControlResult, ProcessSortBy } from '../types/ProcessType'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import Debug from 'debug'

const debug = Debug('infinibay:process-resolver')

interface Context {
  prisma: PrismaClient
  virtioSocketWatcher: VirtioSocketWatcherService
}

@Resolver()
export class ProcessResolver {
  private processManager?: ProcessManager

  constructor() {
    // ProcessManager is created on demand with context
  }

  /**
   * Get or create ProcessManager instance
   */
  private getProcessManager(ctx: Context): ProcessManager {
    if (!this.processManager) {
      this.processManager = new ProcessManager(ctx.prisma, ctx.virtioSocketWatcher)
    }
    return this.processManager
  }

  /**
   * List all processes running on a VM
   */
  @Query(() => [ProcessInfo])
  async listProcesses(
    @Arg('machineId') machineId: string,
    @Arg('limit', () => Int, { nullable: true }) limit?: number,
    @Ctx() ctx?: Context
  ): Promise<ProcessInfo[]> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug( `Listing processes for machine ${machineId}`)
      
      const manager = this.getProcessManager(ctx)
      const internalProcesses = await manager.listProcesses(machineId, limit)
      
      // Map internal types to GraphQL types
      return this.mapToGraphQLProcesses(internalProcesses)
    } catch (error) {
      debug( `Failed to list processes: ${error}`)
      throw new Error(`Failed to list processes: ${error}`)
    }
  }

  /**
   * Get top processes by CPU or memory usage
   */
  @Query(() => [ProcessInfo])
  async getTopProcesses(
    @Arg('machineId') machineId: string,
    @Arg('limit', () => Int, { defaultValue: 10 }) limit: number,
    @Arg('sortBy', () => ProcessSortBy, { defaultValue: ProcessSortBy.CPU }) sortBy: ProcessSortBy,
    @Ctx() ctx?: Context
  ): Promise<ProcessInfo[]> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug( `Getting top ${limit} processes for machine ${machineId} sorted by ${sortBy}`)
      
      const manager = this.getProcessManager(ctx)
      
      // Convert GraphQL enum to internal enum
      const internalSortBy = this.mapSortBy(sortBy)
      const internalProcesses = await manager.getTopProcesses(machineId, limit, internalSortBy)
      
      // Map internal types to GraphQL types
      return this.mapToGraphQLProcesses(internalProcesses)
    } catch (error) {
      debug( `Failed to get top processes: ${error}`)
      throw new Error(`Failed to get top processes: ${error}`)
    }
  }

  /**
   * Kill a process on a VM
   */
  @Mutation(() => ProcessControlResult)
  async killProcess(
    @Arg('machineId') machineId: string,
    @Arg('pid', () => Int) pid: number,
    @Arg('force', { defaultValue: false }) force: boolean,
    @Ctx() ctx?: Context
  ): Promise<ProcessControlResult> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug( `Killing process ${pid} on machine ${machineId} (force: ${force})`)
      
      const manager = this.getProcessManager(ctx)
      const internalResult = await manager.killProcess(machineId, pid, force)
      
      // Map internal type to GraphQL type
      return this.mapToGraphQLControlResult(internalResult)
    } catch (error) {
      debug( `Failed to kill process: ${error}`)
      return {
        success: false,
        message: `Failed to kill process: ${error}`,
        pid,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Kill multiple processes on a VM
   */
  @Mutation(() => [ProcessControlResult])
  async killProcesses(
    @Arg('machineId') machineId: string,
    @Arg('pids', () => [Int]) pids: number[],
    @Arg('force', { defaultValue: false }) force: boolean,
    @Ctx() ctx?: Context
  ): Promise<ProcessControlResult[]> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug( `Killing ${pids.length} processes on machine ${machineId} (force: ${force})`)
      
      const manager = this.getProcessManager(ctx)
      const internalResults = await manager.killProcesses(machineId, pids, force)
      
      // Map internal types to GraphQL types
      return internalResults.map(result => this.mapToGraphQLControlResult(result))
    } catch (error) {
      debug( `Failed to kill processes: ${error}`)
      // Return error results for all PIDs
      return pids.map(pid => ({
        success: false,
        message: `Failed to kill process: ${error}`,
        pid,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  // Private mapping methods

  /**
   * Map internal process info to GraphQL type
   */
  private mapToGraphQLProcesses(internalProcesses: InternalProcessInfo[]): ProcessInfo[] {
    return internalProcesses.map(process => ({
      pid: process.pid,
      name: process.name,
      cpuUsage: process.cpuUsage,
      memoryKb: process.memoryKb,
      status: process.status,
      commandLine: process.commandLine,
      user: process.user,
      startTime: process.startTime
    }))
  }

  /**
   * Map internal control result to GraphQL type
   */
  private mapToGraphQLControlResult(internalResult: InternalProcessControlResult): ProcessControlResult {
    return {
      success: internalResult.success,
      message: internalResult.message,
      pid: internalResult.pid,
      processName: internalResult.processName,
      error: internalResult.error
    }
  }

  /**
   * Map GraphQL sort enum to internal enum
   */
  private mapSortBy(graphqlSortBy: ProcessSortBy): InternalProcessSortBy {
    switch (graphqlSortBy) {
      case ProcessSortBy.CPU:
        return InternalProcessSortBy.CPU
      case ProcessSortBy.MEMORY:
        return InternalProcessSortBy.MEMORY
      case ProcessSortBy.PID:
        return InternalProcessSortBy.PID
      case ProcessSortBy.NAME:
        return InternalProcessSortBy.NAME
      default:
        return InternalProcessSortBy.CPU
    }
  }
}