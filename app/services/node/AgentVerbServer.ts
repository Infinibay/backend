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

  return router
}
