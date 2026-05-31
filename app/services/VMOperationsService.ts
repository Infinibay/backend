/**
 * VMOperationsService - VM power operations using infinization.
 *
 * This service provides VM lifecycle operations (start, stop, restart, reset)
 * using the infinization library instead of direct libvirt calls.
 */

import { PrismaClient } from '@prisma/client'
import { Logger } from 'winston'
import logger from '@main/logger'
import { getInfinization } from './InfinizationService'

export interface VMOperationResult {
  success: boolean
  message?: string
  error?: string
}

export class VMOperationsService {
  private prisma: PrismaClient
  private debug: Logger

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'vm-operations' })
  }

  /**
   * Restart a virtual machine (graceful shutdown then start)
   */
  async restartMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Restarting machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.restartVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine restarted successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to restart machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error restarting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Force power off a virtual machine (immediate destroy)
   */
  async forcePowerOff (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Force powering off machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.stopVM(machineId, {
        graceful: false,
        force: true
      })

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine forcefully powered off'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to force power off machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error force powering off machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Graceful power off a virtual machine
   */
  async gracefulPowerOff (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Gracefully powering off machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.stopVM(machineId, {
        graceful: true,
        timeout: 120000, // 2 minutes
        force: true // Force kill if timeout
      })

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine powered off'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to power off machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error powering off machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Reset a virtual machine (hardware reset)
   */
  async resetMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Resetting machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.resetVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine reset successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to reset machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error resetting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Start a virtual machine
   */
  async startMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Starting machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.startVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine started successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to start machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error starting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Suspend a virtual machine
   */
  async suspendMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Suspending machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.suspendVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine suspended successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to suspend machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error suspending machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Resume a suspended virtual machine
   */
  async resumeMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.debug(`Resuming machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await infinization.resumeVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine resumed successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to resume machine'
        }
      }
    } catch (error: any) {
      this.debug.error(`Error resuming machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get VM status
   */
  async getStatus (machineId: string): Promise<{
    status: string
    processAlive: boolean
    consistent: boolean
  } | null> {
    try {
      const infinization = await getInfinization()
      const result = await infinization.getVMStatus(machineId)

      return {
        status: result.status,
        processAlive: result.processAlive,
        consistent: result.consistent
      }
    } catch (error: any) {
      this.debug.error(`Error getting machine status: ${error.message}`)
      return null
    }
  }

  /**
   * Perform a graceful restart with retries
   */
  async performGracefulRestart (
    machineId: string,
    maxRetries: number = 3
  ): Promise<VMOperationResult> {
    let retries = 0

    while (retries < maxRetries) {
      const result = await this.restartMachine(machineId)

      if (result.success) {
        return result
      }

      retries++
      this.debug.debug(`Restart attempt ${retries} failed, retrying...`)

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // If all retries failed, try force power off and start
    this.debug.debug('All restart attempts failed, trying force power off and start')

    const forceOffResult = await this.forcePowerOff(machineId)
    if (!forceOffResult.success) {
      return forceOffResult
    }

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Try to start
    return this.startMachine(machineId)
  }

  /**
   * Execute a command inside a VM via QEMU Guest Agent (guest-exec).
   *
   * This connects to the VM's QMP socket and uses `guest-exec` to run
   * a command inside the guest, returning stdout/stderr and exit code.
   *
   * Requires:
   * - VM must be running
   * - QMP socket path configured in machine.configuration.qmpSocketPath
   * - QEMU Guest Agent installed and running inside the VM
   *
   * @param machineId - The database ID of the machine
   * @param command - The command to execute inside the guest
   * @param args - Optional arguments to pass to the command
   * @returns VMOperationResult with stdout in message and stderr in error
   */
  async executeGuestCommand (
    machineId: string,
    command: string,
    args?: string[]
  ): Promise<VMOperationResult & { stdout?: string, stderr?: string, exitCode?: number | null }> {
    this.debug.debug(`Executing guest command on machine ${machineId}: ${command}`)

    try {
      // Get the machine's QMP and Guest Agent socket paths from the database.
      // `configuration` is a relation, so we must explicitly include it.
      const machine = await this.prisma.machine.findFirst({
        where: { id: machineId },
        include: { configuration: true }
      })

      if (!machine) {
        return { success: false, error: 'Machine not found' }
      }

      const qmpSocketPath = machine.configuration?.qmpSocketPath
      const guestAgentSocketPath = machine.configuration?.guestAgentSocketPath
      if (!qmpSocketPath) {
        return {
          success: false,
          error: 'No QMP socket configured for this machine. Ensure the VM is running.'
        }
      }
      if (!guestAgentSocketPath) {
        return {
          success: false,
          error: 'No QEMU Guest Agent socket configured for this machine.'
        }
      }

      const infinization = await getInfinization()

      // Attach to the VM (registers it for QMP / lifecycle tracking)
      await infinization.attachToRunningVM(machineId, qmpSocketPath)

      // guest-exec / guest-exec-status are QEMU Guest Agent commands, not QMP —
      // they must go through the QGA socket, not the QMP socket.
      const result = await infinization.guestExec(machineId, guestAgentSocketPath, command, args)

      this.debug.debug(`Guest command completed: exitCode=${result.exitCode}`)

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        message: result.exitCode === 0 ? result.stdout : undefined,
        error: result.exitCode !== 0 ? result.stderr : undefined
      }
    } catch (error: any) {
      this.debug.error(`Error executing guest command: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Close connection (no-op for infinization, kept for API compatibility)
   * @deprecated No longer needed with infinization
   */
  async close (): Promise<void> {
    // No-op: infinization manages its own connections
  }
}
