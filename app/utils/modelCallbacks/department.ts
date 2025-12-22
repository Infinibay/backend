import { PrismaClient, Prisma, RuleSetType } from '@prisma/client'
import { FirewallManagerV2 } from '@services/firewall/FirewallManagerV2'
import { Debugger } from '@utils/debug'

const debug = new Debugger('infinibay:callback:department')

/**
 * Callback executed after a department is created in the database.
 *
 * This callback creates the FirewallRuleSet (database record only) and establishes
 * the foreign key relationship by updating Department.firewallRuleSetId.
 *
 * Note: nftables chains are created by infinization during VM startup, not here.
 * The ruleset serves as the database container for firewall rules that will be
 * applied when VMs in this department start.
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

    // Create FirewallManagerV2 instance (nftables-based, no libvirt needed)
    const firewallManager = new FirewallManagerV2(prisma)

    // Create firewall infrastructure (database ruleset only)
    debug.log('info', `Calling ensureFirewallInfrastructure for department ${departmentId}`)
    const infraResult = await firewallManager.ensureFirewallInfrastructure(
      RuleSetType.DEPARTMENT,
      departmentId,
      `Department Firewall: ${departmentName}`
    )

    debug.log('info', `Firewall infrastructure result: ruleSetCreated=${infraResult.ruleSetCreated}`)

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
