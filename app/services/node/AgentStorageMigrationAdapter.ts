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
  }): Promise<void> {
    const { machineId, sourceNodeId, targetNodeId, diskPaths } = params
    if (sourceNodeId === targetNodeId) return // same node — nothing to move
    if (diskPaths.length === 0) {
      logger.warn(`Migration ${machineId}: no disk paths recorded — nothing to copy (the VM may not be provisioned yet)`)
      return
    }

    const localNodeId = await this.resolveLocal()
    const sourceLocal = sourceNodeId == null || (localNodeId != null && sourceNodeId === localNodeId)
    const targetLocal = localNodeId != null && targetNodeId === localNodeId

    const sourceNode = sourceLocal ? null : await this.requireNode(sourceNodeId as string, 'source')
    const targetNode = targetLocal ? null : await this.requireNode(targetNodeId, 'target')

    // CRITICAL data-safety: no-op when BOTH legs resolve to the SAME physical disk
    // store. diskDir is uniform cluster-wide (see file header), so a leg's physical
    // identity is `local` for the master's own node, else `${address}:${agentPort}`.
    // When the keys match, source and target are the SAME file at the SAME path:
    // copying it onto itself (temp → rename back) and then unlinking the "source"
    // would destroy the VM's only qcow2 — the sha256 self-check cannot detect this.
    // This subsumes the master-local&&local case (a VM with nodeId=null migrated to
    // the master's own node id, where the raw id no-op check null===masterId is false)
    // AND two distinct Node rows (re-onboarded / cloned host) that share an
    // address+agentPort, which would otherwise pull-then-push over the same inode and
    // then delete it during the I2 source reclaim.
    const srcKey = sourceLocal ? 'local' : `${sourceNode!.address}:${sourceNode!.agentPort}`
    const tgtKey = targetLocal ? 'local' : `${targetNode!.address}:${targetNode!.agentPort}`
    if (srcKey === tgtKey) {
      logger.info(`Migration ${machineId}: source and target resolve to the same physical disk store (${srcKey}) — disk already in place, no copy needed`)
      return
    }

    logger.info(`Migration ${machineId}: copying ${diskPaths.length} disk(s) ${sourceLocal ? 'master(local)' : sourceNode!.name} → ${targetLocal ? 'master(local)' : targetNode!.name}`)

    // 1+2+3: transfer every disk and prove its integrity on the target BEFORE any deletion.
    for (const p of diskPaths) {
      const srcSha = await this.transferOne(p, { sourceLocal, sourceNode, targetLocal, targetNode })
      logger.info(`Migration ${machineId}: disk verified on target (sha256 ${srcSha.slice(0, 16)}…) ${p}`)
    }

    // 4: only now is it safe to reclaim the source (invariant I2).
    if (this.deleteSourceAfter) {
      for (const p of diskPaths) {
        try {
          if (sourceLocal) await this.store.unlink(p)
          else await this.deleteRemote(sourceNode!, p)
        } catch (err) {
          // The migration already succeeded (target verified); a stale source is a
          // leak to clean up, not a failure to surface to the user.
          logger.warn(`Migration ${machineId}: source disk cleanup failed for ${p} (left in place): ${String(err)}`)
        }
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
