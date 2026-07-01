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
  // IGNORED on the heartbeat path — always persisted as 'compute' (see
  // recordHeartbeat). A heartbeat only ever originates from a compute agent; the
  // master registers itself locally via LocalNodeRegistrationService and never
  // heartbeats, so a wire-supplied 'master' can only be a self-escalation attempt.
  role?: string
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
    const hw = payload.hardware
    // SECURITY / defense-in-depth: ram/cores are self-reported by the agent and are
    // exactly the values NodeCapacity/NodePlacementService use to rank nodes for VM
    // placement. An unbounded / negative / NaN / float value would poison cluster-wide
    // scheduling (funnel every create onto one host, or corrupt fleet totals). The
    // route (cluster.ts) already vets these; guard here too so the service can never
    // write a garbage capacity for ANY caller. Bounds mirror the route: positive
    // integers, cores <= 4096, ram <= 64 TiB expressed in MB.
    const MAX_CORES = 4096
    const MAX_RAM_MB = 64 * 1024 * 1024
    if (!Number.isInteger(hw.cores) || hw.cores <= 0 || hw.cores > MAX_CORES ||
        !Number.isInteger(hw.ram) || hw.ram <= 0 || hw.ram > MAX_RAM_MB) {
      throw new Error('heartbeat hardware.cores/ram must be positive integers within bounds')
    }
    // SECURITY: never trust the wire-supplied role. `role` is a trust-bearing field
    // (NodeEnrollmentService refuses re-enrolling a 'master' row; orphan-VM adoption
    // gates on role==='master'), and a heartbeat always comes from a compute agent —
    // the master never heartbeats. Persisting the reported role would let a compromised
    // compute node flip its own row to 'master' and self-escalate, so always persist
    // 'compute'.
    const role = 'compute'
    const now = new Date()

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
