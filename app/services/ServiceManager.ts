import { PrismaClient, Machine } from '@prisma/client'
const libvirtNode = require('../../lib/libvirt-node')
import { getLibvirtConnection } from '../utils/libvirt'
import { Debugger } from '../utils/debug'

// Type aliases for libvirt-node types
type Connection = typeof libvirtNode.Connection
type LibvirtMachine = typeof libvirtNode.Machine
type GuestAgent = typeof libvirtNode.GuestAgent

export interface ServiceInfo {
  name: string
  displayName?: string
  status: 'running' | 'stopped' | 'disabled' | 'unknown'
  startType?: 'automatic' | 'manual' | 'disabled' | 'unknown'
  description?: string
  pid?: number
}

export type VMServiceAction = 'START' | 'STOP' | 'RESTART' | 'ENABLE' | 'DISABLE' | 'STATUS'

export interface ServiceControlResult {
  success: boolean
  message: string
  service?: ServiceInfo
  error?: string
}

export class ServiceManager {
  private debug: Debugger
  private prisma: PrismaClient
  private libvirt: Connection | null = null

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = new Debugger('service-manager')
  }

  private async initialize(): Promise<void> {
    if (!this.libvirt) {
      this.libvirt = await getLibvirtConnection()
      this.debug.log('info', 'ServiceManager initialized with libvirt connection')
    }
  }

  private detectOS(machine: Machine): 'windows' | 'linux' | 'unknown' {
    const os = machine.os?.toLowerCase() || ''
    if (os.includes('windows')) return 'windows'
    if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian') || 
        os.includes('centos') || os.includes('rhel') || os.includes('fedora')) return 'linux'
    return 'unknown'
  }

  private async getDomain(machineId: string): Promise<{ machine: Machine; domain: LibvirtMachine } | null> {
    await this.initialize()
    
    const machine = await this.prisma.machine.findUnique({ where: { id: machineId } })
    if (!machine) {
      this.debug.log('error', `Machine ${machineId} not found in database`)
      return null
    }

    if (!this.libvirt) {
      this.debug.log('error', 'Libvirt connection not initialized')
      return null
    }

    const domain = libvirtNode.Machine.lookupByUuidString(this.libvirt, machineId)
    if (!domain) {
      this.debug.log('error', `Domain ${machineId} not found in libvirt`)
      return null
    }

    const isActive = domain.isActive()
    if (!isActive) {
      this.debug.log('warn', `Machine ${machineId} is not running`)
      return null
    }

    return { machine, domain }
  }

  async listServices(machineId: string): Promise<ServiceInfo[]> {
    try {
      const domainInfo = await this.getDomain(machineId)
      if (!domainInfo) {
        return []
      }

      const { machine, domain } = domainInfo
      const os = this.detectOS(machine)
      const agent = new libvirtNode.GuestAgent(domain)

      this.debug.log('info', `Listing services for ${os} machine ${machineId}`)

      let services: ServiceInfo[] = []

      if (os === 'windows') {
        services = await this.listWindowsServices(agent)
      } else if (os === 'linux') {
        services = await this.listLinuxServices(agent)
      } else {
        this.debug.log('error', `Unknown OS type for machine ${machineId}: ${machine.os}`)
      }

      return services
    } catch (error) {
      this.debug.log('error', `Failed to list services: ${error}`)
      return []
    }
  }

  private async listWindowsServices(agent: GuestAgent): Promise<ServiceInfo[]> {
    try {
      const result = agent.exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json -Compress`
        ],
        true
      )

      if (!result || !result.stdout) {
        this.debug.log('warn', 'No output from Windows service listing')
        return []
      }

      const services = JSON.parse(result.stdout)
      
      return (Array.isArray(services) ? services : [services]).map((svc: any) => ({
        name: svc.Name,
        displayName: svc.DisplayName,
        status: this.mapWindowsStatus(svc.Status),
        startType: this.mapWindowsStartType(svc.StartType)
      }))
    } catch (error) {
      this.debug.log('error', `Failed to list Windows services: ${error}`)
      return []
    }
  }

  private async listLinuxServices(agent: GuestAgent): Promise<ServiceInfo[]> {
    try {
      // Try systemctl first (systemd)
      let result = agent.exec(
        'systemctl',
        ['list-units', '--type=service', '--all', '--no-pager', '--output=json'],
        true
      )

      if (result && result.stdout) {
        return this.parseSystemdServices(result.stdout)
      }

      // Fallback to basic systemctl without JSON
      result = agent.exec(
        'systemctl',
        ['list-units', '--type=service', '--all', '--no-pager'],
        true
      )

      if (result && result.stdout) {
        return this.parseSystemdServicesText(result.stdout)
      }

      // Fallback to service command (SysV init)
      result = agent.exec('service', ['--status-all'], true)
      
      if (result && result.stdout) {
        return this.parseSysVServices(result.stdout)
      }

      return []
    } catch (error) {
      this.debug.log('error', `Failed to list Linux services: ${error}`)
      return []
    }
  }

  private parseSystemdServices(output: string): ServiceInfo[] {
    try {
      const units = JSON.parse(output)
      return units.map((unit: any) => ({
        name: unit.unit.replace('.service', ''),
        description: unit.description,
        status: unit.active === 'active' ? 'running' : 'stopped',
        startType: unit.state === 'enabled' ? 'automatic' : 'manual'
      }))
    } catch {
      return []
    }
  }

  private parseSystemdServicesText(output: string): ServiceInfo[] {
    const services: ServiceInfo[] = []
    const lines = output.split('\n')
    
    for (const line of lines) {
      if (line.includes('.service')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4) {
          const name = parts[0].replace('.service', '')
          const status = parts[2] === 'active' ? 'running' : 'stopped'
          services.push({
            name,
            status,
            description: parts.slice(4).join(' ')
          })
        }
      }
    }
    
    return services
  }

  private parseSysVServices(output: string): ServiceInfo[] {
    const services: ServiceInfo[] = []
    const lines = output.split('\n')
    
    for (const line of lines) {
      const match = line.match(/\[\s*([+-])\s*\]\s+(.+)/)
      if (match) {
        services.push({
          name: match[2].trim(),
          status: match[1] === '+' ? 'running' : 'stopped'
        })
      }
    }
    
    return services
  }

  async controlService(
    machineId: string,
    serviceName: string,
    action: VMServiceAction
  ): Promise<ServiceControlResult> {
    try {
      const domainInfo = await this.getDomain(machineId)
      if (!domainInfo) {
        return {
          success: false,
          message: 'Machine not found or not running',
          error: 'Machine unavailable'
        }
      }

      const { machine, domain } = domainInfo
      const os = this.detectOS(machine)
      const agent = new libvirtNode.GuestAgent(domain)

      this.debug.log('info', `Executing ${action} on service ${serviceName} for ${os} machine ${machineId}`)

      if (os === 'windows') {
        return await this.controlWindowsService(agent, serviceName, action)
      } else if (os === 'linux') {
        return await this.controlLinuxService(agent, serviceName, action)
      } else {
        return {
          success: false,
          message: `Unknown OS type: ${machine.os}`,
          error: 'Unsupported OS'
        }
      }
    } catch (error) {
      this.debug.log('error', `Failed to control service: ${error}`)
      return {
        success: false,
        message: `Failed to ${action.toLowerCase()} service`,
        error: String(error)
      }
    }
  }

  private async controlWindowsService(
    agent: GuestAgent,
    serviceName: string,
    action: VMServiceAction
  ): Promise<ServiceControlResult> {
    let command: string
    let args: string[]

    switch (action) {
      case 'START':
        command = 'net'
        args = ['start', serviceName]
        break
      case 'STOP':
        command = 'net'
        args = ['stop', serviceName]
        break
      case 'RESTART':
        command = 'powershell.exe'
        args = ['-NoProfile', '-Command', `Restart-Service -Name "${serviceName}" -Force`]
        break
      case 'ENABLE':
        command = 'sc.exe'
        args = ['config', serviceName, 'start=', 'auto']
        break
      case 'DISABLE':
        command = 'sc.exe'
        args = ['config', serviceName, 'start=', 'disabled']
        break
      case 'STATUS':
        command = 'sc.exe'
        args = ['query', serviceName]
        break
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
          error: 'Invalid action'
        }
    }

    const result = agent.exec(command, args, true)
    
    if (!result) {
      return {
        success: false,
        message: `Failed to execute ${action} on ${serviceName}`,
        error: 'Command execution failed'
      }
    }

    // Check for errors in output
    if (result.stderr && result.stderr.length > 0) {
      return {
        success: false,
        message: `Error executing ${action} on ${serviceName}`,
        error: result.stderr
      }
    }

    return {
      success: true,
      message: `Successfully executed ${action} on ${serviceName}`,
      service: await this.getWindowsServiceStatus(agent, serviceName)
    }
  }

  private async controlLinuxService(
    agent: GuestAgent,
    serviceName: string,
    action: VMServiceAction
  ): Promise<ServiceControlResult> {
    let command = 'systemctl'
    let args: string[]

    switch (action) {
      case 'START':
        args = ['start', serviceName]
        break
      case 'STOP':
        args = ['stop', serviceName]
        break
      case 'RESTART':
        args = ['restart', serviceName]
        break
      case 'ENABLE':
        args = ['enable', serviceName]
        break
      case 'DISABLE':
        args = ['disable', serviceName]
        break
      case 'STATUS':
        args = ['status', serviceName]
        break
      default:
        return {
          success: false,
          message: `Unknown action: ${action}`,
          error: 'Invalid action'
        }
    }

    const result = agent.exec(command, args, true)
    
    if (!result) {
      // Try fallback to service command
      if (action !== 'ENABLE' && action !== 'DISABLE') {
        const fallbackResult = agent.exec(
          'service',
          [serviceName, action.toLowerCase()],
          true
        )
        
        if (fallbackResult && !fallbackResult.stderr) {
          return {
            success: true,
            message: `Successfully executed ${action} on ${serviceName}`,
            service: await this.getLinuxServiceStatus(agent, serviceName)
          }
        }
      }
      
      return {
        success: false,
        message: `Failed to execute ${action} on ${serviceName}`,
        error: 'Command execution failed'
      }
    }

    // systemctl returns 0 for success
    return {
      success: true,
      message: `Successfully executed ${action} on ${serviceName}`,
      service: await this.getLinuxServiceStatus(agent, serviceName)
    }
  }

  private async getWindowsServiceStatus(agent: GuestAgent, serviceName: string): Promise<ServiceInfo | undefined> {
    try {
      const result = agent.exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Get-Service -Name "${serviceName}" | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json`
        ],
        true
      )

      if (result && result.stdout) {
        const svc = JSON.parse(result.stdout)
        return {
          name: svc.Name,
          displayName: svc.DisplayName,
          status: this.mapWindowsStatus(svc.Status),
          startType: this.mapWindowsStartType(svc.StartType)
        }
      }
    } catch (error) {
      this.debug.log('error', `Failed to get Windows service status: ${error}`)
    }
    
    return undefined
  }

  private async getLinuxServiceStatus(agent: GuestAgent, serviceName: string): Promise<ServiceInfo | undefined> {
    try {
      const result = agent.exec('systemctl', ['status', serviceName, '--no-pager'], true)
      
      if (result && result.stdout) {
        const lines = result.stdout.split('\n')
        let status: 'running' | 'stopped' | 'unknown' = 'unknown'
        
        for (const line of lines) {
          if (line.includes('Active:')) {
            if (line.includes('active (running)')) {
              status = 'running'
            } else if (line.includes('inactive') || line.includes('dead')) {
              status = 'stopped'
            }
            break
          }
        }
        
        return {
          name: serviceName,
          status
        }
      }
    } catch (error) {
      this.debug.log('error', `Failed to get Linux service status: ${error}`)
    }
    
    return undefined
  }

  private mapWindowsStatus(status: number): 'running' | 'stopped' | 'unknown' {
    // PowerShell ServiceControllerStatus enum values
    switch (status) {
      case 4: return 'running'  // Running
      case 1: return 'stopped'  // Stopped
      default: return 'unknown'
    }
  }

  private mapWindowsStartType(startType: number): 'automatic' | 'manual' | 'disabled' | 'unknown' {
    // PowerShell ServiceStartMode enum values
    switch (startType) {
      case 2: return 'automatic'  // Automatic
      case 3: return 'manual'     // Manual
      case 4: return 'disabled'   // Disabled
      default: return 'unknown'
    }
  }
}