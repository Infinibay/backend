import 'reflect-metadata'
import { describe, it, expect, jest } from '@jest/globals'
import {
  RpcDatabaseAdapter,
  HttpDbRpcTransport,
  DB_FACADE_METHODS,
  type DbRpcTransport
} from '../../../app/services/node/RpcDatabaseAdapter'
import { isPrismaAdapterError, PrismaAdapterError } from '@infinibay/infinization'

describe('RpcDatabaseAdapter (compute-node DB facade client)', () => {
  it('forwards every one of the 16 facade methods as (name, args) and returns the result', async () => {
    const calls: Array<{ method: string, args: unknown[] }> = []
    const transport: DbRpcTransport = {
      call: async (method, args) => { calls.push({ method, args }); return { echoed: method } }
    }
    const adapter = new RpcDatabaseAdapter(transport) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>

    for (const method of DB_FACADE_METHODS) {
      const result = await adapter[method]('arg-1', 'arg-2')
      expect(result).toEqual({ echoed: method })
    }

    // Every facade method was forwarded exactly once, by name.
    expect(calls.map(c => c.method).sort()).toEqual([...DB_FACADE_METHODS].map(String).sort())
    // Arguments are passed through verbatim.
    expect(calls[0].args).toEqual(['arg-1', 'arg-2'])
  })

  it('returns the transport payload unchanged (findRunningVMs)', async () => {
    const call = jest.fn(async (_method: string, _args: unknown[]) => [{ id: 'm1', status: 'running' }])
    const adapter = new RpcDatabaseAdapter({ call } as DbRpcTransport)

    const vms = await adapter.findRunningVMs()

    expect(vms).toEqual([{ id: 'm1', status: 'running' }])
    expect(call).toHaveBeenCalledWith('findRunningVMs', [])
  })
})

describe('HttpDbRpcTransport', () => {
  function fakeFetch (impl: () => unknown): typeof fetch {
    return (jest.fn(async () => impl()) as unknown) as typeof fetch
  }

  it('POSTs {nodeName, method, args} with bearer auth and returns body.result', async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, json: async () => ({ ok: true, result: { id: 'm9' } }) }))
    const transport = new HttpDbRpcTransport({ masterUrl: 'http://master:4000/', nodeName: 'node-1', token: 'tok', fetchImpl })

    const result = await transport.call('findMachine', ['m9'])

    expect(result).toEqual({ id: 'm9' })
    const mock = fetchImpl as unknown as jest.Mock
    const [url, init] = mock.mock.calls[0] as [string, { headers: Record<string, string>, body: string }]
    expect(url).toBe('http://master:4000/cluster/db') // trailing slash normalized
    expect(init.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ nodeName: 'node-1', method: 'findMachine', args: ['m9'] })
  })

  it('throws on a non-2xx HTTP response', async () => {
    const fetchImpl = fakeFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }))
    const transport = new HttpDbRpcTransport({ masterUrl: 'http://m', nodeName: 'n', token: 't', fetchImpl })
    await expect(transport.call('findMachine', ['x'])).rejects.toThrow(/failed \(500\)/)
  })

  it('throws when the master reports ok:false', async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, json: async () => ({ ok: false, error: 'node not registered: n' }) }))
    const transport = new HttpDbRpcTransport({ masterUrl: 'http://m', nodeName: 'n', token: 't', fetchImpl })
    await expect(transport.call('findMachine', ['x'])).rejects.toThrow(/node not registered/)
  })

  it('reconstructs a forwarded PrismaAdapterError as a REAL PrismaAdapterError (F8 — code + instanceof preserved)', async () => {
    const fetchImpl = fakeFetch(() => ({
      ok: true,
      json: async () => ({
        ok: false,
        error: { name: 'PrismaAdapterError', code: 'MACHINE_NOT_FOUND', message: 'Machine not found: m1', vmId: 'm1' }
      })
    }))
    const transport = new HttpDbRpcTransport({ masterUrl: 'http://m', nodeName: 'n', token: 't', fetchImpl })

    // The rejection must be a real PrismaAdapterError so infinization's
    // isPrismaAdapterError / `instanceof` / `.code === MACHINE_NOT_FOUND`
    // branches fire over RPC exactly as in-process.
    await expect(transport.call('getFirewallRulesSplit', ['m1'])).rejects.toBeInstanceOf(PrismaAdapterError)
    try {
      await transport.call('getFirewallRulesSplit', ['m1'])
      throw new Error('should have thrown')
    } catch (e) {
      expect(isPrismaAdapterError(e)).toBe(true)
      expect((e as PrismaAdapterError).code).toBe('MACHINE_NOT_FOUND')
      expect((e as PrismaAdapterError).vmId).toBe('m1')
    }
  })
})
