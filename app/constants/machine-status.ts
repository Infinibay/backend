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
  ARCHIVED_STATUS,
  DELETE_FAILED_STATUS,
  ERROR_STATUS
]

export function isValidMachineStatus (status: string): status is MachineStatusValue {
  return (ALL_STATUSES as string[]).includes(status)
}

export function isMachineRunning (status: string): boolean {
  return status === RUNNING_STATUS
}
