import { PrismaClient, RuleSetType } from '@prisma/client'

import { EventAction, EventPayload, ResourceEventManager } from './EventManager'
import { SocketService } from './SocketService'

/**
 * Firewall Event Manager - handles firewall rule change events
 * Sends real-time updates when firewall rules are created, updated, or deleted
 */
export class FirewallEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  /**
   * Main event handler for firewall events
   * @param action - The action performed (create, update, delete)
   * @param ruleData - The firewall rule data or rule ID
   * @param triggeredBy - User ID who triggered the event (optional)
   */
  async handleEvent (action: EventAction, ruleData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`🛡️ Handling firewall event: ${action}`, { ruleId: ruleData?.id, triggeredBy })

      // Get complete rule data with rule set information
      const rule = await this.getRuleData(ruleData)
      if (!rule) {
        console.warn(`⚠️ Firewall rule not found for event: ${ruleData?.id}`)
        return
      }

      // Determine the entity type (department or VM)
      const entityType = rule.ruleSet.entityType
      const entityId = rule.ruleSet.entityId

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(entityType, entityId)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: {
          ruleId: rule.id,
          ruleName: rule.name,
          ...(entityType === RuleSetType.DEPARTMENT
            ? { departmentId: entityId }
            : { vmId: entityId })
        }
      }

      // Determine the correct event name based on entity type
      // Convert action to past tense to match frontend expectations
      const actionPastTense = action === 'create' ? 'created' : action === 'update' ? 'updated' : action === 'delete' ? 'deleted' : action
      const eventAction = entityType === RuleSetType.DEPARTMENT
        ? `rule:${actionPastTense}:department`
        : `rule:${actionPastTense}`

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'firewall', eventAction, payload)
      }

      console.log(`✅ Firewall event sent to ${targetUsers.length} users: ${eventAction}`)
    } catch (error) {
      console.error(`❌ Error handling firewall event ${action}:`, error)
      throw error
    }
  }

  /**
   * Get complete rule data from database
   */
  private async getRuleData (ruleData: any): Promise<any> {
    try {
      // If we already have complete data with ruleSet, use it
      if (ruleData && typeof ruleData === 'object' && ruleData.ruleSet) {
        return ruleData
      }

      // If we only have an ID, fetch from database
      const ruleId = typeof ruleData === 'string' ? ruleData : ruleData?.id
      if (!ruleId) {
        return null
      }

      const rule = await this.prisma.firewallRule.findUnique({
        where: { id: ruleId },
        include: {
          ruleSet: true
        }
      })

      return rule
    } catch (error) {
      console.error('Error fetching firewall rule data:', error)
      return null
    }
  }

  /**
   * Determine which users should receive this firewall event
   * For department rules: all users who can access VMs in that department
   * For VM rules: all users who can access that specific VM
   */
  private async getTargetUsers (entityType: RuleSetType, entityId: string): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          deleted: false
        },
        select: { id: true }
      })

      adminUsers.forEach(admin => targetUsers.add(admin.id))

      if (entityType === RuleSetType.DEPARTMENT) {
        // 2. For department rules: include users with VMs in this department
        const usersWithVMsInDept = await this.prisma.user.findMany({
          where: {
            deleted: false,
            VM: {
              some: {
                departmentId: entityId
              }
            }
          },
          select: { id: true }
        })

        usersWithVMsInDept.forEach(user => targetUsers.add(user.id))
      } else {
        // 3. For VM rules: include the owner of the VM
        const vm = await this.prisma.machine.findUnique({
          where: { id: entityId },
          select: { userId: true }
        })

        if (vm?.userId) {
          targetUsers.add(vm.userId)
        }
      }

      return Array.from(targetUsers)
    } catch (error) {
      console.error('Error determining target users for firewall event:', error)
      return []
    }
  }
}
