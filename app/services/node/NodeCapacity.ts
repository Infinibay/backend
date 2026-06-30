export const NODE_STALE_AFTER_MS = 5 * 60 * 1000

export interface NodeResourceTotals {
  cpuCores: number
  ramGB: number
  diskSizeGB: number
}

export interface NodeCapacityInput {
  cores: number
  ram: number
  /// Row mtime — staleness FALLBACK when no heartbeat has been recorded yet.
  updatedAt: Date
  /// Last agent heartbeat/lease-renewal. When present it drives staleness instead
  /// of `updatedAt` (Phase 0). Null on legacy rows / before the first heartbeat.
  lastHeartbeat?: Date | null
  maintenanceMode: boolean
  machines: Array<Partial<NodeResourceTotals>>
}

export interface NodeCapacity {
  reserved: NodeResourceTotals
  totalRamGB: number
  availableCores: number
  availableRamGB: number
  availableDiskGB: number | null
  health: 'online' | 'stale'
  schedulable: boolean
}

/**
 * Node health from the most recent sign-of-life. Pass `lastHeartbeat ?? updatedAt`
 * — heartbeat is the Phase-0+ signal; `updatedAt` is the backward-compatible
 * fallback for rows that have never heartbeated.
 *
 * NOTE (Phase 0): nothing periodically refreshes the local/master node's
 * heartbeat yet (the periodic local heartbeat is Phase 1 / Observability), so a
 * master with no agent will read 'stale' after the threshold — the SAME
 * behaviour as before this change, NOT a regression. The frontend already falls
 * back to a synthetic local-node row in that case.
 */
export function nodeHealth (lastSeen: Date, now = new Date()): 'online' | 'stale' {
  const ageMs = now.getTime() - lastSeen.getTime()
  return ageMs > NODE_STALE_AFTER_MS ? 'stale' : 'online'
}

export function calculateNodeCapacity (node: NodeCapacityInput, now = new Date()): NodeCapacity {
  const reserved = node.machines.reduce<NodeResourceTotals>(
    (total, machine) => ({
      cpuCores: total.cpuCores + (machine.cpuCores || 0),
      ramGB: total.ramGB + (machine.ramGB || 0),
      diskSizeGB: total.diskSizeGB + (machine.diskSizeGB || 0)
    }),
    { cpuCores: 0, ramGB: 0, diskSizeGB: 0 }
  )
  const totalRamGB = Math.floor(node.ram / 1024)
  const health = nodeHealth(node.lastHeartbeat ?? node.updatedAt, now)

  return {
    reserved,
    totalRamGB,
    availableCores: node.cores - reserved.cpuCores,
    availableRamGB: totalRamGB - reserved.ramGB,
    availableDiskGB: null,
    health,
    schedulable: !node.maintenanceMode && health === 'online'
  }
}
