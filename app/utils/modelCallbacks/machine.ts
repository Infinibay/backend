import { PrismaClient, Prisma, RuleSetType } from '@prisma/client'
import { getLibvirtConnection } from '@utils/libvirt'
import { FirewallManager } from '@services/firewall/FirewallManager'
import { Debugger } from '@utils/debug'

const debug = new Debugger('infinibay:callback:machine')

export async function beforeCreateMachine (
  prisma: PrismaClient,
  args: Prisma.MachineCreateArgs
): Promise<void> {
  // No pre-creation actions needed
}

/**
 * Callback executed after a VM (machine) is created in the database.
 *
 * **TRANSACTION SIDE-EFFECTS WARNING:**
 *
 * This callback performs external side-effects (creating libvirt nwfilters) within
 * a database transaction context. If the transaction rolls back after this callback
 * executes, the libvirt filters will remain orphaned.
 *
 * **Mitigation:**
 * - Errors are caught and logged without throwing (graceful degradation)
 * - Libvirt defineFilter is idempotent (safe to call multiple times)
 * - ensureFirewallForVM serves as a fallback to detect/repair missing filters
 * - VM filters reference department filters via <filterref> (inheritance)
 * - Future: Consider implementing a cleanup job to remove orphaned filters
 *
 * **Execution Order:**
 * This callback runs AFTER the VM record is inserted into the database but BEFORE
 * createMachineService defines the VM in libvirt. This ensures filters exist when
 * the VM domain XML is defined.
 *
 * This callback creates the FirewallRuleSet and establishes the foreign key relationship
 * by updating Machine.firewallRuleSetId. This ensures subsequent queries with
 * include: { firewallRuleSet } will find the ruleset.
 *
 * @param prisma - Prisma client instance
 * @param args - Creation arguments
 * @param result - Created VM record
 */
export async function afterCreateMachine (
  prisma: PrismaClient,
  args: Prisma.MachineCreateArgs,
  result: any
): Promise<void> {
  const vmId = result.id
  const vmName = result.name
  const departmentId = result.departmentId

  // Validate that VM has a department
  if (!departmentId) {
    debug.log('warn', `VM ${vmId} (${vmName}) has no department, skipping firewall initialization`)
    return
  }

  try {
    debug.log('info', `Creating firewall infrastructure for VM ${vmId} (${vmName})`)

    // Get libvirt connection
    const libvirt = await getLibvirtConnection()

    // Create FirewallManager instance
    const firewallManager = new FirewallManager(prisma, libvirt)

    // Ensure department has firewall infrastructure first (handles old departments)
    const dept = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { firewallRuleSet: true }
    })

    if (dept && !dept.firewallRuleSet) {
      debug.log('info', `Department ${departmentId} has no ruleset, creating as fallback`)
      await firewallManager.ensureFirewallInfrastructure(
        RuleSetType.DEPARTMENT,
        departmentId,
        `Department Firewall: ${dept.name}`
      )
    }

    // Create VM firewall infrastructure (ruleset + empty nwfilter with dept inheritance)
    debug.log('info', `Calling ensureFirewallInfrastructure for VM ${vmId}`)
    const infraResult = await firewallManager.ensureFirewallInfrastructure(
      RuleSetType.VM,
      vmId,
      `VM Firewall: ${vmName}`
    )

    debug.log('info', `Firewall infrastructure result: ruleSetCreated=${infraResult.ruleSetCreated}, filterCreated=${infraResult.filterCreated}`)

    // Verify the FK was set
    const updatedMachine = await prisma.machine.findUnique({
      where: { id: vmId },
      select: { firewallRuleSetId: true }
    })

    if (!updatedMachine?.firewallRuleSetId) {
      debug.log('warn', `WARNING: FirewallRuleSet created but foreign key not set for VM ${vmId}, attempting self-heal`)

      // Self-heal: Find the ruleset by entityType and entityId
      const orphanedRuleSet = await prisma.firewallRuleSet.findFirst({
        where: {
          entityType: RuleSetType.VM,
          entityId: vmId
        }
      })

      if (orphanedRuleSet) {
        await prisma.machine.update({
          where: { id: vmId },
          data: { firewallRuleSetId: orphanedRuleSet.id }
        })
        debug.log('info', `Self-healed: linked ruleset ${orphanedRuleSet.id} to VM ${vmId}`)
      } else {
        debug.log('error', `Self-heal failed: no ruleset found for VM ${vmId}`)
      }
    } else {
      debug.log('info', `Firewall infrastructure created and linked for VM ${vmId}`)
    }
  } catch (error) {
    // Log error but don't fail the VM creation
    const errorMessage = (error as Error).message
    debug.log('error', `Failed to create firewall for VM ${vmId} (${vmName}) in department ${departmentId}: ${errorMessage}`)
    debug.log('error', (error as Error).stack || 'No stack trace available')
    // Continue - the firewall can be created later via ensureFirewallForVM if needed
  }
}
