import { Debugger } from '../utils/debug'
import { getInfinization } from './InfinizationService'
import { Infinization } from '@infinibay/infinization'

/**
 * Service for interacting with QEMU Guest Agent to debug VM issues
 * This service provides diagnostic capabilities for troubleshooting
 * InfiniService installation and connection problems
 */
export class QemuGuestAgentService {
  private debug: Debugger
  private infinization: Infinization | null = null

  constructor () {
    this.debug = new Debugger('qemu-guest-agent')
  }

  /**
   * Initialize the service with infinization connection
   */
  async initialize (): Promise<void> {
    try {
      this.infinization = await getInfinization()
      this.debug.log('info', 'QEMU Guest Agent Service initialized')
    } catch (error) {
      this.debug.log('error', `Failed to initialize infinization: ${error}`)
      throw error
    }
  }

  /**
   * Execute a command inside a VM using QEMU Guest Agent
   * Note: This requires qemuAgentCommand to be implemented in infinization
   */
  async executeCommand (
    vmId: string,
    command: string,
    args: string[] = []
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!this.infinization) {
      throw new Error('Service not initialized. Call initialize() first.')
    }

    try {
      // Check if VM is running via infinization
      const status = await this.infinization.getVMStatus(vmId)
      if (!status.processAlive) {
        return { success: false, error: `VM ${vmId} is not running` }
      }

      // Note: qemuAgentCommand is not yet implemented in infinization
      // This is a placeholder for when it becomes available
      this.debug.log('warn', 'qemuAgentCommand is not yet implemented in infinization')

      // For now, provide manual debugging instructions
      const virshCommand = this.buildVirshCommand(vmId, command, args)
      this.debug.log('info', `To manually debug, run: ${virshCommand}`)

      return {
        success: false,
        error: 'QEMU Guest Agent commands not yet supported. Use virsh manually.',
        output: virshCommand
      }

      // Future implementation when qemuAgentCommand is available in infinization:
      /*
      const guestExecCmd = {
        execute: 'guest-exec',
        arguments: {
          path: command,
          arg: args,
          'capture-output': true
        }
      }

      const result = await this.infinization.qemuAgentCommand(vmId, JSON.stringify(guestExecCmd), 30)
      const resultObj = JSON.parse(result)

      // Wait for command completion
      let attempts = 0
      const maxAttempts = 10
      while (attempts < maxAttempts) {
        const statusCmd = {
          execute: 'guest-exec-status',
          arguments: { pid: resultObj.pid }
        }

        const status = await this.infinization.qemuAgentCommand(vmId, JSON.stringify(statusCmd), 30)
        const statusObj = JSON.parse(status)

        if (statusObj.exited) {
          const output = statusObj['out-data']
            ? Buffer.from(statusObj['out-data'], 'base64').toString()
            : ''
          const error = statusObj['err-data']
            ? Buffer.from(statusObj['err-data'], 'base64').toString()
            : ''

          return {
            success: statusObj.exitcode === 0,
            output,
            error
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500))
        attempts++
      }

      return { success: false, error: 'Command execution timeout' }
      */
    } catch (error) {
      this.debug.log('error', `Failed to execute command in VM ${vmId}: ${error}`)
      return { success: false, error: String(error) }
    }
  }

  /**
   * Check if InfiniService is installed and running in a VM
   */
  async checkInfiniService (vmId: string): Promise<{
    installed: boolean
    running: boolean
    error?: string
    diagnostics: string[]
  }> {
    const diagnostics: string[] = []

    // Generate diagnostic commands
    diagnostics.push('Diagnostic commands to run manually:')
    diagnostics.push('')
    diagnostics.push('1. Check if InfiniService is installed:')
    diagnostics.push(`   virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'`)
    diagnostics.push('')
    diagnostics.push('2. Check if socket file exists in VM:')
    diagnostics.push(`   virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"ls","arg":["-la","/opt/infinibay/sockets/"]}}'`)
    diagnostics.push('')
    diagnostics.push('3. Check InfiniService logs:')
    diagnostics.push(`   virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"journalctl","arg":["-u","infiniservice","-n","50"]}}'`)
    diagnostics.push('')
    diagnostics.push('4. Check if virtio-serial device is available:')
    diagnostics.push(`   virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"ls","arg":["-la","/dev/virtio-ports/"]}}'`)
    diagnostics.push('')
    diagnostics.push('5. Install InfiniService if missing:')
    diagnostics.push('   a. Copy the InfiniService binary to the VM')
    diagnostics.push('   b. Create systemd service file at /etc/systemd/system/infiniservice.service')
    diagnostics.push('   c. Run: systemctl daemon-reload && systemctl enable --now infiniservice')

    // Try to check service status (placeholder for now)
    const result = await this.executeCommand(vmId, 'systemctl', ['status', 'infiniservice'])

    return {
      installed: false,
      running: false,
      error: result.error,
      diagnostics
    }
  }

  /**
   * Get system information from a VM
   */
  async getSystemInfo (vmId: string): Promise<{
    success: boolean
    info?: {
      hostname?: string
      os?: string
      kernel?: string
    }
    error?: string
  }> {
    const commands = [
      { cmd: 'hostname', args: [], key: 'hostname' },
      { cmd: 'uname', args: ['-s', '-r'], key: 'kernel' },
      { cmd: 'cat', args: ['/etc/os-release'], key: 'os' }
    ]

    const info: any = {}
    const errors: string[] = []

    for (const { cmd, args, key } of commands) {
      const result = await this.executeCommand(vmId, cmd, args)
      if (result.success && result.output) {
        info[key] = result.output.trim()
      } else if (result.error) {
        errors.push(`${cmd}: ${result.error}`)
      }
    }

    if (Object.keys(info).length === 0) {
      return { success: false, error: errors.join('; ') }
    }

    return { success: true, info }
  }

  /**
   * Build virsh command for manual execution
   */
  private buildVirshCommand (vmId: string, command: string, args: string[]): string {
    const guestExecCmd = {
      execute: 'guest-exec',
      arguments: {
        path: command,
        arg: args,
        'capture-output': true
      }
    }
    return `virsh qemu-agent-command ${vmId} '${JSON.stringify(guestExecCmd)}'`
  }

  /**
   * Diagnose socket connection issues
   */
  async diagnoseSocketIssues (vmId: string): Promise<{
    diagnostics: string[]
    recommendations: string[]
  }> {
    const diagnostics: string[] = []
    const recommendations: string[] = []

    diagnostics.push('=== VM Socket Connection Diagnostics ===')
    diagnostics.push('')
    diagnostics.push(`VM ID: ${vmId}`)
    diagnostics.push(`Timestamp: ${new Date().toISOString()}`)
    diagnostics.push('')

    // Check VM state
    if (this.infinization) {
      try {
        const status = await this.infinization.getVMStatus(vmId)
        if (status.processAlive) {
          diagnostics.push('VM State: Running')
        } else {
          diagnostics.push(`VM State: ${status.status || 'Not Running'}`)
          recommendations.push('• VM is not running. Start the VM first.')
        }
      } catch (error) {
        diagnostics.push(`VM State: Error checking - ${error}`)
        recommendations.push('• VM not found. Check VM ID.')
      }
    }

    // Socket file diagnostics
    diagnostics.push('')
    diagnostics.push('Socket File Checks:')
    diagnostics.push(`1. Host socket path: /opt/infinibay/sockets/${vmId}.socket`)
    diagnostics.push('2. Check if socket exists on host:')
    diagnostics.push(`   ls -la /opt/infinibay/sockets/${vmId}.socket`)
    diagnostics.push('3. Check socket permissions:')
    diagnostics.push(`   stat /opt/infinibay/sockets/${vmId}.socket`)

    // InfiniService diagnostics
    diagnostics.push('')
    diagnostics.push('InfiniService Checks:')
    const serviceCheck = await this.checkInfiniService(vmId)
    diagnostics.push(...serviceCheck.diagnostics)

    // Common issues and recommendations
    recommendations.push('')
    recommendations.push('=== Common Issues and Solutions ===')
    recommendations.push('')
    recommendations.push('EACCES (Permission Denied):')
    recommendations.push('• InfiniService not installed/running in VM')
    recommendations.push('• Socket file has incorrect permissions')
    recommendations.push('• SELinux/AppArmor blocking socket access')
    recommendations.push('')
    recommendations.push('ECONNREFUSED (Connection Refused):')
    recommendations.push('• InfiniService crashed or not listening')
    recommendations.push('• Socket file exists but no process listening')
    recommendations.push('• Check InfiniService logs in VM')
    recommendations.push('')
    recommendations.push('ENOENT (No Such File):')
    recommendations.push('• Socket file not created')
    recommendations.push('• VM shutting down or InfiniService not started')
    recommendations.push('• Check virtio-serial device in VM')

    return { diagnostics, recommendations }
  }

  /**
   * Get human-readable VM state name
   */
  private getStateName (state: number): string {
    const states: { [key: number]: string } = {
      0: 'No State',
      1: 'Running',
      2: 'Blocked',
      3: 'Paused',
      4: 'Shutdown',
      5: 'Shutoff',
      6: 'Crashed',
      7: 'PM Suspended'
    }
    return states[state] || `Unknown (${state})`
  }
}

// Singleton instance management
let qemuGuestAgentService: QemuGuestAgentService | null = null

export const getQemuGuestAgentService = async (): Promise<QemuGuestAgentService> => {
  if (!qemuGuestAgentService) {
    qemuGuestAgentService = new QemuGuestAgentService()
    await qemuGuestAgentService.initialize()
  }
  return qemuGuestAgentService
}
