import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import type { OverlayPeer } from '@infinibay/infinization'
import { NodeDispatcher } from '../node/NodeDispatcher'
import { resolveLocalNodeId } from '../InfinizationService'
import { KeyedMutex } from '@infinibay/infinization'

const debug = logger.child({ module: 'overlay-coordinator' })

/** VXLAN VNI allocation range (24-bit, avoiding the reserved low ids). */
const VNI_MIN = 4096
const VNI_MAX = 16_777_215

/** VM statuses that mean the node no longer needs the department's segment. */
const INACTIVE_STATUSES = new Set(['deleting', 'archived', 'delete_failed'])

/**
 * Module-level lock keyed by `${deptId}:${nodeId}` so a realize (ensurePlacement)
 * and a teardown (teardownIfEmpty) for the SAME department+node can never interleave
 * — otherwise a concurrent teardown could `ip link del` the VXLAN device a just-
 * started VM depends on (TOCTOU). Module scope so every coordinator instance shares it.
 */
const segmentLock = new KeyedMutex()

interface DeptOverlayRow {
  id: string
  bridgeName: string | null
  ipSubnet: string | null
  gatewayIP: string | null
  overlayMtu: number
  gatewayNodeId: string | null
  vni: number | null
}

interface Underlay { vtepIp: string, wgPubKey: string, wgEndpoint: string }
interface Member { nodeId: string, underlay: Underlay | null }

/**
 * Master-side control plane for the department L2 overlay (07-networking.md §1,
 * ADR-N1/N2). The master is the single source of truth: it allocates each
 * department's VNI, computes the set of member nodes, elects the gateway owner, and
 * PUSHES ensureSegment/setPeers/destroySegment to member agents over the mTLS verb
 * channel. Nodes never read overlay rows from the DB — everything arrives as call
 * arguments, keeping the InfinizationDatabase Pick unchanged.
 *
 * Minimal-first policy (ADR-N2, simplified): the MASTER is always the gateway owner
 * of any cross-node department (DHCP/NAT stay on the master's existing
 * DepartmentNetworkService). It is therefore forced into the member set even when it
 * hosts 0 of the department's VMs, and its own VXLAN segment is realized so compute
 * members reach its gateway over the overlay.
 */
export class OverlayCoordinatorService {
  constructor (
    private readonly prisma: PrismaClient,
    private readonly dispatcher: NodeDispatcher = new NodeDispatcher(prisma)
  ) {}

  /**
   * Ensure the department's overlay segment is realized on `targetNodeId` (and the
   * mesh + gateway refreshed on every member) BEFORE a VM is created/started there.
   * No-op for a purely single-host department (only the master hosts it). FAIL-CLOSED
   * on both the TARGET and the GATEWAY OWNER: if either cannot be realized the call
   * throws so the caller refuses to power on a VM whose L2 / gateway cannot be built.
   */
  async ensurePlacement (deptId: string, targetNodeId: string): Promise<void> {
    const dept = await this.loadDept(deptId)
    if (!dept || !dept.bridgeName || !dept.ipSubnet) {
      // The department has no network configured; the non-overlay path surfaces that.
      return
    }

    const localNodeId = await resolveLocalNodeId()
    const members = await this.computeMembersWithMaster(deptId, localNodeId, targetNodeId)

    // Single-host (only the master, or a lone node) → the existing
    // DepartmentNetworkService owns the bridge/DHCP/NAT; no overlay needed. Checked
    // BEFORE any durable VNI write so a legitimate single-host start is never blocked.
    if (members.length <= 1) return
    if (!localNodeId) {
      throw new Error(
        `Cannot realize overlay for department ${deptId}: this host could not resolve its own ` +
        'node identity, so it cannot elect a gateway owner. Set INFINIBAY_NODE_NAME / fix the local Node registration.'
      )
    }
    // Minimal-first invariant (ADR-N2): the MASTER is the mandated gateway owner of
    // every cross-node department (DHCP/NAT live there). If it has no realizable
    // overlay identity, a compute node would be elected gateway with no DHCP/NAT —
    // fail-closed rather than silently boot VMs with no leases / egress.
    if (!members.some(m => m.nodeId === localNodeId && m.underlay)) {
      throw new Error(
        `Cannot realize overlay for department ${deptId}: the master node ${localNodeId} has no ` +
        'WireGuard/VTEP identity (NodeUnderlay), so it cannot own the department gateway (DHCP/NAT). ' +
        'Set INFINIBAY_VTEP_IP on the master (its primary IPv4 is likely on a filtered virtual interface) and restart.'
      )
    }

    const vni = await this.allocateVniIfNeeded(deptId)
    const gatewayNodeId = await this.ensureGatewayOwner(dept, members, localNodeId)
    const gatewayCidr = this.gatewayCidr(dept)

    // Fail-closed prerequisites: BOTH the target and the elected gateway owner must
    // have a realizable overlay identity (NodeUnderlay), else the VM would boot onto
    // a segment with no return path / no gateway.
    this.assertRealizable(members, targetNodeId, deptId, 'target')
    if (!gatewayNodeId) throw new Error(`Cannot realize overlay for department ${deptId}: no gateway owner could be elected`)
    this.assertRealizable(members, gatewayNodeId, deptId, 'gateway owner')

    // Realize the segment on every member (idempotent), each with the OTHER members
    // as its peer set. Fail-closed on the target and the gateway owner; best-effort on
    // other peers (a transiently-unreachable peer self-heals on the next reconcile).
    for (const m of members) {
      if (!m.underlay) {
        debug.warn(`Overlay: skipping member ${m.nodeId} of dept ${deptId} — no NodeUnderlay identity`)
        continue
      }
      const spec = {
        deptId,
        bridgeName: dept.bridgeName,
        vni,
        mtu: dept.overlayMtu,
        isGatewayOwner: m.nodeId === gatewayNodeId,
        gatewayCidr,
        peers: this.peersExcluding(members, m.nodeId)
      }
      try {
        await segmentLock.runExclusive(`${deptId}:${m.nodeId}`, async () => {
          const executor = await this.dispatcher.executorForNode(m.nodeId)
          await executor.ensureSegment(spec)
        })
      } catch (err) {
        if (m.nodeId === targetNodeId || m.nodeId === gatewayNodeId) throw err // fail-closed
        debug.warn(`Overlay: ensureSegment on peer ${m.nodeId} for dept ${deptId} failed (continuing): ${String(err)}`)
      }
    }
  }

  /**
   * When `nodeId` no longer hosts any VM of the department, remove its VXLAN device
   * and drop it from the mesh of the remaining members. If it owned the gateway,
   * re-elect a survivor and re-realize the new owner (full ensureSegment, so DHCP/NAT
   * move). Best-effort per remote call — a failure self-heals on the next reconcile.
   */
  async teardownIfEmpty (deptId: string, nodeId: string): Promise<void> {
    const dept = await this.loadDept(deptId)
    if (!dept || !dept.bridgeName) return
    const localNodeId = await resolveLocalNodeId()

    await segmentLock.runExclusive(`${deptId}:${nodeId}`, async () => {
      // Re-read INSIDE the lock: a concurrent placement may have re-populated the node.
      // Include the master (gateway owner, may host 0 dept VMs) so tearing down the
      // MASTER's own segment is impossible (it is always a member).
      const members = await this.computeMembersWithMaster(deptId, localNodeId)
      if (members.some(m => m.nodeId === nodeId)) return

      try {
        const executor = await this.dispatcher.executorForNode(nodeId)
        await executor.destroySegment(deptId, dept.bridgeName!)
      } catch (err) {
        debug.warn(`Overlay: destroySegment on ${nodeId} for dept ${deptId} failed: ${String(err)}`)
      }
    })

    // Recompute survivors (WITH the master) and, if the departed node owned the
    // gateway, hand off. Force-adding the master keeps every survivor's peer set/FDB
    // pointed at the gateway VTEP — omitting it strips the data path to DHCP/NAT.
    const remaining = await this.computeMembersWithMaster(deptId, localNodeId)
    let gatewayNodeId = dept.gatewayNodeId
    if (nodeId === dept.gatewayNodeId) {
      if (remaining.length === 0) {
        await this.prisma.department.update({ where: { id: deptId }, data: { gatewayNodeId: null } })
        gatewayNodeId = null
      } else {
        gatewayNodeId = await this.ensureGatewayOwner(dept, remaining, localNodeId)
      }
    }

    const gatewayCidr = this.gatewayCidr(dept)
    for (const m of remaining) {
      if (!m.underlay) continue
      try {
        // Serialize each survivor's realize under the same key ensurePlacement uses,
        // and re-check membership inside the lock so a concurrent teardown of THIS
        // survivor cannot race the promote (avoids a deviceless owner).
        await segmentLock.runExclusive(`${deptId}:${m.nodeId}`, async () => {
          const still = await this.computeMembersWithMaster(deptId, localNodeId)
          if (!still.some(x => x.nodeId === m.nodeId)) return
          const executor = await this.dispatcher.executorForNode(m.nodeId)
          if (m.nodeId === gatewayNodeId && dept.vni != null) {
            // Promote / keep the owner: full realize so its gateway IP + mesh are set.
            await executor.ensureSegment({
              deptId,
              bridgeName: dept.bridgeName!,
              vni: dept.vni,
              mtu: dept.overlayMtu,
              isGatewayOwner: true,
              gatewayCidr,
              peers: this.peersExcluding(remaining, m.nodeId)
            })
          } else {
            await executor.setPeers(deptId, dept.bridgeName!, this.peersExcluding(remaining, m.nodeId))
          }
        })
      } catch (err) {
        debug.warn(`Overlay: mesh refresh on ${m.nodeId} for dept ${deptId} failed: ${String(err)}`)
      }
    }
  }

  /**
   * Idempotent master-side reconcile of ALL cross-node departments — the systemic
   * safety net (07-networking.md §5) that heals drift from swallowed best-effort
   * pushes, a node/master restart (VXLAN/WG devices are gone after a reboot), or a
   * missed teardown. Re-realizes every current member and re-elects a gateway owner
   * that is no longer a member. Best-effort; never throws. Master-only.
   */
  async reconcileAll (): Promise<void> {
    const localNodeId = await resolveLocalNodeId()
    if (!localNodeId) return
    let depts: DeptOverlayRow[]
    try {
      depts = await this.prisma.department.findMany({
        where: { vni: { not: null }, bridgeName: { not: null }, ipSubnet: { not: null } },
        select: { id: true, bridgeName: true, ipSubnet: true, gatewayIP: true, overlayMtu: true, gatewayNodeId: true, vni: true }
      })
    } catch (err) {
      debug.warn(`Overlay reconcile: failed to list departments: ${String(err)}`)
      return
    }
    for (const dept of depts) {
      try {
        const members = await this.computeMembersWithMaster(dept.id, localNodeId)
        if (members.length <= 1 || dept.vni == null || !dept.bridgeName) continue
        // Minimal-first invariant: the master must be a realizable gateway owner.
        // If it is not (no underlay), skip rather than elect a compute-node gateway
        // with no DHCP/NAT — mirrors ensurePlacement's fail-closed check.
        if (!members.some(m => m.nodeId === localNodeId && m.underlay)) {
          debug.warn(`Overlay reconcile: skipping dept ${dept.id} — master ${localNodeId} has no NodeUnderlay identity to own the gateway`)
          continue
        }
        const gatewayNodeId = await this.ensureGatewayOwner(dept, members, localNodeId)
        const gatewayCidr = this.gatewayCidr(dept)
        for (const m of members) {
          if (!m.underlay) continue
          try {
            await segmentLock.runExclusive(`${dept.id}:${m.nodeId}`, async () => {
              const executor = await this.dispatcher.executorForNode(m.nodeId)
              await executor.ensureSegment({
                deptId: dept.id,
                bridgeName: dept.bridgeName!,
                vni: dept.vni!,
                mtu: dept.overlayMtu,
                isGatewayOwner: m.nodeId === gatewayNodeId,
                gatewayCidr,
                peers: this.peersExcluding(members, m.nodeId)
              })
            })
          } catch (err) {
            debug.debug(`Overlay reconcile: ${dept.id} on ${m.nodeId} failed: ${String(err)}`)
          }
        }
      } catch (err) {
        debug.warn(`Overlay reconcile: department ${dept.id} failed: ${String(err)}`)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private assertRealizable (members: Member[], nodeId: string, deptId: string, role: string): void {
    const m = members.find(x => x.nodeId === nodeId)
    if (!m || !m.underlay) {
      throw new Error(
        `Cannot realize overlay for department ${deptId}: the ${role} node ${nodeId} has no ` +
        'WireGuard/VTEP identity (NodeUnderlay). Ensure its agent enrolled with overlay support.'
      )
    }
  }

  private gatewayCidr (dept: DeptOverlayRow): string | undefined {
    const mask = dept.ipSubnet ? this.parseMask(dept.ipSubnet) : null
    return dept.gatewayIP && mask ? `${dept.gatewayIP}/${mask}` : undefined
  }

  private async loadDept (deptId: string): Promise<DeptOverlayRow | null> {
    return this.prisma.department.findUnique({
      where: { id: deptId },
      select: { id: true, bridgeName: true, ipSubnet: true, gatewayIP: true, overlayMtu: true, gatewayNodeId: true, vni: true }
    })
  }

  private async loadUnderlay (nodeId: string): Promise<Underlay | null> {
    const u = await this.prisma.nodeUnderlay.findUnique({
      where: { nodeId },
      select: { vtepIp: true, wgPubKey: true, wgEndpoint: true }
    })
    return u ? { vtepIp: u.vtepIp, wgPubKey: u.wgPubKey, wgEndpoint: u.wgEndpoint } : null
  }

  /** Distinct nodes hosting ≥1 active VM of the department, plus `extraNodeId` if
   *  given (the node currently being placed), each with its NodeUnderlay if present. */
  private async computeMembers (deptId: string, extraNodeId?: string): Promise<Member[]> {
    const rows = await this.prisma.machine.findMany({
      where: { departmentId: deptId, nodeId: { not: null } },
      select: { nodeId: true, status: true }
    })
    const nodeIds = new Set<string>()
    for (const r of rows) {
      if (r.nodeId && !INACTIVE_STATUSES.has(r.status)) nodeIds.add(r.nodeId)
    }
    if (extraNodeId) nodeIds.add(extraNodeId)
    if (nodeIds.size === 0) return []

    const underlays = await this.prisma.nodeUnderlay.findMany({
      where: { nodeId: { in: [...nodeIds] } },
      select: { nodeId: true, vtepIp: true, wgPubKey: true, wgEndpoint: true }
    })
    const byNode = new Map(underlays.map(u => [u.nodeId, { vtepIp: u.vtepIp, wgPubKey: u.wgPubKey, wgEndpoint: u.wgEndpoint }]))
    return [...nodeIds].map(nodeId => ({ nodeId, underlay: byNode.get(nodeId) ?? null }))
  }

  /**
   * computeMembers PLUS the forced master member (ADR-N2, minimal-first): the master
   * is the mandated gateway owner of every cross-node department, so it belongs to the
   * mesh even when it hosts 0 of the department's VMs. Force-added only when it has a
   * NodeUnderlay identity; callers fail-closed if it is required but absent. This is
   * the SINGLE source of the master-inclusion rule — every call site (placement,
   * teardown, reconcile) uses it so the three membership views can never drift.
   */
  private async computeMembersWithMaster (deptId: string, localNodeId?: string, extraNodeId?: string): Promise<Member[]> {
    const members = await this.computeMembers(deptId, extraNodeId)
    if (localNodeId && !members.some(m => m.nodeId === localNodeId)) {
      const masterUnderlay = await this.loadUnderlay(localNodeId)
      if (masterUnderlay) return [...members, { nodeId: localNodeId, underlay: masterUnderlay }]
    }
    return members
  }

  /** Build the peer list for `selfNodeId`, skipping members without an underlay (a
   *  malformed/absent identity must never be pushed as a peer). */
  private peersExcluding (members: Member[], selfNodeId: string): OverlayPeer[] {
    const peers: OverlayPeer[] = []
    for (const m of members) {
      if (m.nodeId === selfNodeId || !m.underlay) continue
      peers.push({ nodeId: m.nodeId, vtepIp: m.underlay.vtepIp, wgPubKey: m.underlay.wgPubKey, wgEndpoint: m.underlay.wgEndpoint })
    }
    return peers
  }

  /** Allocate Department.vni if unset (lazy, first cross-node need). Concurrency-safe
   *  via a conditional updateMany + @unique retry. */
  async allocateVniIfNeeded (deptId: string): Promise<number> {
    const existing = await this.prisma.department.findUnique({ where: { id: deptId }, select: { vni: true } })
    if (existing?.vni != null) return existing.vni

    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = await this.pickFreeVni(attempt)
      try {
        const res = await this.prisma.department.updateMany({
          where: { id: deptId, vni: null },
          data: { vni: candidate, overlayMode: 'vxlan' }
        })
        if (res.count === 1) return candidate
        const reread = await this.prisma.department.findUnique({ where: { id: deptId }, select: { vni: true } })
        if (reread?.vni != null) return reread.vni
      } catch (err) {
        debug.debug(`VNI candidate ${candidate} collided for dept ${deptId}, retrying: ${String(err)}`)
      }
    }
    throw new Error(`Could not allocate a free VNI for department ${deptId}`)
  }

  /**
   * Pick a candidate VNI. attempt 0 packs densely just above the current max (fast
   * path, no collisions in the common serial case); later attempts sample RANDOMLY
   * across the 24-bit pool so a burst of concurrent first-time allocations does not
   * form a thundering herd that repeatedly collides on max+1 (L1).
   */
  private async pickFreeVni (attempt: number): Promise<number> {
    if (attempt === 0) {
      const agg = await this.prisma.department.aggregate({ _max: { vni: true } })
      const next = Math.max((agg._max.vni ?? (VNI_MIN - 1)) + 1, VNI_MIN)
      if (next <= VNI_MAX) return next
    }
    // Random across the pool (avoid Math.random bias concerns — range is huge).
    return VNI_MIN + Math.floor(Math.random() * (VNI_MAX - VNI_MIN + 1))
  }

  /**
   * Elect and persist the department's single gateway owner (ADR-N2, minimal-first):
   * the MASTER (localNodeId) is the ONLY valid gateway owner because DHCP/NAT live on
   * its existing DepartmentNetworkService path. It is elected UNCONDITIONALLY (above
   * any stale stickiness) whenever it is a realizable member. A compute node is NEVER
   * elected — it has no DHCP/NAT — so if the master is not a realizable member this
   * returns null and the caller fail-closes (ensurePlacement) or skips (reconcile).
   * (Callers force the master into `members`; it is absent only when it has no
   * NodeUnderlay, which those callers already reject.)
   */
  private async ensureGatewayOwner (dept: DeptOverlayRow, members: Member[], localNodeId?: string): Promise<string | null> {
    const byId = new Map(members.map(m => [m.nodeId, m]))
    const owner = (localNodeId && byId.get(localNodeId)?.underlay) ? localNodeId : null
    if (owner !== dept.gatewayNodeId) {
      await this.prisma.department.update({ where: { id: dept.id }, data: { gatewayNodeId: owner } })
    }
    return owner
  }

  /** Extract the CIDR mask from an "a.b.c.0/24" subnet string. */
  private parseMask (ipSubnet: string): string | null {
    const m = /\/(\d{1,2})$/.exec(ipSubnet)
    return m ? m[1] : null
  }
}
