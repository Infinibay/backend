import type { Infinization } from '@infinibay/infinization'
import { httpsJsonPost, type ClusterIdentity } from './clusterMtls'

/**
 * Multi-node Phase 1 (VM-op routing): the node-agnostic VM lifecycle surface.
 *
 * Every VM verb the backend invokes goes through a `NodeExecutor` rather than the
 * in-process infinization instance directly. Two implementations:
 *
 *   - `LocalNodeExecutor`  (see LocalNodeExecutor.ts) — forwards to THIS host's
 *     `getInfinization()`. Byte-for-byte the single-node behaviour. Kept in a
 *     separate module so this file carries NO runtime dependency on the backend
 *     InfinizationService/Prisma singleton — a node agent imports the verb wire
 *     (this file) without dragging in a database connection.
 *   - `RemoteNodeExecutor` — forwards each verb over RPC to the node agent that
 *     actually owns the VM (its disk + qemu process live there). Mirror of the
 *     DB facade (`RpcDatabaseAdapter` / `HttpDbRpcTransport`).
 *
 * The interface is derived structurally from the `Infinization` class type, so
 * the executor surface can never drift from what infinization exposes: change a
 * verb signature in the library and this fails to compile until the executors
 * match.
 */

/** The infinization instance type (single source of truth for verb signatures). */
type Inf = Infinization

export interface NodeExecutor {
  createVM: Inf['createVM']
  startVM: Inf['startVM']
  stopVM: Inf['stopVM']
  restartVM: Inf['restartVM']
  resetVM: Inf['resetVM']
  suspendVM: Inf['suspendVM']
  resumeVM: Inf['resumeVM']
  destroyVM: Inf['destroyVM']
  getVMStatus: Inf['getVMStatus']
  attachToRunningVM: Inf['attachToRunningVM']
  guestExec: Inf['guestExec']
}

type E = NodeExecutor

/**
 * The complete set of VM verbs a node agent may execute over the wire. The
 * agent's verb server uses this as its allowlist (only these are invokable
 * remotely); `RemoteNodeExecutor` and tests use it to prove every verb forwards.
 */
export const VM_VERB_METHODS: ReadonlyArray<keyof NodeExecutor> = [
  'createVM',
  'startVM',
  'stopVM',
  'restartVM',
  'resetVM',
  'suspendVM',
  'resumeVM',
  'destroyVM',
  'getVMStatus',
  'attachToRunningVM',
  'guestExec'
]

/** Pluggable transport: turns a (verb, args) pair into the agent's result. */
export interface VmRpcTransport {
  call (verb: string, args: unknown[]): Promise<unknown>
}

/**
 * Executes VM verbs on a REMOTE node agent by forwarding (verb, args) over a
 * transport. Implemented in terms of `NodeExecutor` (Parameters/ReturnType) so it
 * stays in lock-step with the interface — same self-syncing pattern as
 * `RpcDatabaseAdapter`.
 */
export class RemoteNodeExecutor implements NodeExecutor {
  constructor (private readonly transport: VmRpcTransport) {}

  private invoke (verb: keyof E, args: unknown[]): Promise<unknown> {
    return this.transport.call(verb as string, args)
  }

  createVM (...a: Parameters<E['createVM']>): ReturnType<E['createVM']> {
    return this.invoke('createVM', a) as ReturnType<E['createVM']>
  }

  startVM (...a: Parameters<E['startVM']>): ReturnType<E['startVM']> {
    return this.invoke('startVM', a) as ReturnType<E['startVM']>
  }

  stopVM (...a: Parameters<E['stopVM']>): ReturnType<E['stopVM']> {
    return this.invoke('stopVM', a) as ReturnType<E['stopVM']>
  }

  restartVM (...a: Parameters<E['restartVM']>): ReturnType<E['restartVM']> {
    return this.invoke('restartVM', a) as ReturnType<E['restartVM']>
  }

  resetVM (...a: Parameters<E['resetVM']>): ReturnType<E['resetVM']> {
    return this.invoke('resetVM', a) as ReturnType<E['resetVM']>
  }

  suspendVM (...a: Parameters<E['suspendVM']>): ReturnType<E['suspendVM']> {
    return this.invoke('suspendVM', a) as ReturnType<E['suspendVM']>
  }

  resumeVM (...a: Parameters<E['resumeVM']>): ReturnType<E['resumeVM']> {
    return this.invoke('resumeVM', a) as ReturnType<E['resumeVM']>
  }

  destroyVM (...a: Parameters<E['destroyVM']>): ReturnType<E['destroyVM']> {
    return this.invoke('destroyVM', a) as ReturnType<E['destroyVM']>
  }

  getVMStatus (...a: Parameters<E['getVMStatus']>): ReturnType<E['getVMStatus']> {
    return this.invoke('getVMStatus', a) as ReturnType<E['getVMStatus']>
  }

  attachToRunningVM (...a: Parameters<E['attachToRunningVM']>): ReturnType<E['attachToRunningVM']> {
    return this.invoke('attachToRunningVM', a) as ReturnType<E['attachToRunningVM']>
  }

  guestExec (...a: Parameters<E['guestExec']>): ReturnType<E['guestExec']> {
    return this.invoke('guestExec', a) as ReturnType<E['guestExec']>
  }
}

/**
 * HTTP transport: POSTs {verb, args} to a node agent's verb server and returns
 * the `result`.
 *
 * Two auth modes (mirroring HttpDbRpcTransport, opposite direction):
 *   - mTLS (Phase 2.1d): when `identity` is supplied the master presents its
 *     CA-signed client certificate over HTTPS; the agent verb server requires it
 *     and (optionally) pins the master CN. No bearer token.
 *   - token (pre-mTLS): the shared bootstrap bearer token over plain HTTP.
 */
export class HttpVmRpcTransport implements VmRpcTransport {
  constructor (
    private readonly opts: {
      agentUrl: string
      token?: string
      identity?: ClusterIdentity
      /** The target node's CN, pinned on its mTLS verb-server cert (required with `identity`). */
      expectedCn?: string
      fetchImpl?: typeof fetch
    }
  ) {
    if (opts.identity && (!opts.expectedCn || opts.expectedCn.length === 0)) {
      throw new Error('HttpVmRpcTransport: expectedCn is required for mTLS (pin the target node identity)')
    }
  }

  async call (verb: string, args: unknown[]): Promise<unknown> {
    const url = `${this.opts.agentUrl.replace(/\/+$/, '')}/agent/vm`
    const payload = { verb, args }

    let status: number
    let text: string
    if (this.opts.identity) {
      const r = await httpsJsonPost(url, payload, this.opts.identity, { expectedCn: this.opts.expectedCn! })
      status = r.status
      text = r.text
    } else {
      const doFetch = this.opts.fetchImpl ?? fetch
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.token ?? ''}` },
        body: JSON.stringify(payload)
      })
      status = res.status
      text = await res.text().catch(() => '')
    }

    if (status < 200 || status >= 300) {
      throw new Error(`VM RPC ${verb} failed (${status}): ${text}`)
    }
    let body: { ok?: boolean, result?: unknown, error?: string }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Error(`VM RPC ${verb} returned a non-JSON response`)
    }
    if (body.ok !== true) {
      throw new Error(`VM RPC ${verb} error: ${body.error ?? 'unknown'}`)
    }
    return body.result
  }
}
