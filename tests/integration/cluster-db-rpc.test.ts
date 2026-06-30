import 'reflect-metadata'
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

import { mockPrisma } from '../setup/jest.setup'
import clusterRouter from '../../app/routes/cluster'

/**
 * Multi-node Phase 1 increment 3: the master side of the node DB facade
 * (POST /cluster/db). A node's RpcDatabaseAdapter forwards facade methods here;
 * the master executes them on a PrismaAdapter SCOPED TO THE CALLING NODE.
 * Uses mockPrisma (the route imports the mocked @utils/database singleton).
 */
const TOKEN = 'test-cluster-token'
const app = express()
app.use('/cluster', clusterRouter)

function post (body: unknown, token: string | null = TOKEN): request.Test {
  const r = request(app).post('/cluster/db')
  if (token) r.set('authorization', `Bearer ${token}`)
  return r.send(body as object)
}

describe('POST /cluster/db (node DB facade)', () => {
  beforeAll(() => { process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN })
  beforeEach(() => { jest.clearAllMocks() })

  it('returns 401 without a valid token', async () => {
    const res = await post({ nodeName: 'node-1', method: 'findRunningVMs', args: [] }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('returns 400 for a method that is not on the allowlist', async () => {
    const res = await post({ nodeName: 'node-1', method: 'dropEverything', args: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when nodeName is missing', async () => {
    const res = await post({ method: 'findRunningVMs', args: [] })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the node is not registered', async () => {
    mockPrisma.node.findFirst.mockResolvedValue(null as never)
    const res = await post({ nodeName: 'ghost', method: 'findRunningVMs', args: [] })
    expect(res.status).toBe(404)
  })

  it('executes the method NODE-SCOPED and returns the mapped result', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
    // findRunningVMs internally calls machine.findMany — return one running VM.
    mockPrisma.machine.findMany.mockResolvedValue([
      { id: 'm1', status: 'running', internalName: 'vm-1', configuration: null }
    ] as never)

    const res = await post({ nodeName: 'node-1', method: 'findRunningVMs', args: [] })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.result).toEqual([
      { id: 'm1', status: 'running', internalName: 'vm-1', MachineConfiguration: null }
    ])

    // The crux: the PrismaAdapter was scoped to the calling node, so the query
    // carries nodeId — a node can only ever read its own VMs over RPC (G0/ADR-CP5).
    expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'running', nodeId: 'node-1-id' })
      })
    )
  })

  it('forwards positional args (updateMachineStatus id,status) to the scoped adapter', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)

    const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', 'off'] })

    expect(res.status).toBe(200)
    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'off' } })
  })
})
