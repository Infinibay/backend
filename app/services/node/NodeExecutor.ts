import { getInfinization } from '../InfinizationService'

/**
 * Multi-node Phase 1 (VM-op routing): the node-agnostic VM lifecycle surface.
 *
 * Every VM verb the backend invokes goes through a `NodeExecutor` rather than the
 * in-process infinization instance directly. Two implementations:
 *
 *   - `LocalNodeExecutor`  — forwards to THIS host's `getInfinization()`. This is
 *     byte-for-byte the single-node behaviour, so wiring the dispatcher in is a
 *     no-op for a one-node cluster (every existing test stays green).
 *   - `RemoteNodeExecutor` — forwards each verb over RPC to the node agent that
 *     actually owns the VM (its disk + qemu process live there). Mirror of the
 *     DB facade (`RpcDatabaseAdapter` / `HttpDbRpcTransport`).
 *
 * The interface is derived structurally from the live `Infinization` instance
 * type, so the executor surface can never drift from what infinization exposes:
 * change a verb signature in the library and this fails to compile until both
 * executors match.
 */

/** The resolved in-process infinization instance type (single source of truth). */
type Inf = Awaited<ReturnType<typeof getInfinization>>

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

/**
 * Executes VM verbs against THIS host's infinization instance. Resolves the
 * (cached) instance lazily per call, exactly as the call sites did before.
 */
export class LocalNodeExecutor implements NodeExecutor {
  async createVM (...a: Parameters<E['createVM']>): Promise<Awaited<ReturnType<E['createVM']>>> {
    return (await getInfinization()).createVM(...a)
  }

  async startVM (...a: Parameters<E['startVM']>): Promise<Awaited<ReturnType<E['startVM']>>> {
    return (await getInfinization()).startVM(...a)
  }

  async stopVM (...a: Parameters<E['stopVM']>): Promise<Awaited<ReturnType<E['stopVM']>>> {
    return (await getInfinization()).stopVM(...a)
  }

  async restartVM (...a: Parameters<E['restartVM']>): Promise<Awaited<ReturnType<E['restartVM']>>> {
    return (await getInfinization()).restartVM(...a)
  }

  async resetVM (...a: Parameters<E['resetVM']>): Promise<Awaited<ReturnType<E['resetVM']>>> {
    return (await getInfinization()).resetVM(...a)
  }

  async suspendVM (...a: Parameters<E['suspendVM']>): Promise<Awaited<ReturnType<E['suspendVM']>>> {
    return (await getInfinization()).suspendVM(...a)
  }

  async resumeVM (...a: Parameters<E['resumeVM']>): Promise<Awaited<ReturnType<E['resumeVM']>>> {
    return (await getInfinization()).resumeVM(...a)
  }

  async destroyVM (...a: Parameters<E['destroyVM']>): Promise<Awaited<ReturnType<E['destroyVM']>>> {
    return (await getInfinization()).destroyVM(...a)
  }

  async getVMStatus (...a: Parameters<E['getVMStatus']>): Promise<Awaited<ReturnType<E['getVMStatus']>>> {
    return (await getInfinization()).getVMStatus(...a)
  }

  async attachToRunningVM (...a: Parameters<E['attachToRunningVM']>): Promise<Awaited<ReturnType<E['attachToRunningVM']>>> {
    return (await getInfinization()).attachToRunningVM(...a)
  }

  async guestExec (...a: Parameters<E['guestExec']>): Promise<Awaited<ReturnType<E['guestExec']>>> {
    return (await getInfinization()).guestExec(...a)
  }
}

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
 * the `result`. Bearer-token authenticated against the same pre-mTLS cluster
 * token the agent presents to the master (Phase 2 swaps in per-node mTLS).
 */
export class HttpVmRpcTransport implements VmRpcTransport {
  constructor (
    private readonly opts: {
      agentUrl: string
      token: string
      fetchImpl?: typeof fetch
    }
  ) {}

  async call (verb: string, args: unknown[]): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? fetch
    const res = await doFetch(`${this.opts.agentUrl.replace(/\/+$/, '')}/agent/vm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.token}`
      },
      body: JSON.stringify({ verb, args })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`VM RPC ${verb} failed (${res.status}): ${text}`)
    }
    const body = (await res.json()) as { ok?: boolean, result?: unknown, error?: string }
    if (body.ok !== true) {
      throw new Error(`VM RPC ${verb} error: ${body.error ?? 'unknown'}`)
    }
    return body.result
  }
}
