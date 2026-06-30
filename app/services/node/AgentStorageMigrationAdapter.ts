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
    // Source integrity reference + byte stream.
    let srcSha: string
    let srcStream: Readable
    if (ctx.sourceLocal) {
      if (!this.store.exists(p)) throw new Error(`source disk missing on master: ${p}`)
      srcSha = await this.store.sha256(p)
      srcStream = this.store.createReadStream(p)
    } else {
      const stat = await this.statRemote(ctx.sourceNode!, p)
      if (!stat.exists || !stat.sha256) throw new Error(`source disk missing on node ${ctx.sourceNode!.name}: ${p}`)
      srcSha = stat.sha256
      srcStream = await this.streamGet(this.pullUrl(ctx.sourceNode!, p), this.identity(), ctx.sourceNode!.name)
    }

    // Target write + its own sha256 of what landed.
    let tgtSha: string
    if (ctx.targetLocal) {
      const written = await this.store.writeFrom(p, srcStream)
      tgtSha = written.sha256
      if (tgtSha !== srcSha) { await this.store.unlink(p); throw new Error(`sha256 mismatch writing ${p} on master (src ${srcSha}, dst ${tgtSha})`) }
    } else {
      const r = await this.streamPost(this.pushUrl(ctx.targetNode!, p, srcSha), srcStream, this.identity(), ctx.targetNode!.name)
      const body = this.parseJson(r.text)
      if (r.status !== 200 || body?.ok !== true) {
        throw new Error(`disk push to node ${ctx.targetNode!.name} failed (${r.status}): ${r.text.slice(0, 300)}`)
      }
      tgtSha = String(body.sha256 ?? '')
      if (tgtSha !== srcSha) throw new Error(`sha256 mismatch pushing ${p} to ${ctx.targetNode!.name} (src ${srcSha}, dst ${tgtSha})`)
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

  private pushUrl (n: NodeAddr, p: string, sha256: string): string {
    return `https://${n.address}:${n.agentPort}/agent/disk/push?path=${encodeURIComponent(p)}&sha256=${sha256}`
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
