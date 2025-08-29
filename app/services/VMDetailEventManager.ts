import { SocketService, getSocketService } from './SocketService'
import { PrismaClient } from '@prisma/client'
import Debug from 'debug'

const debug = Debug('infinibay:vm-detail-events')

export interface VMDetailEventData {
  machineId: string
  [key: string]: any
}

export class VMDetailEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.socketService = getSocketService()
  }

  /**
   * Emit an event to the owner of a VM
   */
  private async emitToVMOwner (
    machineId: string,
    eventType: string,
    data: any,
    userId?: string
  ): Promise<void> {
    try {
      // Get machine owner if not provided
      let targetUserId = userId
      if (!targetUserId) {
        const machine = await this.prisma.machine.findUnique({
          where: { id: machineId },
          select: { userId: true }
        })
        targetUserId = machine?.userId || undefined
      }

      if (!targetUserId) {
        debug(`No user ID found for machine ${machineId}, skipping event`)
        return
      }

      // Send event to user
      this.socketService.sendToUser(targetUserId, 'vm', eventType, {
        data: {
          machineId,
          ...data
        }
      })

      debug(`📡 Emitted vm:${eventType} event for machine ${machineId} to user ${targetUserId}`)
    } catch (error) {
      debug(`Failed to emit event: ${error}`)
    }
  }

  // Process Events
  async emitProcessKilled (machineId: string, pid: number, processName?: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'process:killed', { pid, processName }, userId)
  }

  async emitProcessesKilled (machineId: string, processes: Array<{ pid: number; processName?: string }>, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'processes:killed', { processes }, userId)
  }

  // Service Events
  async emitServiceStatusChanged (machineId: string, serviceName: string, action: string, newStatus?: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, `service:${action.toLowerCase()}`, {
      serviceName,
      action,
      newStatus
    }, userId)
  }

  // Package Events
  async emitPackageInstalling (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:installing', { packageName }, userId)
  }

  async emitPackageInstalled (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:installed', { packageName, success: true }, userId)
  }

  async emitPackageRemoving (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:removing', { packageName }, userId)
  }

  async emitPackageRemoved (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:removed', { packageName, success: true }, userId)
  }

  async emitPackageUpdating (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:updating', { packageName }, userId)
  }

  async emitPackageUpdated (machineId: string, packageName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'package:updated', { packageName, success: true }, userId)
  }

  // Firewall Events
  async emitFirewallTemplateApplied (machineId: string, template: string, state: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'firewall:template:applied', { template, state }, userId)
  }

  async emitFirewallTemplateRemoved (machineId: string, template: string, state: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'firewall:template:removed', { template, state }, userId)
  }

  async emitFirewallRuleCreated (machineId: string, rule: any, state: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'firewall:rule:created', { rule, state }, userId)
  }

  async emitFirewallRuleRemoved (machineId: string, ruleId: string, state: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'firewall:rule:removed', { ruleId, state }, userId)
  }

  // Snapshot Events
  async emitSnapshotCreated (machineId: string, snapshot: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'snapshot:created', { snapshot }, userId)
  }

  async emitSnapshotRestored (machineId: string, snapshotName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'snapshot:restored', { snapshotName }, userId)
  }

  async emitSnapshotDeleted (machineId: string, snapshotName: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'snapshot:deleted', { snapshotName }, userId)
  }

  // VM Operation Events
  async emitVMRestarting (machineId: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'restarting', {}, userId)
  }

  async emitVMRestarted (machineId: string, status: string = 'running', userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'restarted', { status }, userId)
  }

  async emitVMForcedPowerOff (machineId: string, status: string = 'shutoff', userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'forced:poweroff', { status }, userId)
  }

  async emitVMReset (machineId: string, status: string = 'running', userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'reset', { status }, userId)
  }

  // Metrics Events
  async emitMetricsUpdated (machineId: string, metrics: any, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'metrics:updated', { metrics }, userId)
  }

  // Status Events
  async emitStatusChanged (machineId: string, status: string, previousStatus?: string, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'status:changed', { status, previousStatus }, userId)
  }

  // Alert Events
  async emitCriticalAlert (machineId: string, message: string, timestamp?: Date, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'alert:critical', {
      message,
      timestamp: timestamp || new Date()
    }, userId)
  }

  async emitWarningAlert (machineId: string, message: string, timestamp?: Date, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'alert:warning', {
      message,
      timestamp: timestamp || new Date()
    }, userId)
  }

  async emitInfoAlert (machineId: string, message: string, timestamp?: Date, userId?: string): Promise<void> {
    await this.emitToVMOwner(machineId, 'alert:info', {
      message,
      timestamp: timestamp || new Date()
    }, userId)
  }
}

// Singleton instance
let vmDetailEventManager: VMDetailEventManager | null = null

export const createVMDetailEventManager = (prisma: PrismaClient): VMDetailEventManager => {
  if (!vmDetailEventManager) {
    vmDetailEventManager = new VMDetailEventManager(prisma)
  }
  return vmDetailEventManager
}

export const getVMDetailEventManager = (): VMDetailEventManager => {
  if (!vmDetailEventManager) {
    throw new Error('VMDetailEventManager not initialized. Call createVMDetailEventManager first.')
  }
  return vmDetailEventManager
}
