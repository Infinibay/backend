import type { InfinizationDatabase } from '@infinibay/infinization'
import { PrismaAdapterError, PrismaAdapterErrorCode } from '@infinibay/infinization'

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
 * returns the `result`. Bearer-token authenticated (pre-mTLS; Phase 2 swaps in
 * the per-node client certificate as the verified identity).
 */
export class HttpDbRpcTransport implements DbRpcTransport {
  constructor (
    private readonly opts: {
      masterUrl: string
      nodeName: string
      token: string
      fetchImpl?: typeof fetch
    }
  ) {}

  async call (method: string, args: unknown[]): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? fetch
    const res = await doFetch(`${this.opts.masterUrl.replace(/\/+$/, '')}/cluster/db`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.token}`
      },
      body: JSON.stringify({ nodeName: this.opts.nodeName, method, args })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RPC ${method} failed (${res.status}): ${text}`)
    }
    const body = (await res.json()) as { ok?: boolean, result?: unknown, error?: unknown }
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
