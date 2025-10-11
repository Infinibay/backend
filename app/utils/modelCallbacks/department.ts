import { PrismaClient, Prisma, RuleSetType } from '@prisma/client'
import { getLibvirtConnection } from '@utils/libvirt'
import { FirewallManager } from '@services/firewall/FirewallManager'
import { Debugger } from '@utils/debug'

const debug = new Debugger('infinibay:callback:department')

/**
 * Callback executed after a department is created in the database.
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
 * - Future: Consider implementing a cleanup job to remove orphaned filters
 *
 * This callback creates the FirewallRuleSet and establishes the foreign key relationship
 * by updating Department.firewallRuleSetId. This ensures subsequent queries with
 * include: { firewallRuleSet } will find the ruleset.
 *
 * @param prisma - Prisma client instance
 * @param args - Creation arguments
 * @param result - Created department record
 */
export async function afterCreateDepartment (
  prisma: PrismaClient,
  args: Prisma.DepartmentCreateArgs,
  result: any
): Promise<void> {
  const departmentId = result.id
  const departmentName = result.name

  try {
    debug.log('info', `Creating firewall infrastructure for department ${departmentId} (${departmentName})`)

    // Get libvirt connection
    const libvirt = await getLibvirtConnection()

    // Create FirewallManager instance
    const firewallManager = new FirewallManager(prisma, libvirt)

    // Create firewall infrastructure (ruleset + empty nwfilter)
    debug.log('info', `Calling ensureFirewallInfrastructure for department ${departmentId}`)
    const infraResult = await firewallManager.ensureFirewallInfrastructure(
      RuleSetType.DEPARTMENT,
      departmentId,
      `Department Firewall: ${departmentName}`
    )

    debug.log('info', `Firewall infrastructure result: ruleSetCreated=${infraResult.ruleSetCreated}, filterCreated=${infraResult.filterCreated}`)

    // Verify the FK was set
    const updatedDept = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { firewallRuleSetId: true }
    })

    if (!updatedDept?.firewallRuleSetId) {
      debug.log('warn', `WARNING: FirewallRuleSet created but foreign key not set for department ${departmentId}, attempting self-heal`)

      // Self-heal: Find the ruleset by entityType and entityId
      const orphanedRuleSet = await prisma.firewallRuleSet.findFirst({
        where: {
          entityType: RuleSetType.DEPARTMENT,
          entityId: departmentId
        }
      })

      if (orphanedRuleSet) {
        await prisma.department.update({
          where: { id: departmentId },
          data: { firewallRuleSetId: orphanedRuleSet.id }
        })
        debug.log('info', `Self-healed: linked ruleset ${orphanedRuleSet.id} to department ${departmentId}`)
      } else {
        debug.log('error', `Self-heal failed: no ruleset found for department ${departmentId}`)
      }
    } else {
      debug.log('info', `Firewall infrastructure created and linked for department ${departmentId}`)
    }
  } catch (error) {
    // Log error but don't fail the department creation
    const errorMessage = (error as Error).message
    debug.log('error', `Failed to create firewall for department ${departmentId} (${departmentName}): ${errorMessage}`)
    debug.log('error', (error as Error).stack || 'No stack trace available')
    // Continue - the firewall can be created later via manual resync if needed
  }
}
