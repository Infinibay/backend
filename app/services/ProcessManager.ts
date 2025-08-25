import { PrismaClient, Machine } from '@prisma/client'
import { VirtioSocketWatcherService, SafeCommandType, CommandResponse } from './VirtioSocketWatcherService'
import { Machine as VirtualMachine } from 'libvirt-node'
import { getLibvirtConnection } from '@utils/libvirt'
import Debug from 'debug'

const debug = Debug('infinibay:process-manager')

// Internal types (not exposed to GraphQL)
interface InternalProcessInfo {
  pid: number
  name: string
  cpuUsage: number
  memoryKb: number
  status: string
  commandLine?: string
  user?: string
  startTime?: Date
}

interface InternalProcessControlResult {
  success: boolean
  message: string
  pid?: number
  processName?: string
  error?: string
}

export enum ProcessSortBy {
  CPU = 'cpu',
  MEMORY = 'memory',
  PID = 'pid',
  NAME = 'name'
}

interface ProcessCommandResponse extends CommandResponse {
  data?: InternalProcessInfo[] | { processes?: InternalProcessInfo[] } | any
}

export class ProcessManager {
  private prisma: PrismaClient
  private virtioSocketWatcher: VirtioSocketWatcherService

  constructor(prisma: PrismaClient, virtioSocketWatcher: VirtioSocketWatcherService) {
    this.prisma = prisma
    this.virtioSocketWatcher = virtioSocketWatcher
  }

  /**
   * Get domain and verify VM is running
   */
  private async getDomain(machineId: string): Promise<{ machine: Machine; domain: any } | null> {
    try {
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId }
      })

      if (!machine) {
        debug(`Machine ${machineId} not found`)
        return null
      }

      // Get shared libvirt connection
      const conn = await getLibvirtConnection()
      if (!conn) {
        debug(`Failed to get libvirt connection`)
        return null
      }

      // Try to get domain from libvirt regardless of database status
      const domain = VirtualMachine.lookupByName(conn, machine.internalName)

      if (!domain) {
        debug(`Domain not found for machine ${machine.internalName}`)
        return null
      }

      const stateResult = domain.getState()
      const state = stateResult ? stateResult.result : null
      // VIR_DOMAIN_RUNNING = 1
      if (state !== 1) {
        debug(`Domain ${machine.internalName} is not in running state (state: ${state})`)
        return null
      }

      // Update machine status in DB if it's different
      if (machine.status !== 'running') {
        debug(`Updating machine ${machineId} status from '${machine.status}' to 'running' based on libvirt state`)
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'running' }
        })
        machine.status = 'running'
      }

      return { machine, domain }
    } catch (error) {
      debug(`Failed to get domain for machine ${machineId}: ${error}`)
      return null
    }
  }

  /**
   * List all processes running on a VM
   */
  async listProcesses(machineId: string, limit?: number): Promise<InternalProcessInfo[]> {
    try {
      const domainInfo = await this.getDomain(machineId)
      if (!domainInfo) {
        throw new Error(`Machine ${machineId} is not available`)
      }

      debug(`Listing processes for machine ${machineId} (limit: ${limit || 'none'})`)

      // Use VirtIO socket (InfiniService)
      const command: SafeCommandType = {
        action: 'ProcessList',
        params: limit ? { limit } : undefined
      }

      const response = await this.virtioSocketWatcher.sendSafeCommand(
        machineId,
        command,
        30000
      ) as ProcessCommandResponse

      if (response.success && response.data) {
        const processes = Array.isArray(response.data)
          ? response.data
          : (response.data.processes || [])

        debug(`Retrieved ${processes.length} processes via VirtIO`)
        return this.mapProcesses(processes)
      } else {
        throw new Error(`Failed to get process list: ${response.error || 'InfiniService not available'}`)
      }
    } catch (error) {
      debug(`Failed to list processes for machine ${machineId}: ${error}`)
      throw error
    }
  }

  /**
   * Get top processes by CPU or memory usage
   */
  async getTopProcesses(
    machineId: string,
    limit: number = 10,
    sortBy: ProcessSortBy = ProcessSortBy.CPU
  ): Promise<InternalProcessInfo[]> {
    try {
      const domainInfo = await this.getDomain(machineId)
      if (!domainInfo) {
        throw new Error(`Machine ${machineId} is not available`)
      }

      debug(`Getting top ${limit} processes for machine ${machineId} sorted by ${sortBy}`)

      // Use VirtIO socket (InfiniService)
      const command: SafeCommandType = {
        action: 'ProcessTop',
        params: {
          limit,
          sort_by: sortBy === ProcessSortBy.MEMORY ? 'memory' : 'cpu'
        }
      }

      const response = await this.virtioSocketWatcher.sendSafeCommand(
        machineId,
        command,
        30000
      ) as ProcessCommandResponse

      if (response.success && response.data) {
        const processes = Array.isArray(response.data)
          ? response.data
          : (response.data.processes || [])

        debug(`Retrieved top ${processes.length} processes via VirtIO`)
        return this.mapProcesses(processes)
      } else {
        throw new Error(`Failed to get top processes: ${response.error || 'InfiniService not available'}`)
      }
    } catch (error) {
      debug(`Failed to get top processes for machine ${machineId}: ${error}`)
      throw error
    }
  }

  /**
   * Kill a process on a VM
   */
  async killProcess(
    machineId: string,
    pid: number,
    force: boolean = false
  ): Promise<InternalProcessControlResult> {
    try {
      const domainInfo = await this.getDomain(machineId)
      if (!domainInfo) {
        throw new Error(`Machine ${machineId} is not available`)
      }

      debug(`Killing process ${pid} on machine ${machineId} (force: ${force})`)

      // Use VirtIO socket (InfiniService)
      const command: SafeCommandType = {
        action: 'ProcessKill',
        params: { pid, force }
      }

      const response = await this.virtioSocketWatcher.sendSafeCommand(
        machineId,
        command,
        30000
      )

      if (response.success) {
        debug(`Successfully killed process ${pid} via VirtIO`)
        return {
          success: true,
          message: `Process ${pid} terminated successfully`,
          pid
        }
      } else {
        return {
          success: false,
          message: response.error || `Failed to kill process ${pid}`,
          pid,
          error: response.error
        }
      }
    } catch (error) {
      debug(`Failed to kill process ${pid} on machine ${machineId}: ${error}`)
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
  async killProcesses(
    machineId: string,
    pids: number[],
    force: boolean = false
  ): Promise<InternalProcessControlResult[]> {
    const results: InternalProcessControlResult[] = []

    for (const pid of pids) {
      const result = await this.killProcess(machineId, pid, force)
      results.push(result)
    }

    return results
  }

  // Private helper methods

  /**
   * Map raw process data to internal format
   */
  private mapProcesses(rawProcesses: any[]): InternalProcessInfo[] {
    return rawProcesses.map(p => ({
      pid: p.pid || 0,
      name: p.name || 'unknown',
      cpuUsage: p.cpu_usage || p.cpuUsage || 0,
      memoryKb: p.memory_kb || p.memoryKb || 0,
      status: p.status || 'unknown',
      commandLine: p.command_line || p.commandLine,
      user: p.user,
      startTime: p.start_time ? new Date(p.start_time) : undefined
    }))
  }

}

// Export internal types for use in resolver
export type {
  InternalProcessInfo,
  InternalProcessControlResult
}