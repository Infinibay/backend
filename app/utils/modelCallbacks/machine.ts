import { PrismaClient, Prisma } from '@prisma/client'
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
 * **IMPORTANT: Firewall infrastructure is now created AFTER the transaction commits.**
 *
 * Previously, this callback tried to create firewall infrastructure during the transaction,
 * which caused transaction timeouts (5s limit) because:
 * 1. Connecting to libvirt takes time
 * 2. Creating department firewall infrastructure can take 5+ seconds
 * 3. The VM record isn't visible outside the transaction until commit
 *
 * Firewall infrastructure is now created in backgroundCode (machineLifecycleService.ts)
 * after the transaction completes successfully.
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
  // No-op: Firewall infrastructure is created in backgroundCode after transaction commits.
  // See machineLifecycleService.ts -> backgroundCode()
  debug.log('info', `VM ${result.id} (${result.name}) created - firewall will be set up in background`)
}
