/**
 * Shared machine status constants — single source of truth.
 *
 * Reflects the canonical Machine.status enum (QEMU process state).
 * Independent from MachineConfiguration.setupComplete (OS install + first
 * infiniservice handshake), which is the orthogonal "is the OS ready" flag.
 */

export { MachineStatus } from '../graphql/resolvers/machine/type'

export const OFF_STATUS = 'off' as const
export const STARTING_STATUS = 'starting' as const
export const RUNNING_STATUS = 'running' as const
export const SUSPENDED_STATUS = 'suspended' as const
export const PAUSED_STATUS = 'paused' as const
export const UPDATING_HARDWARE_STATUS = 'updating_hardware' as const
export const POWERING_OFF_UPDATE_STATUS = 'powering_off_update' as const
// Transient lock held by NonPersistentResetService while a pool desktop's
// qcow2 delta is being wiped + rebuilt from its golden image. Excluded from
// the pool checkout path so a half-rebuilt disk is never handed to a user.
export const REBUILDING_STATUS = 'rebuilding' as const
// Transient backend-side "status-as-lock" markers. These are not QEMU states:
// they claim a VM row so a multi-step backend flow (delete / department move)
// cannot interleave with another flow or a pool checkout. A VM in one of these
// drops out of every checkout/power path until the flow releases it.
export const DELETING_STATUS = 'deleting' as const
export const MOVING_STATUS = 'moving' as const
// Transient disk-operation "status-as-lock" markers (not QEMU states). These
// claim a *stopped* VM row (OFF/ERROR) for the duration of a qemu-img operation
// that needs an exclusive qcow2 write lock — backup convert, restore overwrite,
// or snapshot create. A VM in one of these MUST be refused by every power-on
// path: starting qemu while qemu-img reads/writes the image corrupts the qcow2.
// The DB claim is the authoritative cross-service gate (the live-process probe
// in assertVmStopped is a TOCTOU window on its own — see audit H1).
export const BACKING_UP_STATUS = 'backing_up' as const
export const RESTORING_STATUS = 'restoring' as const
export const SNAPSHOTTING_STATUS = 'snapshotting' as const
// Disk-op marker held by GoldenImageService while it stops a source VM and runs
// an exclusive `qemu-img convert` over that VM's disk during a golden-image
// capture. Like the other disk-op markers it claims a STOPPED row (OFF/ERROR)
// and MUST keep the VM out of every power-on path until released — booting QEMU
// over the disk qemu-img is converting corrupts the qcow2. The capture flow
// releases this back to 'off' BEFORE any internal restart of the source, because
// the hardened library VMLifecycle.start() now refuses to start a VM whose DB
// status is a disk-op marker.
export const CAPTURING_STATUS = 'capturing' as const
// Pool pseudo-status for archived/scaled-down members (previously a local
// literal in NonPersistentResetService/PoolService).
export const ARCHIVED_STATUS = 'archived' as const
// Terminal marker set by MachineCleanupServiceV2.cleanupVM when the physical
// teardown (infinization.destroyVM) failed and the DB Machine row was
// intentionally preserved so an operator/cron can retry the delete.
export const DELETE_FAILED_STATUS = 'delete_failed' as const
export const ERROR_STATUS = 'error' as const

export type MachineStatusValue =
  | typeof OFF_STATUS
  | typeof STARTING_STATUS
  | typeof RUNNING_STATUS
  | typeof SUSPENDED_STATUS
  | typeof PAUSED_STATUS
  | typeof UPDATING_HARDWARE_STATUS
  | typeof POWERING_OFF_UPDATE_STATUS
  | typeof REBUILDING_STATUS
  | typeof DELETING_STATUS
  | typeof MOVING_STATUS
  | typeof BACKING_UP_STATUS
  | typeof RESTORING_STATUS
  | typeof SNAPSHOTTING_STATUS
  | typeof CAPTURING_STATUS
  | typeof ARCHIVED_STATUS
  | typeof DELETE_FAILED_STATUS
  | typeof ERROR_STATUS

const ALL_STATUSES: MachineStatusValue[] = [
  OFF_STATUS,
  STARTING_STATUS,
  RUNNING_STATUS,
  SUSPENDED_STATUS,
  PAUSED_STATUS,
  UPDATING_HARDWARE_STATUS,
  POWERING_OFF_UPDATE_STATUS,
  REBUILDING_STATUS,
  DELETING_STATUS,
  MOVING_STATUS,
  BACKING_UP_STATUS,
  RESTORING_STATUS,
  SNAPSHOTTING_STATUS,
  CAPTURING_STATUS,
  ARCHIVED_STATUS,
  DELETE_FAILED_STATUS,
  ERROR_STATUS
]

/**
 * The transient disk-op markers, in one place. A VM in any of these has claimed
 * its row for an exclusive qemu-img operation and must be kept out of every
 * power-on path until the operation releases the marker (back to OFF/ERROR).
 */
export const DISK_OP_STATUSES: MachineStatusValue[] = [
  BACKING_UP_STATUS,
  RESTORING_STATUS,
  SNAPSHOTTING_STATUS,
  CAPTURING_STATUS
]

export function isValidMachineStatus (status: string): status is MachineStatusValue {
  return (ALL_STATUSES as string[]).includes(status)
}

export function isMachineRunning (status: string): boolean {
  return status === RUNNING_STATUS
}

/**
 * True when the VM row is claimed by an in-progress qemu-img disk operation
 * (backup / restore / snapshot). Power-on paths MUST refuse these to avoid
 * corrupting a qcow2 that qemu-img currently holds open.
 */
export function isDiskOperationInProgress (status: string): boolean {
  return (DISK_OP_STATUSES as string[]).includes(status)
}

/**
 * True when a power-on / restart must be refused because the row is claimed by a
 * transient exclusive operation that holds (or is relocating) the qcow2: the
 * qemu-img disk ops AND a cold migration ('moving'). Starting qemu under any of
 * these races the operation — e.g. a node-to-node migration is copying/deleting
 * the disk while a concurrent power-on would launch qemu on the source. Fail
 * closed: power paths gate on this, not just isDiskOperationInProgress.
 */
export function isPowerActionLocked (status: string): boolean {
  return isDiskOperationInProgress(status) || status === MOVING_STATUS
}
