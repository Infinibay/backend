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

import { Debugger } from '@utils/debug'
import { getInfinization } from './InfinizationService'
import { FirewallOrchestrationService } from './firewall/FirewallOrchestrationService'

const debug = new Debugger('infinibay:service:vm-move')

export interface MoveResult {
  success: boolean
  hotSwapPerformed: boolean
  networkChanged: boolean
  firewallChanged: boolean
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

      // 3. Check if VM is running
      const infinization = await getInfinization()
      const vmStatus = await infinization.getVMStatus(vmId)
      state.wasRunning = vmStatus.processAlive

      debug.log(
        'info',
        `Moving VM ${vmId}: running=${state.wasRunning}, ` +
        `oldBridge=${state.oldBridge}, newBridge=${state.newBridge}, ` +
        `tapDevice=${state.tapDevice}`
      )

      // 4. Update database: machine.departmentId
      await this.prisma.machine.update({
        where: { id: vmId },
        data: { departmentId: newDepartmentId }
      })
      state.dbUpdated = true
      debug.log('info', `Updated machine.departmentId to ${newDepartmentId}`)

      // 5. Update configuration.bridge if configuration exists
      if (vm.configuration) {
        await this.prisma.machineConfiguration.update({
          where: { id: vm.configuration.id },
          data: { bridge: state.newBridge }
        })
        state.configUpdated = true
        debug.log('info', `Updated machineConfiguration.bridge to ${state.newBridge}`)
      }

      // 6. If VM is running, perform hot-swap
      if (state.wasRunning && state.tapDevice) {
        // 6a. Change TAP device to new bridge if bridges are different
        if (state.oldBridge && state.oldBridge !== state.newBridge) {
          debug.log('info', `Hot-swapping TAP ${state.tapDevice} from ${state.oldBridge} to ${state.newBridge}`)

          await this.tapManager.detachFromBridge(state.tapDevice)
          await this.tapManager.attachToBridge(state.tapDevice, state.newBridge)

          state.networkChanged = true
          debug.log('info', `TAP ${state.tapDevice} successfully moved to ${state.newBridge}`)
        }

        // 6b. Apply firewall rules from new department
        // applyVMRules uses the current departmentId from DB, which we already updated
        try {
          await this.firewallOrchestration.applyVMRules(vmId)
          state.firewallChanged = true
          debug.log('info', `Firewall rules from new department applied to VM ${vmId}`)
        } catch (fwError) {
          // Firewall failure should not block the move, but log warning
          debug.log('warn', `Failed to apply firewall rules: ${fwError}`)
        }
      } else {
        debug.log('info', `VM ${vmId} is not running, network/firewall changes will apply on next start`)
      }

      return {
        success: true,
        hotSwapPerformed: state.wasRunning,
        networkChanged: state.networkChanged,
        firewallChanged: state.firewallChanged
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('error', `Move failed for VM ${vmId}: ${errorMessage}`)

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
    debug.log('info', `Attempting rollback for VM ${state.vmId}...`)

    // 1. Rollback network changes
    if (state.networkChanged && state.tapDevice && state.oldBridge) {
      try {
        await this.tapManager.detachFromBridge(state.tapDevice)
        await this.tapManager.attachToBridge(state.tapDevice, state.oldBridge)
        debug.log('info', `Rolled back TAP ${state.tapDevice} to ${state.oldBridge}`)
      } catch (e) {
        debug.log('error', `Failed to rollback network: ${e}`)
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
          debug.log('info', 'Rolled back machineConfiguration.bridge')
        }
      } catch (e) {
        debug.log('error', `Failed to rollback configuration: ${e}`)
      }
    }

    // 3. Rollback database (departmentId)
    if (state.dbUpdated && state.oldDepartmentId) {
      try {
        await this.prisma.machine.update({
          where: { id: state.vmId },
          data: { departmentId: state.oldDepartmentId }
        })
        debug.log('info', 'Rolled back machine.departmentId')
      } catch (e) {
        debug.log('error', `Failed to rollback database: ${e}`)
      }
    }

    // 4. Re-apply old firewall rules if we changed them
    if (state.firewallChanged) {
      try {
        // After rolling back departmentId, applyVMRules will use the old department
        await this.firewallOrchestration.applyVMRules(state.vmId)
        debug.log('info', 'Rolled back firewall rules')
      } catch (e) {
        debug.log('error', `Failed to rollback firewall: ${e}`)
      }
    }

    debug.log('info', `Rollback completed for VM ${state.vmId}`)
  }
}
