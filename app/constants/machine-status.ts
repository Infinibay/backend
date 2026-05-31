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
export const ERROR_STATUS = 'error' as const

export type MachineStatusValue =
  | typeof OFF_STATUS
  | typeof STARTING_STATUS
  | typeof RUNNING_STATUS
  | typeof SUSPENDED_STATUS
  | typeof PAUSED_STATUS
  | typeof UPDATING_HARDWARE_STATUS
  | typeof POWERING_OFF_UPDATE_STATUS
  | typeof ERROR_STATUS

const ALL_STATUSES: MachineStatusValue[] = [
  OFF_STATUS,
  STARTING_STATUS,
  RUNNING_STATUS,
  SUSPENDED_STATUS,
  PAUSED_STATUS,
  UPDATING_HARDWARE_STATUS,
  POWERING_OFF_UPDATE_STATUS,
  ERROR_STATUS
]

export function isValidMachineStatus (status: string): status is MachineStatusValue {
  return (ALL_STATUSES as string[]).includes(status)
}

export function isMachineRunning (status: string): boolean {
  return status === RUNNING_STATUS
}
