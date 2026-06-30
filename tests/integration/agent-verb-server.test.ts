import 'reflect-metadata'
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

import { createAgentVerbRouter } from '../../app/services/node/AgentVerbServer'
import { type NodeExecutor } from '../../app/services/node/NodeExecutor'

/**
 * Multi-node Phase 1 (VM-op routing): the node-agent verb server (POST /agent/vm).
 * The master's RemoteNodeExecutor forwards verbs here; the agent runs them on its
 * local infinization. Tested with a MOCK target (no DB / no KVM) — proves the
 * wire contract: token gate, verb allowlist, arg forwarding, error mapping.
 */
const TOKEN = 'test-cluster-token'

function makeApp (target: Partial<NodeExecutor>) {
  const app = express()
  app.use('/agent', createAgentVerbRouter({ getTarget: async () => target as NodeExecutor }))
  return app
}

function post (app: express.Express, body: unknown, token: string | null = TOKEN): request.Test {
  const r = request(app).post('/agent/vm')
  if (token) r.set('authorization', `Bearer ${token}`)
  return r.send(body as object)
}

describe('POST /agent/vm (node-agent verb server)', () => {
  beforeAll(() => { process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN })
  beforeEach(() => { jest.clearAllMocks() })

  it('returns 401 without a valid token', async () => {
    const app = makeApp({ startVM: jest.fn() as never })
    const res = await post(app, { verb: 'startVM', args: ['m1'] }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('returns 400 for a verb not on the allowlist', async () => {
    const app = makeApp({})
    const res = await post(app, { verb: 'rm_rf', args: [] })
    expect(res.status).toBe(400)
  })

  it('executes the verb against the local target and returns the result', async () => {
    const startVM = jest.fn(async (..._a: unknown[]) => ({ success: true, message: 'started' }))
    const app = makeApp({ startVM: startVM as never })

    const res = await post(app, { verb: 'startVM', args: ['m1'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, result: { success: true, message: 'started' } })
    expect(startVM).toHaveBeenCalledWith('m1')
  })

  it('forwards positional args verbatim (stopVM id, opts)', async () => {
    const stopVM = jest.fn(async (..._a: unknown[]) => ({ success: true }))
    const app = makeApp({ stopVM: stopVM as never })

    const res = await post(app, { verb: 'stopVM', args: ['m1', { graceful: true, force: true, timeout: 120000 }] })

    expect(res.status).toBe(200)
    expect(stopVM).toHaveBeenCalledWith('m1', { graceful: true, force: true, timeout: 120000 })
  })

  it('maps a thrown verb error to 500 with the message', async () => {
    const startVM = jest.fn(async () => { throw new Error('vm not found') })
    const app = makeApp({ startVM: startVM as never })

    const res = await post(app, { verb: 'startVM', args: ['ghost'] })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'vm not found' })
  })

  it('fails closed (503) when the cluster token is not configured', async () => {
    const saved = process.env.INFINIBAY_CLUSTER_TOKEN
    delete process.env.INFINIBAY_CLUSTER_TOKEN
    try {
      const app = makeApp({ startVM: jest.fn() as never })
      const res = await post(app, { verb: 'startVM', args: ['m1'] }, TOKEN)
      expect(res.status).toBe(503)
    } finally {
      process.env.INFINIBAY_CLUSTER_TOKEN = saved
    }
  })
})
