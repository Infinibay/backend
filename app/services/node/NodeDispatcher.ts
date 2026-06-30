import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { resolveLocalNodeId } from '../InfinizationService'
import {
  type NodeExecutor,
  RemoteNodeExecutor,
  HttpVmRpcTransport
} from './NodeExecutor'
import { LocalNodeExecutor } from './LocalNodeExecutor'

/**
 * Multi-node Phase 1 (VM-op routing): resolves WHICH host executes a VM verb.
 *
 * Given a `Machine.id`, the dispatcher reads `Machine.nodeId` and compares it to
 * THIS host's node identity:
 *
 *   - same node (or the VM/host is unscoped) → `LocalNodeExecutor` (in-process
 *     infinization — the unchanged single-node path).
 *   - a different, registered node           → `RemoteNodeExecutor` targeting
 *     that node agent's verb server.
 *
 * SAFETY (G0): if a VM belongs to another node we NEVER fall back to local
 * execution — the disk and qemu process live on the owning host, so running the
 * verb here would operate on nothing (or, worse, a stale local artifact). When
 * the owning node has no reachable address we throw a clear error rather than
 * silently mis-executing. Fail closed.
 */

export interface RemoteNodeInfo {
  id: string
  name: string
  address: string
  agentPort: number
}

export interface NodeDispatcherDeps {
  /** Override local node resolution (tests). Defaults to InfinizationService. */
  resolveLocalNodeId?: () => Promise<string | undefined>
  /** Override local executor construction (tests). */
  createLocalExecutor?: () => NodeExecutor
  /** Override remote executor construction (tests). */
  createRemoteExecutor?: (node: RemoteNodeInfo) => NodeExecutor
}

export class NodeDispatcher {
  private readonly resolveLocalNodeId: () => Promise<string | undefined>
  private readonly createLocalExecutor: () => NodeExecutor
  private readonly createRemoteExecutor: (node: RemoteNodeInfo) => NodeExecutor

  constructor (private readonly prisma: PrismaClient, deps: NodeDispatcherDeps = {}) {
    this.resolveLocalNodeId = deps.resolveLocalNodeId ?? resolveLocalNodeId
    this.createLocalExecutor = deps.createLocalExecutor ?? (() => new LocalNodeExecutor())
    this.createRemoteExecutor = deps.createRemoteExecutor ?? defaultRemoteExecutor
  }

  /**
   * Resolve the executor that owns `machineId`. Reads Machine.nodeId once and
   * routes; throws only when the VM provably belongs to an unreachable node.
   */
  async executorFor (machineId: string): Promise<NodeExecutor> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { nodeId: true }
    })

    // No owning node (legacy/unscoped VM) → local, single-host behaviour. Checked
    // first so the common single-node path never even resolves a local node id.
    if (!machine?.nodeId) {
      return this.createLocalExecutor()
    }

    const localNodeId = await this.resolveLocalNodeId()

    // This host isn't registered yet (single-host mode) or the VM is ours.
    if (!localNodeId || machine.nodeId === localNodeId) {
      return this.createLocalExecutor()
    }

    // The VM belongs to a DIFFERENT node — it MUST run there.
    const node = await this.prisma.node.findUnique({
      where: { id: machine.nodeId },
      select: { id: true, name: true, address: true, agentPort: true, status: true }
    })
    if (!node || !node.address) {
      throw new Error(
        `Cannot route VM ${machineId}: it belongs to node ${machine.nodeId} ` +
        `which has no reachable address (status=${node?.status ?? 'unknown'}). Refusing to execute locally.`
      )
    }
    if (node.status === 'offline' || node.status === 'maintenance') {
      logger.warn(`Routing VM ${machineId} to node ${node.name} which is ${node.status} — agent may be unreachable`)
    }
    return this.createRemoteExecutor({
      id: node.id,
      name: node.name,
      address: node.address,
      agentPort: node.agentPort
    })
  }
}

/**
 * Default remote executor: an HTTP verb client pointed at the owning node
 * agent's verb server, authenticated with the shared cluster token (pre-mTLS).
 */
function defaultRemoteExecutor (node: RemoteNodeInfo): NodeExecutor {
  const token = process.env.INFINIBAY_CLUSTER_TOKEN
  if (!token) {
    throw new Error('INFINIBAY_CLUSTER_TOKEN is not set — cannot reach remote node agents')
  }
  const transport = new HttpVmRpcTransport({
    agentUrl: `http://${node.address}:${node.agentPort}`,
    token
  })
  return new RemoteNodeExecutor(transport)
}
