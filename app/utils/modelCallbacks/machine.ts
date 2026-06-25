import logger from '@main/logger'
import { PrismaClient, Prisma } from '@prisma/client'

const debug = logger.child({ module: 'callback:machine' })

/**
 * Intentional no-op hooks registered on the Prisma `machine.create` client
 * extension (see utils/modelsCallbacks.ts). They are kept as extension points but
 * MUST NOT do real work inside the create transaction: side-effects there are not
 * rolled back if the transaction fails. All post-create orchestration (firewall,
 * QEMU, etc.) runs in machineLifecycleService.backgroundCode() AFTER the commit.
 */
export async function beforeCreateMachine (
  _prisma: PrismaClient,
  _args: Prisma.MachineCreateArgs
): Promise<void> {
  // Intentionally empty — no pre-create work.
}

export async function afterCreateMachine (
  _prisma: PrismaClient,
  _args: Prisma.MachineCreateArgs,
  result: any
): Promise<void> {
  // Intentionally a no-op beyond this trace line — firewall/QEMU setup happens
  // post-commit in machineLifecycleService.backgroundCode().
  debug.info(`VM ${result.id} (${result.name}) created - setup will run in background`)
}
