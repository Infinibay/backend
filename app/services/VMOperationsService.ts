/**
 * VMOperationsService - VM power operations using infinization.
 *
 * This service provides VM lifecycle operations (start, stop, restart, reset)
 * using the infinization library instead of direct libvirt calls.
 */

import { PrismaClient } from '@prisma/client'
import { Logger } from 'winston'
import logger from '@main/logger'
import { isPowerActionLocked, GOLDEN_IMAGE_BUILD_BUSY_MESSAGE } from '../constants/machine-status'
import { NodeDispatcher } from './node/NodeDispatcher'
import { type NodeExecutor } from './node/NodeExecutor'
import { getVirtioSocketWatcherService } from './VirtioSocketWatcherService'

export interface VMOperationResult {
  success: boolean
  message?: string
  error?: string
}

export class VMOperationsService {
  private prisma: PrismaClient
  private debug: Logger
  private dispatcher: NodeDispatcher

  constructor (prisma: PrismaClient, dispatcher?: NodeDispatcher) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'vm-operations' })
    // Multi-node routing seam: every verb is executed against the node that owns
    // the VM. On a single-node cluster this resolves to a LocalNodeExecutor, so
    // behaviour is identical to the previous direct getInfinization() path.
    this.dispatcher = dispatcher ?? new NodeDispatcher(prisma)
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
    op: (executor: NodeExecutor) => Promise<{ success: boolean, message?: string, error?: string }>
  ): Promise<VMOperationResult> {
    this.debug.debug(`${verb} machine ${machineId}`)

    try {
      const executor = await this.dispatcher.executorFor(machineId)
      const result = await op(executor)

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
   * Restart a virtual machine.
   *
   * Agent-first: if the in-guest infiniservice agent is reachable, ask it to reboot
   * the OS from inside — the guest reboots in place (QEMU stays up and emits a QMP
   * RESET), which is reliable and cannot orphan QEMU the way a cold ACPI restart can
   * when the guest fails to power off. Fall back to the legacy cold stop+start when
   * no agent is reachable (freshly installed VM, agent down, older agent that can't
   * decode the command) or when the agent reboot fails/times out.
   */
  async restartMachine (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'restart')
    if (locked) return locked
    try {
      const socket = getVirtioSocketWatcherService()
      if (socket.isVmConnected(machineId)) {
        this.debug.debug(`Restart ${machineId}: agent connected, requesting in-guest reboot`)
        try {
          const resp = await socket.sendRebootSystem(machineId)
          if (resp.success) {
            this.debug.info(`Restart ${machineId}: in-guest reboot initiated via agent`)
            return { success: true, message: 'Reboot initiated inside the guest via the agent' }
          }
          this.debug.warn(`Restart ${machineId}: agent reboot returned failure (${resp.error ?? 'no detail'}) — falling back to cold restart`)
        } catch (agentErr: any) {
          this.debug.warn(`Restart ${machineId}: agent reboot failed/timed out (${agentErr?.message ?? String(agentErr)}) — falling back to cold restart`)
        }
      } else {
        this.debug.debug(`Restart ${machineId}: no live agent, using legacy cold restart`)
      }
    } catch (lookupErr: any) {
      // Socket-watcher singleton unavailable → just use the legacy path.
      this.debug.debug(`Restart ${machineId}: agent path unavailable (${lookupErr?.message ?? String(lookupErr)}), using legacy cold restart`)
    }

    // Legacy cold restart (graceful ACPI stop then start), routed to the owning node.
    return this.runOperation(
      machineId, 'Restarting', 'Machine restarted successfully', 'Failed to restart machine',
      (infinization) => infinization.restartVM(machineId)
    )
  }

  /**
   * Force power off a virtual machine (immediate destroy)
   */
  async forcePowerOff (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'force power off')
    if (locked) return locked
    return this.runOperation(
      machineId, 'Force powering off', 'Machine forcefully powered off', 'Failed to force power off machine',
      (infinization) => infinization.stopVM(machineId, { graceful: false, force: true })
    )
  }

  /**
   * Graceful power off a virtual machine
   */
  async gracefulPowerOff (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'power off')
    if (locked) return locked
    return this.runOperation(
      machineId, 'Gracefully powering off', 'Machine powered off', 'Failed to power off machine',
      (infinization) => infinization.stopVM(machineId, { graceful: true, timeout: 120000, force: true })
    )
  }

  /**
   * Reset a virtual machine (hardware reset)
   */
  async resetMachine (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'reset')
    if (locked) return locked
    return this.runOperation(
      machineId, 'Resetting', 'Machine reset successfully', 'Failed to reset machine',
      (infinization) => infinization.resetVM(machineId)
    )
  }

  /**
   * Shared power-action lock gate (audit C2/C3). Refuses ANY power state change
   * (start/stop/restart/reset/suspend) while the VM row is claimed by a transient
   * disk operation (backing_up / restoring / snapshotting) OR a cross-node migration
   * ('moving'). Power-cycling a VM whose qcow2 is held by qemu-img — or whose disk is
   * mid-copy to another node — corrupts the image / races the migration and can
   * silently release the 'moving' lock (via VMLifecycle.stop). The DB status is the
   * authoritative cross-service lock; fail closed (a null probe blocks nothing here,
   * but every write path re-checks). Returns an error result to short-circuit the
   * caller, or null when the action may proceed.
   */
  private async assertPowerActionAllowed (
    machineId: string,
    verb: string,
    opts?: { allowGoldenImageBuild?: boolean }
  ): Promise<VMOperationResult | null> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { status: true, goldenImageBuildId: true }
    })
    if (machine && isPowerActionLocked(machine.status)) {
      this.debug.warn(`Refusing to ${verb} machine ${machineId}: row is locked by a transient operation (status=${machine.status})`)
      return {
        success: false,
        error: `VM is busy (${machine.status}). Wait for the backup/restore/snapshot/migration to finish before you ${verb} it.`
      }
    }
    // Freeze the source VM for the WHOLE golden-image capture, not just the qemu-img
    // windows the 'capturing' status covers: the capture power-cycles the VM to seal
    // it, so mid-capture the status is legitimately 'running' (or 'off') with no disk-op
    // marker — this orthogonal check keeps every user power action refused throughout.
    // The capture flow's OWN internal seal-boot passes allowGoldenImageBuild so it can
    // still start the VM it is sealing.
    if (machine && machine.goldenImageBuildId != null && !opts?.allowGoldenImageBuild) {
      this.debug.warn(`Refusing to ${verb} machine ${machineId}: frozen for a golden-image build (goldenImageBuildId=${machine.goldenImageBuildId})`)
      return { success: false, error: GOLDEN_IMAGE_BUILD_BUSY_MESSAGE }
    }
    return null
  }

  /**
   * Start a virtual machine.
   *
   * REFUSES to start while the VM row is claimed by an in-progress disk
   * operation (backing_up / restoring / snapshotting) or a cross-node migration
   * ('moving'). Starting qemu while qemu-img holds the qcow2 open — or while the
   * disk is being copied to another node — corrupts the image; this DB-status check
   * is the authoritative cross-service gate. Fail closed.
   */
  async startMachine (machineId: string, opts?: { allowGoldenImageBuild?: boolean }): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'start', opts)
    if (locked) return locked

    // Thread the operator's seccomp-sandbox opt-out (read from the master's env)
    // into start too, so a VM created with the sandbox disabled does not re-enable
    // it on stop/start. Default keeps the sandbox ON. Travels in the config over the
    // verb RPC, so it applies whether the VM runs locally or on a remote node.
    const startConfig = process.env.INFINIZATION_DISABLE_SANDBOX === '1' ? { disableSandbox: true } : undefined
    return this.runOperation(
      machineId, 'Starting', 'Machine started successfully', 'Failed to start machine',
      // Only pass a config when there is one, so the default call shape (and the
      // single-node behavior) is byte-for-byte unchanged when the opt-out is unset.
      (infinization) => startConfig ? infinization.startVM(machineId, startConfig) : infinization.startVM(machineId)
    )
  }

  /**
   * Suspend a virtual machine
   */
  async suspendMachine (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'suspend')
    if (locked) return locked
    return this.runOperation(
      machineId, 'Suspending', 'Machine suspended successfully', 'Failed to suspend machine',
      (infinization) => infinization.suspendVM(machineId)
    )
  }

  /**
   * Resume a suspended virtual machine
   */
  async resumeMachine (machineId: string): Promise<VMOperationResult> {
    const locked = await this.assertPowerActionAllowed(machineId, 'resume')
    if (locked) return locked
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
      const executor = await this.dispatcher.executorFor(machineId)
      const result = await executor.getVMStatus(machineId)

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

      const executor = await this.dispatcher.executorFor(machineId)

      // Attach to the VM (registers it for QMP / lifecycle tracking)
      await executor.attachToRunningVM(machineId, qmpSocketPath)

      // guest-exec / guest-exec-status are QEMU Guest Agent commands, not QMP —
      // they must go through the QGA socket, not the QMP socket.
      const result = await executor.guestExec(machineId, guestAgentSocketPath, command, args)

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
