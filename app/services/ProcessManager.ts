import { PrismaClient, Machine } from '@prisma/client'
import { VirtioSocketWatcherService, SafeCommandType, CommandResponse } from './VirtioSocketWatcherService'
import libvirtNode from '@infinibay/libvirt-node'
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

      if (machine.status !== 'running') {
        debug(`Machine ${machineId} is not running (status: ${machine.status})`)
        return null
      }

      const hypervisor = new (libvirtNode as any).Hypervisor('qemu:///system')
      const domain = hypervisor.lookupDomainByName(machine.name)

      if (!domain) {
        debug(`Domain not found for machine ${machine.name}`)
        return null
      }

      const [state] = domain.getState()
      if (state !== (libvirtNode as any).VIR_DOMAIN_RUNNING) {
        debug(`Domain ${machine.name} is not in running state`)
        return null
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

      // Try VirtIO socket first (InfiniService)
      try {
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
          
          debug( `Retrieved ${processes.length} processes via VirtIO`)
          return this.mapProcesses(processes)
        }
      } catch (virtioError) {
        debug( `VirtIO socket not available for ${machineId}, falling back to QEMU Guest Agent`)
      }

      // Fallback to QEMU Guest Agent
      const agent = new (libvirtNode as any).GuestAgent(domainInfo.domain)
      const result = await this.listProcessesViaQGA(agent, limit)
      
      return result
    } catch (error) {
      debug( `Failed to list processes for machine ${machineId}: ${error}`)
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

      debug( `Getting top ${limit} processes for machine ${machineId} sorted by ${sortBy}`)

      // Try VirtIO socket first (InfiniService)
      try {
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
          
          debug( `Retrieved top ${processes.length} processes via VirtIO`)
          return this.mapProcesses(processes)
        }
      } catch (virtioError) {
        debug( `VirtIO socket not available for ${machineId}, falling back to QEMU Guest Agent`)
      }

      // Fallback to QEMU Guest Agent - get all processes and sort locally
      const agent = new (libvirtNode as any).GuestAgent(domainInfo.domain)
      const allProcesses = await this.listProcessesViaQGA(agent)
      
      // Sort processes based on criteria
      const sorted = this.sortProcesses(allProcesses, sortBy)
      
      // Apply limit
      return sorted.slice(0, limit)
    } catch (error) {
      debug( `Failed to get top processes for machine ${machineId}: ${error}`)
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

      debug( `Killing process ${pid} on machine ${machineId} (force: ${force})`)

      // Try VirtIO socket first (InfiniService)
      try {
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
          debug( `Successfully killed process ${pid} via VirtIO`)
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
      } catch (virtioError) {
        debug( `VirtIO socket not available for ${machineId}, falling back to QEMU Guest Agent`)
      }

      // Fallback to QEMU Guest Agent
      const agent = new (libvirtNode as any).GuestAgent(domainInfo.domain)
      const result = await this.killProcessViaQGA(agent, domainInfo.machine, pid, force)
      
      return result
    } catch (error) {
      debug( `Failed to kill process ${pid} on machine ${machineId}: ${error}`)
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

  /**
   * Sort processes by specified criteria
   */
  private sortProcesses(processes: InternalProcessInfo[], sortBy: ProcessSortBy): InternalProcessInfo[] {
    const sorted = [...processes]
    
    switch (sortBy) {
      case ProcessSortBy.CPU:
        sorted.sort((a, b) => b.cpuUsage - a.cpuUsage)
        break
      case ProcessSortBy.MEMORY:
        sorted.sort((a, b) => b.memoryKb - a.memoryKb)
        break
      case ProcessSortBy.PID:
        sorted.sort((a, b) => a.pid - b.pid)
        break
      case ProcessSortBy.NAME:
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
    }
    
    return sorted
  }

  /**
   * List processes via QEMU Guest Agent (fallback)
   */
  private async listProcessesViaQGA(agent: any, limit?: number): Promise<InternalProcessInfo[]> {
    try {
      // Note: This is a fallback method, we assume the machine info is already validated
      const machine = { os: 'linux' } as Machine // Default fallback
      const os = this.detectOS(machine)
      
      let command: string
      if (os === 'windows') {
        command = 'powershell.exe -Command "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json"'
      } else {
        command = 'ps aux --no-headers'
      }
      
      const result = agent.exec(command, [], true)
      if (!result || !result.stdout) {
        throw new Error('No output from process list command')
      }
      
      const processes = os === 'windows' 
        ? this.parseWindowsProcesses(result.stdout)
        : this.parseLinuxProcesses(result.stdout)
      
      if (limit) {
        return processes.slice(0, limit)
      }
      
      return processes
    } catch (error) {
      debug( `Failed to list processes via QGA: ${error}`)
      throw error
    }
  }

  /**
   * Kill process via QEMU Guest Agent (fallback)
   */
  private async killProcessViaQGA(
    agent: any, 
    machine: Machine, 
    pid: number, 
    force: boolean
  ): Promise<InternalProcessControlResult> {
    try {
      const os = this.detectOS(machine)
      
      let command: string
      if (os === 'windows') {
        command = force 
          ? `taskkill /F /PID ${pid}`
          : `taskkill /PID ${pid}`
      } else {
        command = force
          ? `kill -9 ${pid}`
          : `kill ${pid}`
      }
      
      const result = agent.exec(command, [], true)
      
      if (result && !result.stderr) {
        return {
          success: true,
          message: `Process ${pid} terminated successfully`,
          pid
        }
      } else {
        return {
          success: false,
          message: result?.stderr || `Failed to kill process ${pid}`,
          pid,
          error: result?.stderr
        }
      }
    } catch (error) {
      debug( `Failed to kill process via QGA: ${error}`)
      throw error
    }
  }

  /**
   * Parse Windows process list output
   */
  private parseWindowsProcesses(output: string): InternalProcessInfo[] {
    try {
      const processes = JSON.parse(output)
      return processes.map((p: any) => ({
        pid: p.Id || 0,
        name: p.ProcessName || 'unknown',
        cpuUsage: p.CPU || 0,
        memoryKb: Math.round((p.WorkingSet || 0) / 1024),
        status: 'running'
      }))
    } catch (error) {
      debug( `Failed to parse Windows process output: ${error}`)
      return []
    }
  }

  /**
   * Parse Linux process list output
   */
  private parseLinuxProcesses(output: string): InternalProcessInfo[] {
    const processes: InternalProcessInfo[] = []
    const lines = output.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 11) {
        processes.push({
          pid: parseInt(parts[1]) || 0,
          name: parts[10] || 'unknown',
          cpuUsage: parseFloat(parts[2]) || 0,
          memoryKb: parseInt(parts[5]) || 0,
          status: 'running',
          user: parts[0]
        })
      }
    }
    
    return processes
  }

  /**
   * Detect OS from machine info
   */
  private detectOS(machine: Machine): 'windows' | 'linux' | 'unknown' {
    const os = machine.os?.toLowerCase() || ''
    if (os.includes('windows') || os.includes('win')) {
      return 'windows'
    } else if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian') || os.includes('centos') || os.includes('rhel')) {
      return 'linux'
    }
    return 'unknown'
  }
}

// Export internal types for use in resolver
export type {
  InternalProcessInfo,
  InternalProcessControlResult
}