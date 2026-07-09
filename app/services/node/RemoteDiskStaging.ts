import path from 'path'
import logger from '@main/logger'
import { LocalDiskStore } from './AgentDiskServer'
import { masterIdentity } from './NodeDispatcher'
import { httpsJsonPost, type ClusterIdentity } from './clusterMtls'
import { streamGetOverMtls, streamPostOverMtls } from './clusterStream'

/**
 * Stage a remote node's VM disk(s) onto the MASTER and back, for operations that run
 * centrally on the master but whose disk lives on a compute node with LOCAL
 * (non-shared) storage — today backup (pull the disk in, qemu-img it on the master,
 * drop the staged copy) and restore (materialize on the master, push it to the node).
 * Uses the same mTLS disk channel the cross-node migration uses (AgentDiskServer on the
 * node), with the same end-to-end sha256 verification. When storage is SHARED
 * (NFS/Ceph/shared-mount) the disk is already reachable at the master's path, so no
 * staging is needed and this helper is unused.
 *
 * SAFETY — why this can never delete a real VM disk (audit: the previous same-path
 * design could, on a node-classification mistake, unlink the VM's only qcow2):
 *   - Every staged copy lives at a SCRATCH path under a dedicated per-VM subdir
 *     (`${diskDir}/.backup-staging/<vmId>/…`), NEVER at the disk's real flat path.
 *   - `cleanupLocal()` removes ONLY the scratch paths THIS instance actually created
 *     (`staged`), so even if the caller mis-decides that a master-local VM is remote,
 *     the worst case is a failed operation — never data loss.
 * Reuse ONE instance across stageIn/registerMaterialize + cleanupLocal so the tracked
 * set survives (do not `new` it separately for cleanup).
 */
export interface StagingNode {
  name: string
  address: string
  agentPort: number
}

/** Dedicated subdir under the master disk dir for staged scratch. Never holds real VM disks. */
const STAGING_SUBDIR = '.backup-staging'

/**
 * mTLS deadline for a stat that hashes the whole remote disk (stageIn verifies the
 * pulled bytes against it). A sha256 is a full-file read — seconds→minutes for a
 * multi-GiB qcow2 — so the default 15s deadline is far too tight. Mirrors
 * AgentStorageMigrationAdapter's raw-path stat timeout.
 */
const REMOTE_STAT_HASH_TIMEOUT_MS = 60 * 60 * 1000

export class RemoteDiskStaging {
  private readonly store: LocalDiskStore
  private readonly identity: () => ClusterIdentity
  private readonly baseDir: string
  private readonly vmId: string
  /** Absolute scratch paths this instance created — the ONLY paths cleanupLocal may unlink. */
  private readonly staged = new Set<string>()

  constructor (diskDir: string, vmId: string, identity: () => ClusterIdentity = masterIdentity) {
    this.baseDir = path.resolve(diskDir)
    this.store = new LocalDiskStore(this.baseDir)
    this.vmId = vmId
    this.identity = identity
  }

  /**
   * Deterministic master-local SCRATCH path for a remote disk. Lives in a dedicated
   * per-VM staging subdir, never at the disk's real flat path — so cleanup can only ever
   * touch scratch, never a real VM disk, even if node classification is wrong.
   */
  private scratchPathFor (realPath: string): string {
    return path.join(this.baseDir, STAGING_SUBDIR, this.vmId, path.basename(realPath))
  }

  scratchPathsFor (realPaths: string[]): string[] {
    return realPaths.map((p) => this.scratchPathFor(p))
  }

  private pullUrl (n: StagingNode, p: string): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/pull?path=${encodeURIComponent(p)}`
  }

  private pushUrl (n: StagingNode, p: string, sha256: string, size: number): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/push?path=${encodeURIComponent(p)}&sha256=${sha256}&size=${size}`
  }

  private statUrl (n: StagingNode): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/stat`
  }

  /**
   * Pull each remote disk into a master-local SCRATCH path (sha256-verified) and return
   * the scratch paths in the SAME order — the caller hands these to qemu-img instead of
   * the real paths. Registers each staged path for cleanup.
   */
  async stageIn (node: StagingNode, realPaths: string[]): Promise<string[]> {
    const scratch: string[] = []
    for (const real of realPaths) {
      const dst = this.scratchPathFor(real)
      const stat = await this.statRemote(node, real)
      if (!stat.exists || !stat.sha256) throw new Error(`disk missing on node ${node.name}: ${real}`)
      // Require a POSITIVE declared size (mirrors the node push router's size>0 rule). A node
      // reporting size 0/undefined would otherwise skip BOTH the free-space precheck and the
      // writeFrom maxBytes ceiling below (both keyed on a truthy size), letting a misbehaving
      // mTLS peer stream an unbounded body into the master fs and ENOSPC co-located VM disks.
      if (!stat.size || stat.size <= 0) {
        throw new Error(`node ${node.name} reported no/invalid size for ${real} — refusing to stage`)
      }

      // Free-space guard (mirrors AgentStorageMigrationAdapter.transferOne): refuse BEFORE
      // pulling if the master fs can't hold the image (+5% margin), so a large remote disk
      // can't ENOSPC the master's own co-located VM disks sharing this filesystem.
      const ceiling = Math.ceil(stat.size * 1.05)
      if (this.store.freeBytes() < ceiling) {
        throw new Error(`insufficient disk space on master to stage ${real}: need ~${stat.size} bytes, ${this.store.freeBytes()} free`)
      }

      const stream = await streamGetOverMtls(this.pullUrl(node, real), this.identity(), node.name)
      let written: { size: number, sha256: string }
      try {
        // maxBytes is a second-line ceiling: writeFrom aborts + rm's the temp the instant
        // the body overruns the declared size (a lying/misbehaving source).
        written = await this.store.writeFrom(dst, stream, ceiling)
      } catch (err) {
        // Release the pull connection on ANY write-path failure — including a pre-pipeline
        // synchronous throw (e.g. openSync ENOSPC/EMFILE) that pipeline() would not cover,
        // which would otherwise leak the fd/socket on both the master and the source node.
        stream.destroy()
        await this.store.unlink(dst).catch(() => {})
        throw err
      }
      this.staged.add(path.resolve(dst))
      if (written.sha256 !== stat.sha256) {
        await this.store.unlink(dst).catch(() => {})
        throw new Error(`sha256 mismatch staging ${real} from ${node.name} (src ${stat.sha256}, dst ${written.sha256})`)
      }
      scratch.push(dst)
      logger.info(`Backup staging: pulled ${real} from node ${node.name} → scratch (${written.size} bytes)`)
    }
    return scratch
  }

  /**
   * Compute the scratch targets an EXTERNALLY-materialized restore will write to
   * (infinization.restoreBackup writes here), clear any stale scratch left by a crashed
   * run, and register them for cleanup. Returns the scratch paths (same order).
   */
  async beginMaterialize (realPaths: string[]): Promise<string[]> {
    const scratch = this.scratchPathsFor(realPaths)
    for (const s of scratch) {
      await this.store.unlink(s).catch(() => {}) // scratch-only path — always safe to clear
      this.staged.add(path.resolve(s))
    }
    return scratch
  }

  /**
   * Push each master-local SCRATCH disk back to the node's REAL path (the node verifies
   * sha256 and renames atomically, so its live disk is never a half-written image).
   *
   * NON-ATOMIC across multiple disks (audit, low): disks are pushed sequentially, so a
   * failure on disk N leaves disks 0..N-1 already committed on the node and disk N
   * untouched. There is no permanent data loss — the authoritative backup artifact is
   * never touched, so a full re-restore reconstructs every disk — but a partially-pushed
   * multi-disk VM is left mixed until the restore is retried. (Node-side 2-phase commit
   * across disks is a tracked follow-up.)
   */
  async pushBack (node: StagingNode, realPaths: string[]): Promise<void> {
    for (const real of realPaths) {
      const src = this.scratchPathFor(real)
      if (!this.store.exists(src)) throw new Error(`staged disk missing to push back: ${src}`)
      const sha256 = await this.store.sha256(src)
      const size = this.store.size(src)
      const stream = this.store.createReadStream(src)
      let r
      try {
        r = await streamPostOverMtls(this.pushUrl(node, real, sha256, size), stream, this.identity(), node.name)
      } catch (err) {
        stream.destroy()
        throw err
      }
      const body = this.parseJson(r.text)
      if (r.status !== 200 || body?.ok !== true) {
        throw new Error(`disk push to node ${node.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
      }
      if (String(body.sha256 ?? '') !== sha256) {
        throw new Error(`sha256 mismatch pushing ${real} to node ${node.name}`)
      }
      logger.info(`Backup staging: pushed scratch → ${real} on node ${node.name}`)
    }
  }

  /** Best-effort removal of ONLY the scratch copies this instance staged (never a real disk). Never throws. */
  async cleanupLocal (): Promise<void> {
    for (const dst of this.staged) {
      try {
        await this.store.unlink(dst)
      } catch (err) {
        logger.warn(`Backup staging: cleanup of scratch ${dst} failed (left in place): ${String(err)}`)
      }
    }
    this.staged.clear()
  }

  /** Whether the node currently holds a real disk at `realPath` (used to honor overwriteExisting=false). */
  async remoteExists (node: StagingNode, realPath: string): Promise<boolean> {
    // Existence only — never make the node hash the whole disk (and never block on it)
    // just to answer a yes/no.
    return (await this.statRemote(node, realPath, { sha256: false })).exists
  }

  private async statRemote (
    n: StagingNode,
    p: string,
    opts: { sha256?: boolean, timeoutMs?: number } = {}
  ): Promise<{ exists: boolean, size?: number, sha256?: string }> {
    // stageIn needs the sha256 (it verifies the pulled bytes against it) → default true +
    // a generous deadline so a multi-GiB whole-file hash doesn't trip the 15s default.
    const wantSha = opts.sha256 ?? true
    const r = await httpsJsonPost(
      this.statUrl(n),
      { path: p, sha256: wantSha },
      this.identity(),
      { expectedCn: n.name, timeoutMs: opts.timeoutMs ?? (wantSha ? REMOTE_STAT_HASH_TIMEOUT_MS : undefined) }
    )
    const body = this.parseJson(r.text)
    if (r.status !== 200 || body?.ok !== true) throw new Error(`disk stat on node ${n.name} failed (${r.status}): ${r.text.slice(0, 200)}`)
    return { exists: body.exists === true, size: body.size, sha256: body.sha256 }
  }

  private parseJson (text: string): any {
    try { return JSON.parse(text) } catch { return null }
  }
}
