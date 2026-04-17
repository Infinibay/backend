import logger from '@main/logger'
import { PrismaClient, RuleSetType } from '@prisma/client'

import { BaseEventManager } from './base/BaseEventManager'
import { EventAction, EventPayload } from './EventManager'
import { SocketService } from './SocketService'

/**
 * Firewall Event Manager - handles firewall rule change events
 * Sends real-time updates when firewall rules are created, updated, or deleted
 */
export class FirewallEventManager extends BaseEventManager {

  constructor (socketService: SocketService, prisma: PrismaClient) {
    super(socketService, prisma)
  }

  // ============================================
  // Abstract method implementations
  // ============================================

  protected getResourceName (): string {
    return 'firewall'
  }

  protected async fetchResourceData (ruleData: any): Promise<any | null> {
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
      logger.error('Error fetching firewall rule data:', error)
      return null
    }
  }

  protected async getTargetUsers (rule: any, action: EventAction): Promise<string[]> {
    // FirewallEventManager doesn't use the standard target users pattern
    // It determines targets based on entity type (department/VM) in handleEvent
    // This method is required by abstract base but not used directly
    return []
  }

  // ============================================
  // Override handleEvent for firewall-specific entity-based routing
  // ============================================

  async handleEvent (action: EventAction, ruleData: any, triggeredBy?: string): Promise<void> {
    try {
      logger.info(`🛡️ Handling firewall event: ${action}`, { ruleId: ruleData?.id, triggeredBy })

      // Get complete rule data with rule set information
      const rule = await this.fetchResourceData(ruleData)
      if (!rule) {
        logger.warn(`⚠️ Firewall rule not found for event: ${ruleData?.id}`)
        return
      }

      // Determine the entity type (department or VM)
      const entityType = rule.ruleSet.entityType
      const entityId = rule.ruleSet.entityId

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsersForEntity(entityType, entityId)

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

      // Send event to each target user using inherited helper
      this.sendToTargetUsers(targetUsers, 'firewall', eventAction, payload)

      logger.info(`✅ Firewall event sent to ${targetUsers.length} users: ${eventAction}`)
    } catch (error) {
      logger.error(`❌ Error handling firewall event ${action}:`, error)
      throw error
    }
  }

  // ============================================
  // Firewall-specific helper for entity-based targeting
  // ============================================

  private async getTargetUsersForEntity (entityType: RuleSetType, entityId: string): Promise<string[]> {
    try {
      const targetUsers: Set<string> = new Set()

      // 1. Always include all admin users
      const adminIds = await this.getAdminUsers()
      adminIds.forEach(id => targetUsers.add(id))

      if (entityType === RuleSetType.DEPARTMENT) {
        // 2. For department rules: include users with VMs in this department
        const deptUserIds = await this.getDepartmentUsers(entityId)
        deptUserIds.forEach(id => targetUsers.add(id))
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
      logger.error('Error determining target users for firewall event:', error)
      return []
    }
  }
}
