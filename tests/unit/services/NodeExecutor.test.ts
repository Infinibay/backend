import 'reflect-metadata'
import { describe, it, expect, jest } from '@jest/globals'
import {
  RemoteNodeExecutor,
  HttpVmRpcTransport,
  VM_VERB_METHODS,
  type VmRpcTransport
} from '../../../app/services/node/NodeExecutor'

/**
 * Multi-node VM-op routing: the compute-node side. A RemoteNodeExecutor forwards
 * each VM verb to the owning node agent's verb server. Mirrors the DB-facade
 * RpcDatabaseAdapter tests.
 */
describe('RemoteNodeExecutor (forwards VM verbs to the owning node agent)', () => {
  it('forwards every verb in VM_VERB_METHODS as (verb, args) and returns the result', async () => {
    const calls: Array<{ verb: string, args: unknown[] }> = []
    const transport: VmRpcTransport = {
      call: async (verb, args) => { calls.push({ verb, args }); return { echoed: verb } }
    }
    const exec = new RemoteNodeExecutor(transport) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>

    for (const verb of VM_VERB_METHODS) {
      const result = await exec[verb]('m1', 'extra')
      expect(result).toEqual({ echoed: verb })
    }

    expect(calls.map(c => c.verb).sort()).toEqual([...VM_VERB_METHODS].map(String).sort())
    expect(calls[0].args).toEqual(['m1', 'extra'])
  })

  it('returns the transport payload unchanged (getVMStatus)', async () => {
    const call = jest.fn(async (_verb: string, _args: unknown[]) => ({ status: 'running', processAlive: true }))
    const exec = new RemoteNodeExecutor({ call } as VmRpcTransport)

    const status = await exec.getVMStatus('m1')

    expect(status).toEqual({ status: 'running', processAlive: true })
    expect(call).toHaveBeenCalledWith('getVMStatus', ['m1'])
  })
})

describe('HttpVmRpcTransport', () => {
  function fakeFetch (impl: () => unknown): typeof fetch {
    return (jest.fn(async () => impl()) as unknown) as typeof fetch
  }

  it('POSTs {verb, args} to /agent/vm with bearer auth and returns body.result', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, text: async () => JSON.stringify({ ok: true, result: { success: true } }) }))
    const transport = new HttpVmRpcTransport({ agentUrl: 'http://node-1:9443/', token: 'tok', fetchImpl })

    const result = await transport.call('startVM', ['m1'])

    expect(result).toEqual({ success: true })
    const mock = fetchImpl as unknown as jest.Mock
    const [url, init] = mock.mock.calls[0] as [string, { headers: Record<string, string>, body: string }]
    expect(url).toBe('http://node-1:9443/agent/vm') // trailing slash normalized
    expect(init.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ verb: 'startVM', args: ['m1'] })
  })

  it('throws on a non-2xx HTTP response', async () => {
    const fetchImpl = fakeFetch(() => ({ ok: false, status: 502, text: async () => 'bad gateway' }))
    const transport = new HttpVmRpcTransport({ agentUrl: 'http://n', token: 't', fetchImpl })
    await expect(transport.call('startVM', ['m1'])).rejects.toThrow(/failed \(502\)/)
  })

  it('throws when the agent reports ok:false', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, text: async () => JSON.stringify({ ok: false, error: 'vm not found' }) }))
    const transport = new HttpVmRpcTransport({ agentUrl: 'http://n', token: 't', fetchImpl })
    await expect(transport.call('startVM', ['m1'])).rejects.toThrow(/vm not found/)
  })
})
