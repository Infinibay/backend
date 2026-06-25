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
   * Shared wrapper for single-step infinization power operations. Runs `op`,
   * maps its result to a VMOperationResult, and converts a thrown error into a
   * failed result. Only the call-site-specific values differ between ops: the log
   * verb, the infinization call, and the success/failure fallback text.
   */
  private async runOperation (
    machineId: string,
    verb: string,
    successMessage: string,
    failureMessage: string,
    op: (infinization: Awaited<ReturnType<typeof getInfinization>>) => Promise<{ success: boolean, message?: string, error?: string }>
  ): Promise<VMOperationResult> {
    this.debug.debug(`${verb} machine ${machineId}`)

    try {
      const infinization = await getInfinization()
      const result = await op(infinization)

      if (result.success) {
        return { success: true, message: result.message || successMessage }
      }
      return { success: false, error: result.error || failureMessage }
    } catch (error: any) {
      this.debug.error(`Error ${verb.toLowerCase()} machine: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * Restart a virtual machine (graceful shutdown then start)
   */
  async restartMachine (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Restarting', 'Machine restarted successfully', 'Failed to restart machine',
      (infinization) => infinization.restartVM(machineId)
    )
  }

  /**
   * Force power off a virtual machine (immediate destroy)
   */
  async forcePowerOff (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Force powering off', 'Machine forcefully powered off', 'Failed to force power off machine',
      (infinization) => infinization.stopVM(machineId, { graceful: false, force: true })
    )
  }

  /**
   * Graceful power off a virtual machine
   */
  async gracefulPowerOff (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Gracefully powering off', 'Machine powered off', 'Failed to power off machine',
      (infinization) => infinization.stopVM(machineId, { graceful: true, timeout: 120000, force: true })
    )
  }

  /**
   * Reset a virtual machine (hardware reset)
   */
  async resetMachine (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Resetting', 'Machine reset successfully', 'Failed to reset machine',
      (infinization) => infinization.resetVM(machineId)
    )
  }

  /**
   * Start a virtual machine
   */
  async startMachine (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Starting', 'Machine started successfully', 'Failed to start machine',
      (infinization) => infinization.startVM(machineId)
    )
  }

  /**
   * Suspend a virtual machine
   */
  async suspendMachine (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Suspending', 'Machine suspended successfully', 'Failed to suspend machine',
      (infinization) => infinization.suspendVM(machineId)
    )
  }

  /**
   * Resume a suspended virtual machine
   */
  async resumeMachine (machineId: string): Promise<VMOperationResult> {
    return this.runOperation(
      machineId, 'Resuming', 'Machine resumed successfully', 'Failed to resume machine',
      (infinization) => infinization.resumeVM(machineId)
    )
  }

  /**
   * Get VM status
   */
  async getStatus (machineId: string): Promise<{
    status: string
    qmpStatus: string | null
    processAlive: boolean
    consistent: boolean
  } | null> {
    try {
      const infinization = await getInfinization()
      const result = await infinization.getVMStatus(machineId)

      return {
        status: result.status,
        qmpStatus: result.qmpStatus,
        processAlive: result.processAlive,
        consistent: result.consistent
      }
    } catch (error: any) {
      this.debug.error(`Error getting machine status: ${error.message}`)
      return null
    }
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
