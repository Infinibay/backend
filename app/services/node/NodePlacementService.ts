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
  updatedAt: Date
  maintenanceMode: boolean
  machines: Array<{
    cpuCores: number
    ramGB: number
    diskSizeGB: number
  }>
}

export class NodePlacementService {
  constructor (private readonly prisma: Prisma.TransactionClient) {}

  async chooseNodeForMachine (request: MachinePlacementRequest): Promise<string | null> {
    const nodes = await this.prisma.node.findMany({
      select: {
        id: true,
        name: true,
        cores: true,
        ram: true,
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
