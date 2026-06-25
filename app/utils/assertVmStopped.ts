/**
 * FAIL-CLOSED guard for qemu-img operations (snapshot / backup / restore) that
 * require an exclusive qcow2 write lock.
 *
 * The DB `Machine.status` column is set by lifecycle events and can drift from
 * reality (crash before the status write, externally-started VM, race with a
 * power-on). The authoritative signal is the live process probe via
 * VMOperationsService.getStatus() -> infinization.getVMStatus(). Running qemu-img
 * against a live, write-locked qcow2 corrupts the image, so this guard throws
 * unless the VM is *provably* stopped.
 */
import { PrismaClient } from '@prisma/client'
import { VMOperationsService } from '@services/VMOperationsService'

/** Thrown when a VM is (or might be) running and a write-lock-sensitive disk op is requested. */
export class VmRunningError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'VmRunningError'
  }
}

/**
 * Throws VmRunningError if the VM is running OR if the live status probe is
 * unavailable (null/undefined). We must NOT touch the disk when liveness is
 * unknown — failing open here is exactly how a running qemu corrupts the qcow2.
 *
 * @param prisma     Prisma client (callers always have one in scope)
 * @param machineId  DB machine id
 * @param vmName     optional friendly name for the error message
 * @param vmOps      optional injected service (tests); defaults to a new VMOperationsService
 */
export async function assertVmStopped (
  prisma: PrismaClient,
  machineId: string,
  vmName?: string,
  vmOps?: Pick<VMOperationsService, 'getStatus'>
): Promise<void> {
  const ops = vmOps ?? new VMOperationsService(prisma)
  const status = await ops.getStatus(machineId)
  const label = vmName ? `"${vmName}"` : machineId

  // FAIL CLOSED: a null/undefined probe means we could not determine liveness.
  if (!status) {
    throw new VmRunningError(
      `Cannot verify that VM ${label} is stopped (status probe unavailable). ` +
      'Refusing to run disk operation to avoid qcow2 corruption. Stop the VM and retry.'
    )
  }

  // `!== false` (not `=== true`) is deliberate: if processAlive is ever undefined
  // inside a non-null object, fail closed.
  if (status.processAlive !== false) {
    throw new VmRunningError(
      `VM ${label} is running (processAlive=${String(status.processAlive)}). ` +
      'Stop the VM before snapshot/backup/restore to avoid qcow2 write-lock corruption.'
    )
  }
}
