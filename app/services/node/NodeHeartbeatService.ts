import { PrismaClient, Prisma } from '@prisma/client'

/**
 * Hardware summary an agent reports with each heartbeat. Mirrors the shape
 * LocalNodeRegistrationService.detectLocalHardware produces, so the master can
 * CREATE a Node row on a compute node's first heartbeat (currentRaid/cpuFlags/
 * ram/cores are non-null columns).
 */
export interface NodeHeartbeatHardware {
  currentRaid: string
  cpuFlags: Prisma.InputJsonValue
  ram: number // MB
  cores: number
}

export interface NodeHeartbeatPayload {
  name: string
  role?: string // 'compute' (default) | 'master'
  address?: string | null
  agentVersion?: string | null
  hardware: NodeHeartbeatHardware
}

/**
 * Receives node heartbeats from compute-node agents (multi-node Phase 1 walking
 * skeleton). Upserts the Node by name and stamps `lastHeartbeat`/status=online,
 * which drives the heartbeat-based staleness in NodeCapacity. This is the
 * pre-mTLS path (gated by a shared cluster token at the route); Phase 2 replaces
 * the token with the mTLS onboarding/pairing flow.
 */
export class NodeHeartbeatService {
  constructor (private readonly prisma: PrismaClient) {}

  async recordHeartbeat (payload: NodeHeartbeatPayload): Promise<{ nodeId: string, created: boolean }> {
    if (!payload.name || !payload.hardware) {
      throw new Error('heartbeat requires name and hardware')
    }
    const role = (payload.role || 'compute').toLowerCase()
    const now = new Date()
    const hw = payload.hardware

    const existing = await this.prisma.node.findFirst({
      where: { name: payload.name },
      select: { id: true }
    })

    if (existing) {
      await this.prisma.node.update({
        where: { id: existing.id },
        data: {
          role,
          status: 'online',
          address: payload.address ?? null,
          agentVersion: payload.agentVersion ?? null,
          ram: hw.ram,
          cores: hw.cores,
          currentRaid: hw.currentRaid,
          cpuFlags: hw.cpuFlags,
          lastHeartbeat: now
        }
      })
      return { nodeId: existing.id, created: false }
    }

    const node = await this.prisma.node.create({
      data: {
        name: payload.name,
        role,
        status: 'online',
        address: payload.address ?? null,
        agentVersion: payload.agentVersion ?? null,
        ram: hw.ram,
        cores: hw.cores,
        currentRaid: hw.currentRaid,
        cpuFlags: hw.cpuFlags,
        maintenanceMode: false,
        lastHeartbeat: now
      }
    })
    return { nodeId: node.id, created: true }
  }
}
