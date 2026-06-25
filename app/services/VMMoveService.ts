/**
 * VMMoveService - Handles moving VMs between departments with network/firewall hot-swap.
 *
 * When a VM is moved to another department, this service:
 * 1. Updates the database (departmentId, bridge configuration)
 * 2. If VM is running, performs hot-swap of network (TAP device to new bridge)
 * 3. Applies firewall rules from the new department
 * 4. Rolls back all changes if any step fails
 */

import { PrismaClient } from '@prisma/client'
import { TapDeviceManager } from '@infinibay/infinization'

import logger from '@main/logger'
import { getInfinization } from './InfinizationService'
import { FirewallOrchestrationService } from './firewall/FirewallOrchestrationService'
import { MOVING_STATUS, DELETING_STATUS, ARCHIVED_STATUS, REBUILDING_STATUS } from '../constants/machine-status'

const debug = logger.child({ module: 'infinibay:service:vm-move' })

export interface MoveResult {
  success: boolean
  hotSwapPerformed: boolean
  networkChanged: boolean
  firewallChanged: boolean
  firewallRulesFailed?: number
  error?: string
}

interface MoveState {
  vmId: string
  wasRunning: boolean
  oldDepartmentId: string
  newDepartmentId: string
  tapDevice: string | null
  oldBridge: string | null
  newBridge: string | null
  priorStatus: string | null
  statusClaimed: boolean
  dbUpdated: boolean
  configUpdated: boolean
  networkChanged: boolean
  firewallChanged: boolean
}

export class VMMoveService {
  private prisma: PrismaClient
  private tapManager: TapDeviceManager
  private firewallOrchestration: FirewallOrchestrationService

  constructor (
    prisma: PrismaClient,
    firewallOrchestration: FirewallOrchestrationService
  ) {
    this.prisma = prisma
    this.tapManager = new TapDeviceManager()
    this.firewallOrchestration = firewallOrchestration
  }

  /**
   * Moves a VM to a new department with network and firewall hot-swap.
   *
   * @param vmId - The VM to move
   * @param newDepartmentId - The target department
   * @returns Result indicating success/failure and what operations were performed
   */
  async moveVMToDepartment (vmId: string, newDepartmentId: string): Promise<MoveResult> {
    const state: MoveState = {
      vmId,
      wasRunning: false,
      oldDepartmentId: '',
      newDepartmentId,
      tapDevice: null,
      oldBridge: null,
      newBridge: null,
      priorStatus: null,
      statusClaimed: false,
      dbUpdated: false,
      configUpdated: false,
      networkChanged: false,
      firewallChanged: false
    }

    try {
      // 1. Get VM with configuration and department
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          configuration: true,
          department: true
        }
      })

      if (!vm) {
        throw new Error('VM not found')
      }

      if (!vm.departmentId) {
        throw new Error('VM has no department assigned')
      }

      state.oldDepartmentId = vm.departmentId
      state.tapDevice = vm.configuration?.tapDeviceName ?? null

      // 2. Validate target department exists and has network configured
      const newDept = await this.prisma.department.findUnique({
        where: { id: newDepartmentId }
      })

      if (!newDept) {
        throw new Error('Target department not found')
      }

      if (!newDept.bridgeName) {
        throw new Error('Target department has no network configured')
      }

      state.newBridge = newDept.bridgeName
      state.oldBridge = vm.department?.bridgeName ?? null

      // ── Atomic claim ('moving' status-as-lock) ──────────────────────
      // Serialize against a concurrent move/delete/rebuild on the same VM and
      // drop the VM out of the pool checkout set while the hot-swap is in flight.
      // A second concurrent move sees 'moving' and bails (count 0). The prior
      // status is restored on BOTH the success path and rollback so the VM never
      // gets stuck in 'moving'.
      state.priorStatus = vm.status
      const claim = await this.prisma.machine.updateMany({
        where: {
          id: vmId,
          status: { notIn: [MOVING_STATUS, DELETING_STATUS, ARCHIVED_STATUS, REBUILDING_STATUS] }
        },
        data: { status: MOVING_STATUS }
      })
      if (claim.count !== 1) {
        throw new Error('VM is busy (a move, delete, or rebuild is already in progress)')
      }
      state.statusClaimed = true

      // 3. Check if VM is running
      const infinization = await getInfinization()
      const vmStatus = await infinization.getVMStatus(vmId)
      state.wasRunning = vmStatus.processAlive

      debug.info(`Moving VM ${vmId}: running=${state.wasRunning}, ` +
        `oldBridge=${state.oldBridge}, newBridge=${state.newBridge}, ` +
        `tapDevice=${state.tapDevice}`
      )

      // 4+5. Atomically update machine.departmentId and configuration.bridge in a
      // single transaction so they can never be partially committed (issue b).
      // Flags are set only AFTER the transaction resolves, so a rolled-back
      // transaction doesn't trigger redundant DB undo for writes that never landed.
      await this.prisma.$transaction(async (tx) => {
        await tx.machine.update({
          where: { id: vmId },
          data: { departmentId: newDepartmentId }
        })
        if (vm.configuration) {
          await tx.machineConfiguration.update({
            where: { id: vm.configuration.id },
            data: { bridge: state.newBridge }
          })
        }
      })
      state.dbUpdated = true
      state.configUpdated = vm.configuration != null
      debug.info(`Updated machine.departmentId to ${newDepartmentId}` +
        (vm.configuration ? ` and machineConfiguration.bridge to ${state.newBridge}` : ''))

      // 6. If VM is running, perform hot-swap
      if (state.wasRunning && state.tapDevice) {
        // 6a. Change TAP device to new bridge if bridges are different
        if (state.oldBridge && state.oldBridge !== state.newBridge) {
          debug.info(`Hot-swapping TAP ${state.tapDevice} from ${state.oldBridge} to ${state.newBridge}`)

          await this.tapManager.detachFromBridge(state.tapDevice)
          await this.tapManager.attachToBridge(state.tapDevice, state.newBridge)

          state.networkChanged = true
          debug.info(`TAP ${state.tapDevice} successfully moved to ${state.newBridge}`)
        }

        // 6b. Apply firewall rules from the new department. This is part of move
        // atomicity: the VM is now on the NEW bridge, so it MUST carry the new
        // department's firewall. Any failure — thrown OR a partial apply
        // (result.success===false) — aborts the move and triggers rollback, which
        // detaches the TAP back to the old bridge and re-applies the old rules.
        // Leaving a running VM on the new bridge without its firewall is a
        // security exposure, so we never report success on a partial apply.
        state.firewallChanged = true // set before the check so rollback re-applies old rules even on a partial apply
        const fwResult = await this.firewallOrchestration.applyVMRules(vmId)
        if (!fwResult.success) {
          throw new Error(
            'Firewall apply incomplete on new department: ' +
            `${fwResult.rulesFailed}/${fwResult.rulesApplied + fwResult.rulesFailed} rules failed`
          )
        }
        debug.info(`Firewall rules from new department applied to VM ${vmId}`)
      } else {
        debug.info(`VM ${vmId} is not running, network/firewall changes will apply on next start`)
      }

      // Release the 'moving' lock — restore the VM's prior status.
      if (state.statusClaimed && state.priorStatus) {
        await this.prisma.machine.update({
          where: { id: vmId },
          data: { status: state.priorStatus }
        })
      }

      return {
        success: true,
        hotSwapPerformed: state.wasRunning,
        networkChanged: state.networkChanged,
        firewallChanged: state.firewallChanged,
        firewallRulesFailed: 0
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.error(`Move failed for VM ${vmId}: ${errorMessage}`)

      // Attempt rollback
      await this.rollback(state)

      return {
        success: false,
        hotSwapPerformed: false,
        networkChanged: false,
        firewallChanged: false,
        error: errorMessage
      }
    }
  }

  /**
   * Rolls back changes in reverse order.
   */
  private async rollback (state: MoveState): Promise<void> {
    debug.info(`Attempting rollback for VM ${state.vmId}...`)

    // 1. Rollback network changes
    if (state.networkChanged && state.tapDevice && state.oldBridge) {
      try {
        await this.tapManager.detachFromBridge(state.tapDevice)
        await this.tapManager.attachToBridge(state.tapDevice, state.oldBridge)
        debug.info(`Rolled back TAP ${state.tapDevice} to ${state.oldBridge}`)
      } catch (e) {
        debug.error(`Failed to rollback network: ${e}`)
      }
    }

    // 2. Rollback configuration.bridge
    if (state.configUpdated && state.oldBridge) {
      try {
        const config = await this.prisma.machineConfiguration.findFirst({
          where: { machineId: state.vmId }
        })
        if (config) {
          await this.prisma.machineConfiguration.update({
            where: { id: config.id },
            data: { bridge: state.oldBridge }
          })
          debug.info('Rolled back machineConfiguration.bridge')
        }
      } catch (e) {
        debug.error(`Failed to rollback configuration: ${e}`)
      }
    }

    // 3. Rollback database (departmentId)
    if (state.dbUpdated && state.oldDepartmentId) {
      try {
        await this.prisma.machine.update({
          where: { id: state.vmId },
          data: { departmentId: state.oldDepartmentId }
        })
        debug.info('Rolled back machine.departmentId')
      } catch (e) {
        debug.error(`Failed to rollback database: ${e}`)
      }
    }

    // 4. Re-apply old firewall rules if we changed them
    if (state.firewallChanged) {
      try {
        // After rolling back departmentId, applyVMRules will use the old department
        await this.firewallOrchestration.applyVMRules(state.vmId)
        debug.info('Rolled back firewall rules')
      } catch (e) {
        debug.error(`Failed to rollback firewall: ${e}`)
      }
    }

    // 5. Release the 'moving' lock — restore the VM's prior status so it never
    // gets stuck in 'moving' (which would drop it out of pools/power paths).
    if (state.statusClaimed && state.priorStatus) {
      try {
        await this.prisma.machine.update({
          where: { id: state.vmId },
          data: { status: state.priorStatus }
        })
        debug.info('Restored machine.status after failed move')
      } catch (e) {
        debug.error(`Failed to restore machine.status after failed move: ${e}`)
      }
    }

    debug.info(`Rollback completed for VM ${state.vmId}`)
  }
}
