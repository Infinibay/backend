/**
 * Shared machine status constants to ensure consistency between services, tests, and GraphQL
 *
 * This file provides a single source of truth for machine status values,
 * preventing divergence between GraphQL enums and database/service values.
 */

// Re-export the GraphQL enum for consistency
export { MachineStatus } from '../graphql/resolvers/machine/type'

// Specific status constants for common use cases
export const RUNNING_STATUS = 'running' as const
export const STOPPED_STATUS = 'stopped' as const
export const PAUSED_STATUS = 'paused' as const

// Type for machine status values
export type MachineStatusValue = typeof RUNNING_STATUS | typeof STOPPED_STATUS | typeof PAUSED_STATUS

// Helper function to check if a status is valid
export function isValidMachineStatus (status: string): status is MachineStatusValue {
  return status === RUNNING_STATUS || status === STOPPED_STATUS || status === PAUSED_STATUS
}

// Helper function to check if a machine is running
export function isMachineRunning (status: string): boolean {
  return status === RUNNING_STATUS
}
