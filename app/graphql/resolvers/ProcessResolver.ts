import { Resolver, Mutation, Arg, Int, Ctx } from 'type-graphql'
import { PrismaClient } from '@prisma/client'
import { ProcessManager, InternalProcessControlResult } from '@services/ProcessManager'
import { ProcessControlResult } from '../types/ProcessType'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { getEventManager } from '@services/EventManager'
import { getSocketService } from '@services/SocketService'
import Debug from 'debug'

const debug = Debug('infinibay:process-resolver')

interface Context {
  prisma: PrismaClient
  virtioSocketWatcher: VirtioSocketWatcherService
  user?: { id: string; role: string }
}

@Resolver()
export class ProcessResolver {
  private processManager?: ProcessManager

  constructor () {
    // ProcessManager is created on demand with context
  }

  /**
   * Get or create ProcessManager instance
   */
  private getProcessManager (ctx: Context): ProcessManager {
    if (!this.processManager) {
      this.processManager = new ProcessManager(ctx.prisma, ctx.virtioSocketWatcher)
    }
    return this.processManager
  }

  /**
   * Kill a process on a VM
   */
  @Mutation(() => ProcessControlResult)
  async killProcess (
    @Arg('machineId') machineId: string,
    @Arg('pid', () => Int) pid: number,
    @Arg('force', { defaultValue: false }) force: boolean,
    @Ctx() ctx?: Context
  ): Promise<ProcessControlResult> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug(`Killing process ${pid} on machine ${machineId} (force: ${force})`)

      const manager = this.getProcessManager(ctx)
      const internalResult = await manager.killProcess(machineId, pid, force)

      // Emit WebSocket event if successful
      if (internalResult.success && ctx.user) {
        try {
          const socketService = getSocketService()
          const machine = await ctx.prisma.machine.findUnique({
            where: { id: machineId },
            select: { userId: true }
          })

          if (machine?.userId) {
            socketService.sendToUser(machine.userId, 'vm', 'process:killed', {
              data: {
                machineId,
                pid,
                processName: internalResult.processName,
                force
              }
            })
            debug(`📡 Emitted vm:process:killed event for machine ${machineId}`)
          }
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      // Map internal type to GraphQL type
      return this.mapToGraphQLControlResult(internalResult)
    } catch (error) {
      debug(`Failed to kill process: ${error}`)
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
  async killProcesses (
    @Arg('machineId') machineId: string,
    @Arg('pids', () => [Int]) pids: number[],
    @Arg('force', { defaultValue: false }) force: boolean,
    @Ctx() ctx?: Context
  ): Promise<ProcessControlResult[]> {
    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      debug(`Killing ${pids.length} processes on machine ${machineId} (force: ${force})`)

      const manager = this.getProcessManager(ctx)
      const internalResults = await manager.killProcesses(machineId, pids, force)

      // Emit WebSocket event for successful kills
      const successfulKills = internalResults.filter(r => r.success)
      if (successfulKills.length > 0 && ctx.user) {
        try {
          const socketService = getSocketService()
          const machine = await ctx.prisma.machine.findUnique({
            where: { id: machineId },
            select: { userId: true }
          })

          if (machine?.userId) {
            socketService.sendToUser(machine.userId, 'vm', 'processes:killed', {
              data: {
                machineId,
                processes: successfulKills.map(r => ({
                  pid: r.pid,
                  processName: r.processName
                })),
                force
              }
            })
            debug(`📡 Emitted vm:processes:killed event for ${successfulKills.length} processes on machine ${machineId}`)
          }
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      // Map internal types to GraphQL types
      return internalResults.map(result => this.mapToGraphQLControlResult(result))
    } catch (error) {
      debug(`Failed to kill processes: ${error}`)
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
   * Map internal control result to GraphQL type
   */
  private mapToGraphQLControlResult (internalResult: InternalProcessControlResult): ProcessControlResult {
    return {
      success: internalResult.success,
      message: internalResult.message,
      pid: internalResult.pid,
      processName: internalResult.processName,
      error: internalResult.error
    }
  }
}
