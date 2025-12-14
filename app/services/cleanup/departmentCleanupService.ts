import { PrismaClient } from '@prisma/client'
import { TapDeviceManager, generateVMChainName } from '@infinibay/infinivirt'

import { Debugger } from '../../utils/debug'
import { DepartmentNetworkService } from '../network/DepartmentNetworkService'
import { getInfinivirt } from '../InfinivirtService'

interface OrphanedResource {
  vmId: string
  vmName: string
  internalName: string
  tapDevice?: string
  nftablesChain?: string
}

export class DepartmentCleanupService {
  private prisma: PrismaClient
  private debug = new Debugger('department-cleanup-service')

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Cleans up a department and all associated resources
   * NOTE: This requires that all VMs in the department have been deleted first
   *
   * Note: With nftables, firewall chains are per-VM, not per-department.
   * Department cleanup only involves database records (FirewallRuleSet).
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

    // Verify no orphaned VM resources exist
    this.debug.log('Verifying no orphaned VM resources exist')

    let orphanedResources: OrphanedResource[]
    try {
      orphanedResources = await Promise.race([
        this.checkOrphanedVMResources(departmentId),
        new Promise<OrphanedResource[]>((_, reject) =>
          setTimeout(() => reject(new Error('Orphaned resource check timed out after 10 seconds')), 10000)
        )
      ])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.debug.log('error', `Orphaned resource validation failed: ${errorMessage}`)
      throw new Error(
        `Cannot delete department: Orphaned-resource validation failed or timed out.\n\n` +
        `Error: ${errorMessage}\n\n` +
        'The department cannot be safely deleted because we could not verify that all VM resources have been cleaned up. ' +
        'Please try again, or contact support if the issue persists.'
      )
    }

    if (orphanedResources.length > 0) {
      const resourceList = orphanedResources.map(r => {
        const items: string[] = []
        if (r.tapDevice) items.push(`  - TAP device: ${r.tapDevice} (still exists)`)
        if (r.nftablesChain) items.push(`  - Nftables chain: ${r.nftablesChain} (still exists)`)
        return `VM: ${r.vmName} (${r.vmId})\n${items.join('\n')}`
      }).join('\n\n')

      throw new Error(
        `Cannot delete department: Found ${orphanedResources.length} orphaned VM resource(s) that must be cleaned up first:\n\n` +
        resourceList + '\n\n' +
        'These resources indicate VMs were not properly destroyed. Please run cleanup manually or contact support.'
      )
    }

    this.debug.log('Orphaned resource check passed')

    // Destroy network infrastructure (bridge, dnsmasq, NAT)
    if (department.bridgeName) {
      try {
        const networkService = new DepartmentNetworkService(this.prisma)
        await networkService.destroyNetwork(departmentId)
        this.debug.log(`Destroyed network infrastructure for department ${departmentId}`)
      } catch (networkError) {
        this.debug.log(`Warning: Failed to destroy network for department ${departmentId}: ${String(networkError)}`)
        // Continue with deletion - network might already be partially destroyed
      }
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

  /**
   * Checks for orphaned VM resources (TAP devices, nftables chains) in a department.
   * These resources would exist if VMs were removed from the database but their
   * infrastructure resources were not properly cleaned up.
   *
   * IMPORTANT LIMITATION: This method can only detect orphaned resources for VMs that
   * still have database records. If a VM was deleted from the database but left behind
   * OS-level resources (TAP devices, nftables chains), this method CANNOT detect them
   * because there is no audit trail or history of deleted VMs. In such cases, orphaned
   * resources must be detected and cleaned up through other means (e.g., system-wide
   * orphaned resource scans, manual inspection, or infrastructure monitoring).
   *
   * @param departmentId - The department to check
   * @returns Array of orphaned resources found (only for VMs still in DB)
   */
  private async checkOrphanedVMResources (departmentId: string): Promise<OrphanedResource[]> {
    this.debug.log(`Checking for orphaned VM resources in department ${departmentId}`)

    // Get all VMs that belong(ed) to this department (including configuration for TAP device name)
    const machines = await this.prisma.machine.findMany({
      where: { departmentId },
      include: { configuration: true }
    })

    if (machines.length === 0) {
      // IMPORTANT: When no machines exist in the database, we cannot detect true DB-orphaned
      // resources (i.e., OS-level resources left behind by VMs that were already deleted from
      // the database). This is a known limitation - there is no audit/history table that tracks
      // deleted VMs and their associated resource identifiers (VM IDs, TAP device names).
      this.debug.log(
        'warn',
        `No VMs found in department ${departmentId}. Orphaned resource check is skipped. ` +
        'Note: This mechanism cannot detect OS-level orphans (TAP devices, nftables chains) ' +
        'for VMs that have already been deleted from the database without a corresponding history record.'
      )
      return []
    }

    const orphanedResources: OrphanedResource[] = []
    let infinivirt
    let nftablesService
    let tapManager

    try {
      infinivirt = await getInfinivirt()
      nftablesService = infinivirt.getNftablesService()
      tapManager = new TapDeviceManager()
    } catch (error) {
      this.debug.log('warn', `Failed to initialize infinivirt for orphaned resource check: ${String(error)}`)
      // If we can't check, assume no orphaned resources and allow the operation
      return []
    }

    for (const machine of machines) {
      this.debug.log(`Checking VM ${machine.name} (${machine.id})`)

      const orphaned: OrphanedResource = {
        vmId: machine.id,
        vmName: machine.name,
        internalName: machine.internalName
      }

      // Check nftables chain
      const chainName = generateVMChainName(machine.id)
      this.debug.log(`Checking nftables chain: ${chainName}`)

      try {
        const chainExists = await nftablesService.chainExists(chainName)
        this.debug.log(`Chain ${chainName} exists: ${chainExists}`)
        if (chainExists) {
          orphaned.nftablesChain = chainName
        }
      } catch (error) {
        this.debug.log('warn', `Error checking nftables chain ${chainName}: ${String(error)}`)
        // Continue checking other resources
      }

      // Check TAP device (if tapDeviceName is known)
      const tapDeviceName = machine.configuration?.tapDeviceName
      if (tapDeviceName) {
        this.debug.log(`Checking TAP device: ${tapDeviceName}`)

        try {
          const tapExists = await tapManager.exists(tapDeviceName)
          this.debug.log(`TAP device ${tapDeviceName} exists: ${tapExists}`)
          if (tapExists) {
            orphaned.tapDevice = tapDeviceName
          }
        } catch (error) {
          this.debug.log('warn', `Error checking TAP device ${tapDeviceName}: ${String(error)}`)
          // Continue checking other resources
        }
      }

      // Only add to orphaned list if we found any orphaned resources
      if (orphaned.nftablesChain || orphaned.tapDevice) {
        orphanedResources.push(orphaned)
      }
    }

    if (orphanedResources.length === 0) {
      this.debug.log(`No orphaned resources found in department ${departmentId}`)
    } else {
      this.debug.log(`Found ${orphanedResources.length} orphaned resource(s) in department ${departmentId}`)
    }

    return orphanedResources
  }
}
