import { type Readable } from 'node:stream'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { type VMStorageMigrationAdapter } from './VMMigrationService'
import { LocalDiskStore } from './AgentDiskServer'
import { masterIdentity } from './NodeDispatcher'
import { resolveLocalNodeId } from '../InfinizationService'
import { getInfinizationConfig } from '../InfinizationService'
import { httpsJsonPost, type ClusterIdentity } from './clusterMtls'
import { streamGetOverMtls, streamPostOverMtls } from './clusterStream'

/**
 * Multi-node Phase 3 (cold migration): the storage half of moving a STOPPED VM
 * between nodes. VMMigrationService validates + flips Machine.nodeId; this adapter
 * physically relocates the qcow2 disk(s) so the VM can actually start on the
 * target. With local (non-shared) storage the disk lives on the source host's
 * filesystem and must be copied to the target host's filesystem.
 *
 * Topology: the MASTER coordinates (nodes never talk peer-to-peer). For each disk:
 *   1. read the source bytes  — local fs if the source is the master's own node,
 *      else GET /agent/disk/pull from the source agent over mTLS;
 *   2. write the target bytes — local fs if the target is the master, else POST
 *      /agent/disk/push to the target agent over mTLS (which writes atomically);
 *   3. verify the target's sha256 == the source's sha256 (end-to-end integrity).
 *
 * INVARIANT I2 — the source disk is deleted ONLY after every disk has been
 * checksum-proven on the target. A transfer that fails verification leaves the
 * source intact, so a failed migration never loses data.
 *
 * The same path string is valid on every node (all use the configured diskDir), so
 * the disk keeps its path — only its host changes. The DB diskPaths need no
 * rewrite.
 */

interface NodeAddr { id: string, name: string, address: string, agentPort: number }

export interface AgentStorageMigrationAdapterDeps {
  /** Master disk dir = path-guard root for any leg that is the master's own node. */
  localDiskDir?: string
  /** Resolve the master's own node id (a local leg uses fs directly). */
  resolveLocalNodeId?: () => Promise<string | undefined>
  /** Master mTLS identity getter (presented to agents; default = NodeDispatcher cache). */
  identity?: () => ClusterIdentity
  /** Delete the source disk after the target is verified. Default true (no leak). */
  deleteSourceAfter?: boolean
  // Transports — injectable for tests.
  streamGet?: typeof streamGetOverMtls
  streamPost?: typeof streamPostOverMtls
  jsonPost?: typeof httpsJsonPost
}

interface DiskStat { exists: boolean, size?: number, sha256?: string }

export class AgentStorageMigrationAdapter implements VMStorageMigrationAdapter {
  private readonly store: LocalDiskStore
  private readonly resolveLocal: () => Promise<string | undefined>
  private readonly identity: () => ClusterIdentity
  private readonly deleteSourceAfter: boolean
  private readonly streamGet: typeof streamGetOverMtls
  private readonly streamPost: typeof streamPostOverMtls
  private readonly jsonPost: typeof httpsJsonPost

  constructor (private readonly prisma: PrismaClient, deps: AgentStorageMigrationAdapterDeps = {}) {
    this.store = new LocalDiskStore(deps.localDiskDir ?? getInfinizationConfig().diskDir)
    this.resolveLocal = deps.resolveLocalNodeId ?? resolveLocalNodeId
    this.identity = deps.identity ?? masterIdentity
    this.deleteSourceAfter = deps.deleteSourceAfter ?? true
    this.streamGet = deps.streamGet ?? streamGetOverMtls
    this.streamPost = deps.streamPost ?? streamPostOverMtls
    this.jsonPost = deps.jsonPost ?? httpsJsonPost
  }

  async prepareMachineStorage (params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
    deferReclaim?: boolean
  }): Promise<void> {
    const { machineId, sourceNodeId, targetNodeId, diskPaths, deferReclaim } = params
    if (sourceNodeId === targetNodeId) return // same node — nothing to move
    if (diskPaths.length === 0) {
      logger.warn(`Migration ${machineId}: no disk paths recorded — nothing to copy (the VM may not be provisioned yet)`)
      return
    }

    const legs = await this.resolveLegs(sourceNodeId, targetNodeId)
    if (legs.samePhysicalStore) {
      logger.info(`Migration ${machineId}: source and target resolve to the same physical disk store — disk already in place, no copy needed`)
      return
    }

    logger.info(`Migration ${machineId}: copying ${diskPaths.length} disk(s) ${legs.sourceLocal ? 'master(local)' : legs.sourceNode!.name} → ${legs.targetLocal ? 'master(local)' : legs.targetNode!.name}`)

    // 1+2+3: transfer every disk and prove its integrity on the target BEFORE any deletion.
    for (const p of diskPaths) {
      const srcSha = await this.transferOne(p, legs)
      logger.info(`Migration ${machineId}: disk verified on target (sha256 ${srcSha.slice(0, 16)}…) ${p}`)
    }

    // 4: reclaiming the source is the ONLY destructive step (invariant I2 — never
    // before every disk is checksum-proven on the target). With deferReclaim the
    // caller (migrateStoppedMachineToNode) runs it via reclaimSourceStorage strictly
    // AFTER the Machine.nodeId commit is durable, so an interrupted commit can never
    // strand the VM pointing at a node whose disk was already deleted. Legacy callers
    // (deferReclaim unset) keep the pre-commit delete here for backward compatibility.
    if (this.deleteSourceAfter && !deferReclaim) {
      await this.deleteSources(machineId, diskPaths, legs)
    }
  }

  /**
   * Delete the migrated source disk(s), invoked ONLY after the ownership commit
   * (deferReclaim path). Best-effort: a stale source is a leak to clean up, not a
   * failure to surface. No-op when source and target are the same physical store
   * (prepareMachineStorage already short-circuited the copy — deleting would destroy
   * the VM's only disk).
   */
  async reclaimSourceStorage (params: {
    machineId: string
    sourceNodeId: string | null
    targetNodeId: string
    diskPaths: string[]
  }): Promise<void> {
    const { machineId, sourceNodeId, targetNodeId, diskPaths } = params
    if (!this.deleteSourceAfter) return
    if (sourceNodeId === targetNodeId || diskPaths.length === 0) return
    const legs = await this.resolveLegs(sourceNodeId, targetNodeId)
    if (legs.samePhysicalStore) return
    await this.deleteSources(machineId, diskPaths, legs)
  }

  /**
   * Resolve which side of the migration is the master's own filesystem vs a remote
   * agent, and whether both legs resolve to the SAME physical disk store.
   *
   * diskDir is uniform cluster-wide (see file header), so a leg's physical identity
   * is `local` for the master's own node, else `${address}:${agentPort}`. When the
   * keys match, source and target are the SAME file at the SAME path: copying it onto
   * itself and then unlinking the "source" would destroy the VM's only qcow2 (the
   * sha256 self-check cannot detect this). Subsumes the master-local&&local case AND
   * two distinct Node rows (re-onboarded / cloned host) sharing an address+agentPort.
   */
  private async resolveLegs (sourceNodeId: string | null, targetNodeId: string): Promise<{
    sourceLocal: boolean
    sourceNode: NodeAddr | null
    targetLocal: boolean
    targetNode: NodeAddr | null
    samePhysicalStore: boolean
  }> {
    const localNodeId = await this.resolveLocal()
    const sourceLocal = sourceNodeId == null || (localNodeId != null && sourceNodeId === localNodeId)
    const targetLocal = localNodeId != null && targetNodeId === localNodeId
    const sourceNode = sourceLocal ? null : await this.requireNode(sourceNodeId as string, 'source')
    const targetNode = targetLocal ? null : await this.requireNode(targetNodeId, 'target')
    const srcKey = sourceLocal ? 'local' : `${sourceNode!.address}:${sourceNode!.agentPort}`
    const tgtKey = targetLocal ? 'local' : `${targetNode!.address}:${targetNode!.agentPort}`
    return { sourceLocal, sourceNode, targetLocal, targetNode, samePhysicalStore: srcKey === tgtKey }
  }

  /** Best-effort delete of the source disk(s); a failure is logged, never thrown. */
  private async deleteSources (
    machineId: string,
    diskPaths: string[],
    legs: { sourceLocal: boolean, sourceNode: NodeAddr | null }
  ): Promise<void> {
    for (const p of diskPaths) {
      try {
        if (legs.sourceLocal) await this.store.unlink(p)
        else await this.deleteRemote(legs.sourceNode!, p)
      } catch (err) {
        // The migration already succeeded (target verified); a stale source is a
        // leak to clean up, not a failure to surface to the user.
        logger.warn(`Migration ${machineId}: source disk cleanup failed for ${p} (left in place): ${String(err)}`)
      }
    }
  }

  /** Move one disk source→target and return the verified sha256. Throws on any mismatch (source untouched). */
  private async transferOne (
    p: string,
    ctx: { sourceLocal: boolean, sourceNode: NodeAddr | null, targetLocal: boolean, targetNode: NodeAddr | null }
  ): Promise<string> {
    // Source integrity reference + size + byte stream.
    let srcSha: string
    let srcSize: number
    let srcStream: Readable
    if (ctx.sourceLocal) {
      if (!this.store.exists(p)) throw new Error(`source disk missing on master: ${p}`)
      srcSha = await this.store.sha256(p)
      srcSize = this.store.size(p)
      srcStream = this.store.createReadStream(p)
    } else {
      const stat = await this.statRemote(ctx.sourceNode!, p)
      if (!stat.exists || !stat.sha256) throw new Error(`source disk missing on node ${ctx.sourceNode!.name}: ${p}`)
      srcSha = stat.sha256
      srcSize = stat.size ?? 0
      srcStream = await this.streamGet(this.pullUrl(ctx.sourceNode!, p), this.identity(), ctx.sourceNode!.name)
    }

    // Target write + its own sha256 of what landed. Any failure here MUST release the
    // source byte stream: once streamGet resolved, the pull connection's deadline timer
    // was cleared, so a leaked srcStream keeps the source agent's fd/socket half-open
    // until an OS-level idle timeout — a per-failed-migration leak toward fd exhaustion
    // (e.g. a 507/422 rejection from the target). destroy() is a harmless no-op on an
    // already-ended stream (the happy path fully drains it), so wrap the whole block.
    let tgtSha: string
    try {
      if (ctx.targetLocal) {
        // Refuse if the master's own disk store can't hold the incoming image (5%
        // margin) — don't fill the filesystem out from under other local VMs.
        if (srcSize > 0 && this.store.freeBytes() < Math.ceil(srcSize * 1.05)) {
          throw new Error(`insufficient disk space on master for ${p}: need ~${srcSize} bytes, ${this.store.freeBytes()} free`)
        }
        const written = await this.store.writeFrom(p, srcStream)
        tgtSha = written.sha256
        if (tgtSha !== srcSha) { await this.store.unlink(p); throw new Error(`sha256 mismatch writing ${p} on master (src ${srcSha}, dst ${tgtSha})`) }
      } else {
        const r = await this.streamPost(this.pushUrl(ctx.targetNode!, p, srcSha, srcSize), srcStream, this.identity(), ctx.targetNode!.name)
        const body = this.parseJson(r.text)
        if (r.status !== 200 || body?.ok !== true) {
          throw new Error(`disk push to node ${ctx.targetNode!.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
        }
        tgtSha = String(body.sha256 ?? '')
        if (tgtSha !== srcSha) throw new Error(`sha256 mismatch pushing ${p} to ${ctx.targetNode!.name} (src ${srcSha}, dst ${tgtSha})`)
      }
    } catch (err) {
      srcStream.destroy() // release the source pull connection on any target-write failure
      throw err
    }
    return srcSha
  }

  private async requireNode (nodeId: string, which: 'source' | 'target'): Promise<NodeAddr> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, name: true, address: true, agentPort: true }
    })
    if (!node || !node.address) {
      throw new Error(`Cannot migrate disk: ${which} node ${nodeId} has no reachable address`)
    }
    return { id: node.id, name: node.name, address: node.address, agentPort: node.agentPort }
  }

  private pullUrl (n: NodeAddr, p: string): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/pull?path=${encodeURIComponent(p)}`
  }

  private pushUrl (n: NodeAddr, p: string, sha256: string, size?: number): string {
    const sizeParam = size != null && size > 0 ? `&size=${size}` : ''
    return `https://${n.address}:${n.agentPort}/agent/disk/push?path=${encodeURIComponent(p)}&sha256=${sha256}${sizeParam}`
  }

  private async statRemote (n: NodeAddr, p: string): Promise<DiskStat> {
    const r = await this.jsonPost(`https://${n.address}:${n.agentPort}/agent/disk/stat`, { path: p }, this.identity(), { expectedCn: n.name })
    const body = this.parseJson(r.text)
    if (r.status !== 200 || body?.ok !== true) throw new Error(`disk stat on node ${n.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
    return { exists: body.exists === true, size: body.size, sha256: body.sha256 }
  }

  private async deleteRemote (n: NodeAddr, p: string): Promise<void> {
    const r = await this.jsonPost(`https://${n.address}:${n.agentPort}/agent/disk/delete`, { path: p }, this.identity(), { expectedCn: n.name })
    if (r.status !== 200) throw new Error(`disk delete on node ${n.name} failed (${r.status}): ${r.text.slice(0, 200)}`)
  }

  private parseJson (text: string): any {
    try { return JSON.parse(text) } catch { return null }
  }
}
