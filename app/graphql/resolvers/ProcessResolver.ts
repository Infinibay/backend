import logger from '@main/logger'
import { Resolver, Mutation, Arg, Int, Ctx } from 'type-graphql'
import { ProcessManager, InternalProcessControlResult } from '@services/ProcessManager'
import { ProcessControlResult } from '../types/ProcessType'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { getSocketService } from '@services/SocketService'
import { Can } from '@main/permissions'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'

type Context = InfinibayContext & {
  virtioSocketWatcher: VirtioSocketWatcherService
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
  @Can('vmProcess:kill', { id: (a) => a.machineId, scopeVia: 'vm' })
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

      logger.debug(`Killing process ${pid} on machine ${machineId} (force: ${force})`)

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
            logger.debug(`📡 Emitted vm:process:killed event for machine ${machineId}`)
          }
        } catch (eventError) {
          logger.debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      // Map internal type to GraphQL type
      return this.mapToGraphQLControlResult(internalResult)
    } catch (error) {
      logger.debug(`Failed to kill process: ${error}`)
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
  @Can('vmProcess:kill', { id: (a) => a.machineId, scopeVia: 'vm' })
  async killProcesses (
    @Arg('machineId') machineId: string,
    @Arg('pids', () => [Int]) pids: number[],
    @Arg('force', { defaultValue: false }) force: boolean,
    @Ctx() ctx?: Context
  ): Promise<ProcessControlResult[]> {
    // Bound the fan-out: killProcesses processes each pid sequentially with a
    // per-pid DB + VM-status check and a 30s socket timeout, so an unbounded
    // pids array is an amplification-DoS vector. Reject before doing any work
    // and dedupe so we never process the same pid twice.
    const uniquePids = [...new Set(pids)]
    if (uniquePids.length === 0 || uniquePids.length > 100) {
      throw new UserInputError('pids must contain between 1 and 100 unique process IDs')
    }

    try {
      if (!ctx) {
        throw new Error('Context not available')
      }

      logger.debug(`Killing ${uniquePids.length} processes on machine ${machineId} (force: ${force})`)

      const manager = this.getProcessManager(ctx)
      const internalResults = await manager.killProcesses(machineId, uniquePids, force)

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
            logger.debug(`📡 Emitted vm:processes:killed event for ${successfulKills.length} processes on machine ${machineId}`)
          }
        } catch (eventError) {
          logger.debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      // Map internal types to GraphQL types
      return internalResults.map(result => this.mapToGraphQLControlResult(result))
    } catch (error) {
      logger.debug(`Failed to kill processes: ${error}`)
      // Return error results for all PIDs
      return uniquePids.map(pid => ({
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
