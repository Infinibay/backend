import os from 'node:os'
import { Prisma } from '@prisma/client'
import { calculateNodeCapacity } from './NodeCapacity'

export interface MachinePlacementRequest {
  cpuCores: number
  ramGB: number
  diskSizeGB: number
}

interface NodePlacementCandidate {
  id: string
  name: string
  cores: number
  ram: number
  lastHeartbeat: Date | null
  updatedAt: Date
  maintenanceMode: boolean
  machines: Array<{
    cpuCores: number
    ramGB: number
    diskSizeGB: number
  }>
}

// Lifecycle states a VM may be scheduled onto. A node that is pending (not yet
// approved), rejected, decommissioned, or offline must NEVER receive a new VM —
// otherwise the VM is stranded on a host with no live agent.
const SCHEDULABLE_NODE_STATUSES = ['online', 'approved']

export class NodePlacementService {
  constructor (private readonly prisma: Prisma.TransactionClient) {}

  async chooseNodeForMachine (request: MachinePlacementRequest): Promise<string | null> {
    const nodes = await this.prisma.node.findMany({
      // Only schedulable lifecycle states — never place onto a pending/rejected/
      // decommissioned/offline node (it has no live agent to run the VM).
      where: { status: { in: SCHEDULABLE_NODE_STATUSES }, maintenanceMode: false },
      select: {
        id: true,
        name: true,
        cores: true,
        ram: true,
        // lastHeartbeat drives liveness in calculateNodeCapacity — without it the
        // health falls back to updatedAt and a dead node whose row was merely
        // touched (e.g. a maintenance toggle) reads 'online' (fail-open).
        lastHeartbeat: true,
        updatedAt: true,
        maintenanceMode: true,
        machines: {
          select: {
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      }
    }) as NodePlacementCandidate[]

    if (nodes.length === 0) {
      return null
    }

    const localNodeName = process.env.INFINIBAY_NODE_NAME || os.hostname()
    const scored = nodes
      .map(node => {
        const capacity = calculateNodeCapacity(node)
        const fits = capacity.schedulable &&
          capacity.availableCores >= request.cpuCores &&
          capacity.availableRamGB >= request.ramGB

        return {
          node,
          fits,
          isLocal: node.name === localNodeName,
          availableCores: capacity.availableCores,
          availableRamGB: capacity.availableRamGB
        }
      })
      .filter(candidate => candidate.fits)
      .sort((a, b) => {
        if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
        if (b.availableCores !== a.availableCores) return b.availableCores - a.availableCores
        if (b.availableRamGB !== a.availableRamGB) return b.availableRamGB - a.availableRamGB
        return a.node.name.localeCompare(b.node.name)
      })

    return scored[0]?.node.id ?? null
  }
}
