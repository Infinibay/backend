import { Transform, type Readable } from 'node:stream'
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

interface DiskStat { exists: boolean, size?: number, sha256?: string, allocated?: number }

/**
 * mTLS request deadline for a stat that asks the node to HASH the whole disk (raw
 * transfer path). A sha256 is a full-file read — seconds→minutes for a multi-GiB
 * qcow2 — so the default 15s deadline is far too tight and fired mid-hash as
 * "cluster mTLS request deadline exceeded". Match the streaming transport's ceiling
 * (the hash reads the disk once, same order as the copy). The sparse path skips the
 * hash entirely and keeps the default deadline.
 */
const REMOTE_STAT_HASH_TIMEOUT_MS = 60 * 60 * 1000

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
    onBytes?: (transferred: number, total: number) => void
  }): Promise<void> {
    const { machineId, sourceNodeId, targetNodeId, diskPaths, deferReclaim, onBytes } = params
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

    // Prefer the SPARSE wire (transfer only allocated bytes) when every remote peer
    // involved advertises it. A qcow2's apparent size is its VIRTUAL size (tens of GiB
    // of holes); the raw wire streams all of it and trips the node's request timeout
    // (408) mid-body on a large disk. Sparse moves only the real bytes. A not-yet-
    // upgraded node fails the capability probe and we transparently fall back to raw.
    const useSparse = await this.negotiateSparse(legs)
    logger.info(`Migration ${machineId}: disk transfer mode = ${useSparse ? 'sparse (allocated-only)' : 'raw (full image)'}`)

    // 1+2+3: transfer every disk and prove its integrity on the target BEFORE any deletion.
    for (const p of diskPaths) {
      if (useSparse) {
        await this.transferOneSparse(machineId, p, legs, onBytes)
      } else {
        const srcSha = await this.transferOne(p, legs, onBytes)
        logger.info(`Migration ${machineId}: disk verified on target (sha256 ${srcSha.slice(0, 16)}…) ${p}`)
      }
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
        // The migration already succeeded (target verified + committed); a stale
        // source is a storage LEAK, not a reason to fail the committed migration.
        // Log at ERROR with the full path so an operator can reclaim it manually —
        // there is no automatic reclaim sweeper yet (audit C5), so a swallowed
        // warn would let these accumulate invisibly toward ENOSPC.
        logger.error(`Migration ${machineId}: LEAKED source disk (reclaim failed, delete manually): ${p} — ${String(err)}`)
      }
    }
  }

  /** Move one disk source→target and return the verified sha256. Throws on any mismatch (source untouched). */
  private async transferOne (
    p: string,
    ctx: { sourceLocal: boolean, sourceNode: NodeAddr | null, targetLocal: boolean, targetNode: NodeAddr | null },
    onBytes?: (transferred: number, total: number) => void
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
      // Raw path genuinely needs the source's sha256 (the target verifies against it),
      // so let the node hash the whole disk — but give the request room (a multi-GiB
      // hash overruns the default 15s mTLS deadline).
      const stat = await this.statRemote(ctx.sourceNode!, p, { sha256: true, timeoutMs: REMOTE_STAT_HASH_TIMEOUT_MS })
      if (!stat.exists || !stat.sha256) throw new Error(`source disk missing on node ${ctx.sourceNode!.name}: ${p}`)
      srcSha = stat.sha256
      srcSize = stat.size ?? 0
      srcStream = await this.streamGet(this.pullUrl(ctx.sourceNode!, p), this.identity(), ctx.sourceNode!.name)
    }

    // Meter the raw wire (full image size) so the caller can stream a progress bar.
    srcStream = this.meter(srcStream, srcSize, onBytes)

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

  /**
   * Sparse can be used only if EVERY remote peer on this migration advertises it (the
   * master's own local legs always can). Probes /agent/disk/capabilities; a pre-sparse
   * node 404s → we return false and the caller uses the raw wire. Never throws.
   */
  private async negotiateSparse (legs: {
    sourceLocal: boolean, sourceNode: NodeAddr | null, targetLocal: boolean, targetNode: NodeAddr | null
  }): Promise<boolean> {
    const peers: NodeAddr[] = []
    if (!legs.sourceLocal && legs.sourceNode) peers.push(legs.sourceNode)
    if (!legs.targetLocal && legs.targetNode) peers.push(legs.targetNode)
    for (const peer of peers) {
      if (!(await this.remoteSupportsSparse(peer))) {
        logger.info(`Migration: node ${peer.name} does not advertise sparse disk transfer — falling back to raw`)
        return false
      }
    }
    return true
  }

  private async remoteSupportsSparse (n: NodeAddr): Promise<boolean> {
    try {
      const r = await this.jsonPost(`https://${n.address}:${n.agentPort}/agent/disk/capabilities`, {}, this.identity(), { expectedCn: n.name })
      const body = this.parseJson(r.text)
      return r.status === 200 && body?.sparse === true
    } catch {
      return false
    }
  }

  /**
   * Wrap a source byte stream in a pass-through that reports cumulative bytes moved to
   * `onBytes` (throttled to ~every total/200 bytes, min 4 MiB, so a 10 GiB copy emits
   * ~200 smooth updates), driving a live migration progress bar. Returns the ORIGINAL
   * stream untouched when there is no sink or no known total. The returned meter owns
   * teardown of the underlying source: destroying it (the transfer failure paths
   * already call srcStream.destroy()) tears down the source too, so no fd / half-open
   * pull connection leaks. Reported `transferred` is clamped to `total` (the framing
   * overhead would otherwise nudge it just past 100%).
   */
  private meter (src: Readable, total: number, onBytes?: (transferred: number, total: number) => void): Readable {
    if (!onBytes || !(total > 0)) return src
    let seen = 0
    let lastEmit = 0
    const step = Math.max(4 * 1024 * 1024, Math.floor(total / 200))
    const emit = (): void => { try { onBytes(Math.min(seen, total), total) } catch { /* best-effort, never breaks the copy */ } }
    const meter = new Transform({
      transform (chunk: Buffer, _enc, cb) {
        seen += chunk.length
        if (seen - lastEmit >= step) { lastEmit = seen; emit() }
        cb(null, chunk)
      },
      flush (cb) { emit(); cb() }
    })
    // Cascade teardown both ways so a failure on either side never leaks the other.
    meter.on('close', () => { if (!src.destroyed) src.destroy() })
    src.on('error', (e) => { if (!meter.destroyed) meter.destroy(e) })
    return src.pipe(meter)
  }

  /**
   * Move one disk source→target over the SPARSE wire: only non-zero regions cross the
   * network, framed with an integrity trailer the RECEIVER verifies (so no side hashes
   * the holes). Handles all three network shapes — local→node (push), node→local
   * (pull+reconstruct), node→node (pull→push relay). Throws on any failure with the
   * source stream released (no leaked fd / half-open pull connection).
   */
  private async transferOneSparse (
    machineId: string,
    p: string,
    ctx: { sourceLocal: boolean, sourceNode: NodeAddr | null, targetLocal: boolean, targetNode: NodeAddr | null },
    onBytes?: (transferred: number, total: number) => void
  ): Promise<void> {
    // Source: a framed sparse stream + the logical (apparent) and allocated (real) sizes.
    let srcStream: Readable
    let logicalSize: number
    let dataSize: number
    if (ctx.sourceLocal) {
      if (!this.store.exists(p)) throw new Error(`source disk missing on master: ${p}`)
      logicalSize = this.store.size(p)
      dataSize = this.store.allocatedBytes(p)
      srcStream = await this.store.createSparseReadStream(p)
    } else {
      // Sparse path proves integrity with the stream's own trailer, so it does NOT need
      // the source sha256 — skip it (`sha256: false`). A whole-disk hash here is pure
      // waste AND overruns the default 15s mTLS deadline on a large qcow2, which is what
      // failed a node→master migration with "cluster mTLS request deadline exceeded".
      const stat = await this.statRemote(ctx.sourceNode!, p, { sha256: false })
      if (!stat.exists || stat.size == null) throw new Error(`source disk missing on node ${ctx.sourceNode!.name}: ${p}`)
      logicalSize = stat.size
      dataSize = stat.allocated ?? stat.size
      srcStream = await this.streamGet(this.sparsePullUrl(ctx.sourceNode!, p), this.identity(), ctx.sourceNode!.name)
    }

    // Meter the framed wire against the allocated (real) size so the UI can show a
    // truthful "X / Y" bar — only the allocated bytes (plus a little framing) cross,
    // never the multi-GiB holes. The framing overhead is clamped out (min(seen,total)).
    srcStream = this.meter(srcStream, dataSize, onBytes)

    try {
      if (ctx.targetLocal) {
        // Master is the target: guard free space, reconstruct locally (trailer verified inside).
        if (dataSize > 0 && this.store.freeBytes() < Math.ceil(dataSize * 1.05)) {
          throw new Error(`insufficient disk space on master for ${p}: need ~${dataSize} bytes, ${this.store.freeBytes()} free`)
        }
        // Cap by the logical span (not the du-derived dataSize) — see the parity note in
        // AgentDiskServer's sparse push. A real over-fill fails safely at write time.
        const written = await this.store.writeFromSparse(p, srcStream, { logicalSize, dataByteCap: logicalSize })
        logger.info(`Migration ${machineId}: disk reconstructed on master (${written.dataBytes} real / ${logicalSize} logical bytes) ${p}`)
      } else {
        // Relay the framed stream to the target node's sparse push (master never interprets it).
        const r = await this.streamPost(this.sparsePushUrl(ctx.targetNode!, p, logicalSize, dataSize), srcStream, this.identity(), ctx.targetNode!.name)
        const body = this.parseJson(r.text)
        if (r.status !== 200 || body?.ok !== true) {
          throw new Error(`sparse disk push to node ${ctx.targetNode!.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
        }
        logger.info(`Migration ${machineId}: disk verified on node ${ctx.targetNode!.name} (${body.dataBytes ?? '?'} real bytes) ${p}`)
      }
    } catch (err) {
      srcStream.destroy() // release the source (local fd or remote pull connection) on any failure
      throw err
    }
  }

  private sparsePullUrl (n: NodeAddr, p: string): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/pull?path=${encodeURIComponent(p)}&sparse=1`
  }

  private sparsePushUrl (n: NodeAddr, p: string, logicalSize: number, dataSize: number): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/push?path=${encodeURIComponent(p)}&sparse=1&size=${logicalSize}&dataSize=${dataSize}`
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

  private async statRemote (n: NodeAddr, p: string, opts: { sha256?: boolean, timeoutMs?: number } = {}): Promise<DiskStat> {
    // sha256 defaults to true (old node agents always hash), but the caller can opt out
    // when it doesn't need the hash — the sparse wire does its own trailer verification.
    // timeoutMs left undefined keeps httpsJsonPost's 15s default; hashing callers pass a
    // larger deadline so a multi-GiB whole-file hash doesn't trip it.
    const r = await this.jsonPost(
      `https://${n.address}:${n.agentPort}/agent/disk/stat`,
      { path: p, sha256: opts.sha256 ?? true },
      this.identity(),
      { expectedCn: n.name, timeoutMs: opts.timeoutMs }
    )
    const body = this.parseJson(r.text)
    if (r.status !== 200 || body?.ok !== true) throw new Error(`disk stat on node ${n.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
    return { exists: body.exists === true, size: body.size, sha256: body.sha256, allocated: body.allocated }
  }

  private async deleteRemote (n: NodeAddr, p: string): Promise<void> {
    const r = await this.jsonPost(`https://${n.address}:${n.agentPort}/agent/disk/delete`, { path: p }, this.identity(), { expectedCn: n.name })
    if (r.status !== 200) throw new Error(`disk delete on node ${n.name} failed (${r.status}): ${r.text.slice(0, 200)}`)
  }

  private parseJson (text: string): any {
    try { return JSON.parse(text) } catch { return null }
  }
}
