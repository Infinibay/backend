export const NODE_STALE_AFTER_MS = 5 * 60 * 1000

export interface NodeResourceTotals {
  cpuCores: number
  ramGB: number
  diskSizeGB: number
}

export interface NodeCapacityInput {
  cores: number
  ram: number
  updatedAt: Date
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

export function nodeHealth (updatedAt: Date, now = new Date()): 'online' | 'stale' {
  const ageMs = now.getTime() - updatedAt.getTime()
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
  const health = nodeHealth(node.updatedAt, now)

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
