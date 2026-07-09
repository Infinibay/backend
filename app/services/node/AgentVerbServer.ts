import express, { Request, RequestHandler, Response } from 'express'
import { requireClusterToken } from './clusterAuth'
import { requireClientCert } from './clusterMtls'
import { VM_VERB_METHODS, type NodeExecutor } from './NodeExecutor'

/**
 * Multi-node Phase 1 (VM-op routing): the node-agent side of the VM verb wire.
 *
 * The master's `RemoteNodeExecutor` POSTs {verb, args} here; the agent executes
 * the verb against ITS OWN in-process infinization (which reaches the master's DB
 * via an injected RpcDatabaseAdapter) and returns the result. This is the verb
 * counterpart of the master's POST /cluster/db.
 *
 * SECURITY: the verb MUST be on the allowlist (exactly VM_VERB_METHODS — no
 * arbitrary method access), and the request MUST carry the shared cluster token
 * (pre-mTLS; Phase 2 swaps in the per-node client certificate). Fail-closed.
 *
 * The target is resolved lazily via `getTarget()` so a heartbeat-only node never
 * has to construct (root/KVM-requiring) infinization until a verb actually
 * arrives.
 */

const VERB_ALLOWLIST = new Set<string>(VM_VERB_METHODS as readonly string[])

export interface AgentVerbServerOptions {
  /** Resolve (and lazily construct) this node's infinization-backed executor. */
  getTarget: () => Promise<NodeExecutor>
  /** JSON body limit (createVM configs can be sizeable). */
  jsonLimit?: string
  /**
   * Auth mode. 'token' (default) requires the shared bootstrap bearer token over
   * plain HTTP. 'mtls' requires a verified client certificate (the master's),
   * optionally pinned to `masterCn` — used when the verb server runs over HTTPS.
   */
  auth?: 'token' | 'mtls'
  /** Under mTLS, the only CN allowed to call verbs (the master's node name). */
  masterCn?: string
  /**
   * Phase 2 (node-hosted VM commands): deliver a MASTER-SIGNED message envelope to
   * a local VM's guest socket. The master signs (it holds the HMAC secret); this
   * node just writes the opaque bytes. When provided, registers
   * POST /agent-command. Returns false when the VM has no live socket on this node.
   */
  deliverAgentCommand?: (vmId: string, envelope: unknown) => boolean
}

/**
 * Build the agent's verb router. Mount at `/agent` so the verb endpoint is
 * `POST /agent/vm`, matching HttpVmRpcTransport.
 */
export function createAgentVerbRouter (opts: AgentVerbServerOptions): express.Router {
  const router = express.Router()
  const auth: RequestHandler = opts.auth === 'mtls' ? requireClientCert(opts.masterCn) : requireClusterToken

  router.post('/vm', express.json({ limit: opts.jsonLimit ?? '1mb' }), auth, async (req: Request, res: Response) => {
    try {
      const { verb, args } = (req.body ?? {}) as { verb?: unknown, args?: unknown }
      if (typeof verb !== 'string' || !VERB_ALLOWLIST.has(verb)) {
        res.status(400).json({ ok: false, error: `verb not allowed: ${String(verb)}` })
        return
      }
      const callArgs = Array.isArray(args) ? args : []

      const target = await opts.getTarget()
      const fn = (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[verb]
      const result = await fn.apply(target, callArgs)
      res.json({ ok: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ ok: false, error: message })
    }
  })

  // Phase 2: the master relays a signed command envelope for a node-hosted VM here;
  // we write the opaque bytes to that VM's local guest socket (the master already
  // authorized the vmId against this node). Same auth as /vm (mTLS master cert /
  // token). No response body is echoed — the guest's reply returns via telemetry.
  if (opts.deliverAgentCommand) {
    const deliver = opts.deliverAgentCommand
    // 8mb: command envelopes are tiny, but a relayed pending_scripts_response
    // carries full (interpolated) script content, which can be sizeable.
    router.post('/agent-command', express.json({ limit: '8mb' }), auth, (req: Request, res: Response) => {
      const { vmId, envelope } = (req.body ?? {}) as { vmId?: unknown, envelope?: unknown }
      if (typeof vmId !== 'string' || vmId.length === 0 || envelope == null || typeof envelope !== 'object') {
        res.status(400).json({ delivered: false, error: 'vmId (string) and envelope (object) are required' })
        return
      }
      const delivered = deliver(vmId, envelope)
      if (!delivered) {
        res.status(409).json({ delivered: false, error: `VM ${vmId} has no live guest socket on this node` })
        return
      }
      res.json({ delivered: true })
    })
  }

  return router
}
