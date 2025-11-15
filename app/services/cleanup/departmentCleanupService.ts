import { PrismaClient, RuleSetType } from '@prisma/client'
import { Connection } from '@infinibay/libvirt-node'
import * as libvirtNode from '@infinibay/libvirt-node'

import { Debugger } from '../../utils/debug'
import { NWFilterXMLGeneratorService } from '../firewall/NWFilterXMLGeneratorService'
import { getLibvirtConnection } from '../../utils/libvirt'

// Access NWFilter from module to work around TypeScript typing
const NWFilter = (libvirtNode as any).NWFilter

export class DepartmentCleanupService {
  private prisma: PrismaClient
  private debug = new Debugger('department-cleanup-service')

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Cleans up a department and all associated resources
   * NOTE: This requires that all VMs in the department have been deleted first
   */
  async cleanupDepartment (departmentId: string): Promise<void> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        machines: true,
        firewallRuleSet: {
          include: {
            rules: true
          }
        }
      }
    })

    if (!department) {
      this.debug.log(`Department ${departmentId} not found`)
      return
    }

    // Ensure no machines exist in the department
    if (department.machines.length > 0) {
      throw new Error(`Cannot cleanup department ${departmentId}: ${department.machines.length} VMs still exist`)
    }

    // Libvirt cleanup - remove department nwfilter
    try {
      const conn = await getLibvirtConnection()
      await this.cleanupDepartmentFirewallFilter(conn, departmentId)
    } catch (e) {
      this.debug.log(`Error cleaning up libvirt resources: ${String(e)}`)
    }

    // Remove DB records in correct order
    await this.prisma.$transaction(async tx => {
      try {
        // Delete firewall rules and ruleset (if exists)
        await this.cleanupFirewallRuleSet(tx, department.firewallRuleSetId)

        // Delete department
        await tx.department.delete({ where: { id: departmentId } })

        this.debug.log(`Successfully cleaned up department ${departmentId}`)
      } catch (e) {
        this.debug.log(`Error removing DB records: ${String(e)}`)
        throw e
      }
    })
  }

  /**
   * Cleans up the department's nwfilter from libvirt
   * @param conn - Libvirt connection
   * @param departmentId - Department ID
   */
  private async cleanupDepartmentFirewallFilter (conn: Connection, departmentId: string): Promise<void> {
    try {
      const xmlGenerator = new NWFilterXMLGeneratorService()
      const filterName = xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, departmentId)

      // Try to lookup and undefine the filter
      const filter = NWFilter.lookupByName(conn, filterName)

      if (filter) {
        try {
          filter.undefine()
          this.debug.log(`Successfully removed nwfilter ${filterName}`)
        } catch (e) {
          this.debug.log(`Error undefining nwfilter ${filterName}: ${String(e)}`)
        }
      } else {
        this.debug.log(`NWFilter ${filterName} not found (may have been already deleted)`)
      }
    } catch (e) {
      // Filter doesn't exist or error looking it up - not critical
      this.debug.log(`Note: Could not cleanup nwfilter for department ${departmentId}: ${String(e)}`)
    }
  }

  /**
   * Cleans up the department's FirewallRuleSet and all associated rules from database
   * @param tx - Prisma transaction client
   * @param ruleSetId - FirewallRuleSet ID (can be null)
   */
  private async cleanupFirewallRuleSet (tx: any, ruleSetId: string | null): Promise<void> {
    if (!ruleSetId) {
      return
    }

    try {
      // Delete all rules in the rule set (cascading will handle this, but explicit is clearer)
      await tx.firewallRule.deleteMany({
        where: { ruleSetId }
      })

      // Delete the rule set itself
      // Department.firewallRuleSetId will be set to null automatically via onDelete: SetNull
      await tx.firewallRuleSet.delete({
        where: { id: ruleSetId }
      })

      this.debug.log(`Cleaned up FirewallRuleSet ${ruleSetId}`)
    } catch (e) {
      this.debug.log(`Error cleaning up FirewallRuleSet: ${String(e)}`)
      // Don't throw - allow department deletion to proceed even if firewall cleanup fails
    }
  }
}
