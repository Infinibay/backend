import type { InfinizationDatabase } from '@infinibay/infinization'
import { PrismaAdapterError, PrismaAdapterErrorCode } from '@infinibay/infinization'
import { httpsJsonPost, type ClusterIdentity } from './clusterMtls'

/**
 * Multi-node Phase 1 (increment 3): the compute-node side of the DB facade.
 *
 * A Node Agent injects an `RpcDatabaseAdapter` into infinization (via
 * InfinizationConfig.databaseAdapter) instead of a Prisma client, so the node
 * holds NO database connection. Every one of the 16 `InfinizationDatabase`
 * methods is forwarded to the master over a transport; the master executes it on
 * a node-SCOPED PrismaAdapter and returns the result (see POST /cluster/db).
 *
 * Implemented entirely in terms of `InfinizationDatabase` (Parameters/ReturnType)
 * so it stays in lock-step with the interface — add a method to the facade and
 * this fails to compile until it is forwarded too. `implements` guarantees the
 * shape matches what infinization calls.
 */

/** Pluggable transport: turns a (method, args) pair into the master's result. */
export interface DbRpcTransport {
  call (method: string, args: unknown[]): Promise<unknown>
}

type M = InfinizationDatabase

export class RpcDatabaseAdapter implements InfinizationDatabase {
  constructor (private readonly transport: DbRpcTransport) {}

  private invoke (method: keyof M, args: unknown[]): Promise<unknown> {
    return this.transport.call(method as string, args)
  }

  findMachine (...a: Parameters<M['findMachine']>): ReturnType<M['findMachine']> {
    return this.invoke('findMachine', a) as ReturnType<M['findMachine']>
  }

  findMachineByInternalName (...a: Parameters<M['findMachineByInternalName']>): ReturnType<M['findMachineByInternalName']> {
    return this.invoke('findMachineByInternalName', a) as ReturnType<M['findMachineByInternalName']>
  }

  findMachineWithConfig (...a: Parameters<M['findMachineWithConfig']>): ReturnType<M['findMachineWithConfig']> {
    return this.invoke('findMachineWithConfig', a) as ReturnType<M['findMachineWithConfig']>
  }

  findRunningVMs (...a: Parameters<M['findRunningVMs']>): ReturnType<M['findRunningVMs']> {
    return this.invoke('findRunningVMs', a) as ReturnType<M['findRunningVMs']>
  }

  findMachinesByStatuses (...a: Parameters<M['findMachinesByStatuses']>): ReturnType<M['findMachinesByStatuses']> {
    return this.invoke('findMachinesByStatuses', a) as ReturnType<M['findMachinesByStatuses']>
  }

  updateMachineStatus (...a: Parameters<M['updateMachineStatus']>): ReturnType<M['updateMachineStatus']> {
    return this.invoke('updateMachineStatus', a) as ReturnType<M['updateMachineStatus']>
  }

  updateMachineConfiguration (...a: Parameters<M['updateMachineConfiguration']>): ReturnType<M['updateMachineConfiguration']> {
    return this.invoke('updateMachineConfiguration', a) as ReturnType<M['updateMachineConfiguration']>
  }

  transitionVMStatus (...a: Parameters<M['transitionVMStatus']>): ReturnType<M['transitionVMStatus']> {
    return this.invoke('transitionVMStatus', a) as ReturnType<M['transitionVMStatus']>
  }

  clearMachineConfiguration (...a: Parameters<M['clearMachineConfiguration']>): ReturnType<M['clearMachineConfiguration']> {
    return this.invoke('clearMachineConfiguration', a) as ReturnType<M['clearMachineConfiguration']>
  }

  clearVolatileMachineConfiguration (...a: Parameters<M['clearVolatileMachineConfiguration']>): ReturnType<M['clearVolatileMachineConfiguration']> {
    return this.invoke('clearVolatileMachineConfiguration', a) as ReturnType<M['clearVolatileMachineConfiguration']>
  }

  getMachineInternalName (...a: Parameters<M['getMachineInternalName']>): ReturnType<M['getMachineInternalName']> {
    return this.invoke('getMachineInternalName', a) as ReturnType<M['getMachineInternalName']>
  }

  getMachineDiskPath (...a: Parameters<M['getMachineDiskPath']>): ReturnType<M['getMachineDiskPath']> {
    return this.invoke('getMachineDiskPath', a) as ReturnType<M['getMachineDiskPath']>
  }

  getFirewallRules (...a: Parameters<M['getFirewallRules']>): ReturnType<M['getFirewallRules']> {
    return this.invoke('getFirewallRules', a) as ReturnType<M['getFirewallRules']>
  }

  getFirewallRulesSplit (...a: Parameters<M['getFirewallRulesSplit']>): ReturnType<M['getFirewallRulesSplit']> {
    return this.invoke('getFirewallRulesSplit', a) as ReturnType<M['getFirewallRulesSplit']>
  }

  getDepartmentFirewallPolicy (...a: Parameters<M['getDepartmentFirewallPolicy']>): ReturnType<M['getDepartmentFirewallPolicy']> {
    return this.invoke('getDepartmentFirewallPolicy', a) as ReturnType<M['getDepartmentFirewallPolicy']>
  }

  getFirewallRuleSetId (...a: Parameters<M['getFirewallRuleSetId']>): ReturnType<M['getFirewallRuleSetId']> {
    return this.invoke('getFirewallRuleSetId', a) as ReturnType<M['getFirewallRuleSetId']>
  }
}

/**
 * The complete set of DB-facade method names. The master's RPC server uses this
 * as the allowlist (only these may be invoked over the wire), and tests use it
 * to assert RpcDatabaseAdapter forwards every one.
 */
export const DB_FACADE_METHODS: ReadonlyArray<keyof M> = [
  'findMachine',
  'findMachineByInternalName',
  'findMachineWithConfig',
  'findRunningVMs',
  'findMachinesByStatuses',
  'updateMachineStatus',
  'updateMachineConfiguration',
  'transitionVMStatus',
  'clearMachineConfiguration',
  'clearVolatileMachineConfiguration',
  'getMachineInternalName',
  'getMachineDiskPath',
  'getFirewallRules',
  'getFirewallRulesSplit',
  'getDepartmentFirewallPolicy',
  'getFirewallRuleSetId'
]

/**
 * HTTP transport: POSTs {nodeName, method, args} to the master's /cluster/db and
 * returns the `result`.
 *
 * Two auth modes:
 *   - mTLS (Phase 2.1d): when `identity` is supplied the node presents its
 *     per-node client certificate over HTTPS; the master derives the node identity
 *     from the verified cert CN and IGNORES the body's nodeName. No bearer token.
 *   - token (pre-mTLS / walking skeleton): a shared bootstrap bearer token over
 *     plain HTTP, with the node name self-asserted in the body.
 */
export class HttpDbRpcTransport implements DbRpcTransport {
  constructor (
    private readonly opts: {
      masterUrl: string
      nodeName: string
      token?: string
      // A value, or a getter resolved per-call so a renewed (rotated) certificate
      // is picked up in-process without rebuilding the transport (Phase 2.1e).
      identity?: ClusterIdentity | (() => ClusterIdentity)
      /** The master's CN, pinned on the mTLS server cert (required with `identity`). */
      masterCn?: string
      fetchImpl?: typeof fetch
    }
  ) {
    if (opts.identity && (!opts.masterCn || opts.masterCn.length === 0)) {
      throw new Error('HttpDbRpcTransport: masterCn is required for mTLS (pin the master server identity)')
    }
  }

  async call (method: string, args: unknown[]): Promise<unknown> {
    const url = `${this.opts.masterUrl.replace(/\/+$/, '')}/cluster/db`
    const payload = { nodeName: this.opts.nodeName, method, args }

    let status: number
    let text: string
    if (this.opts.identity) {
      const identity = typeof this.opts.identity === 'function' ? this.opts.identity() : this.opts.identity
      const r = await httpsJsonPost(url, payload, identity, { expectedCn: this.opts.masterCn! })
      status = r.status
      text = r.text
    } else {
      // Token mode runs over PLAIN HTTP and is unauthenticated at the transport
      // layer, so a network MITM (or an impersonated master endpoint) can return a
      // huge or never-terminating body. Bound it exactly like the mTLS path
      // (httpsJsonPost): an absolute deadline via AbortController + a streamed byte
      // budget, so the node can neither OOM nor hang on a hostile response.
      const doFetch = this.opts.fetchImpl ?? fetch
      const ctrl = new AbortController()
      const deadline = setTimeout(
        () => ctrl.abort(new Error('cluster token RPC deadline exceeded')),
        TOKEN_RPC_DEADLINE_MS
      )
      if (typeof deadline.unref === 'function') deadline.unref() // don't keep the process alive for an in-flight RPC
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.token ?? ''}` },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        })
        status = res.status
        text = await readBounded(res, TOKEN_RPC_MAX_RESPONSE_BYTES, ctrl.signal)
      } finally {
        clearTimeout(deadline)
      }
    }
    return this.parseResponse(method, status, text)
  }

  /** Shared response handling for both the mTLS and token paths. */
  private parseResponse (method: string, status: number, text: string): unknown {
    if (status < 200 || status >= 300) {
      throw new Error(`RPC ${method} failed (${status}): ${text}`)
    }
    let body: { ok?: boolean, result?: unknown, error?: unknown }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Error(`RPC ${method} returned a non-JSON response`)
    }
    if (body.ok !== true) {
      // The master forwards a TYPED PrismaAdapterError as a structured object so
      // infinization's code-based branches (MACHINE_NOT_FOUND / VERSION_CONFLICT)
      // work over RPC exactly as in-process. Reconstruct a real PrismaAdapterError
      // (same class identity → `instanceof` / isPrismaAdapterError pass) so the
      // remote path doesn't silently diverge from single-node (F8).
      const err = body.error
      if (err !== null && typeof err === 'object' && (err as { name?: unknown }).name === 'PrismaAdapterError') {
        const e = err as { code: PrismaAdapterErrorCode, message?: string, vmId?: string }
        throw new PrismaAdapterError(e.message ?? `RPC ${method} failed`, e.code, e.vmId)
      }
      const message = typeof err === 'string'
        ? err
        : (err !== null && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'unknown')
      throw new Error(`RPC ${method} error: ${message}`)
    }
    return body.result
  }
}

// Same bounds the mTLS path (httpsJsonPost) applies, so BOTH auth modes cap memory
// and time identically — a hostile/MITM master cannot OOM or hang the node agent.
const TOKEN_RPC_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const TOKEN_RPC_DEADLINE_MS = 15000

/** Marks the "response exceeded the byte budget" case so it fails closed (never swallowed). */
class RpcResponseTooLargeError extends Error {}

/**
 * Read a fetch `Response` body under a hard byte budget, streaming via the reader so
 * an oversized body is aborted BEFORE it is fully buffered (the token path is plain
 * HTTP and unauthenticated at the transport layer). Fails closed on oversize and on
 * a deadline abort (`signal.aborted`) by throwing; any other transient body-read
 * error degrades to '' exactly as the previous `res.text().catch(() => '')` did, so
 * parseResponse still reports it as a non-JSON/status error.
 */
async function readBounded (res: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const body = res.body
  if (body == null) {
    // No stream to meter (e.g. a lightweight test double); fall back to the prior
    // read, still surfacing a deadline abort so the caller fails closed.
    try { return await res.text() } catch (e) { if (signal?.aborted === true) throw e; return '' }
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let out = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) break
      if (value !== undefined) {
        total += value.byteLength
        if (total > maxBytes) {
          throw new RpcResponseTooLargeError(`cluster token RPC response exceeded ${maxBytes} bytes`)
        }
        out += decoder.decode(value, { stream: true })
      }
    }
    return out + decoder.decode()
  } catch (e) {
    await reader.cancel().catch(() => {}) // stop buffering / release the stream
    if (e instanceof RpcResponseTooLargeError || signal?.aborted === true) throw e
    return ''
  }
}
