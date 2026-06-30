import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

import { mockPrisma, testPrisma } from '../setup/jest.setup'
import clusterRouter from '../../app/routes/cluster'
import { NodeHeartbeatService } from '../../app/services/node/NodeHeartbeatService'
import { nodeHealth } from '../../app/services/node/NodeCapacity'

/**
 * Multi-node Phase 1 walking skeleton: a compute-node agent POSTs heartbeats to
 * the master, which upserts the Node and stamps lastHeartbeat so it reads
 * 'online'. The route (which imports the mocked @utils/database singleton) is
 * tested against `mockPrisma`; the real upsert semantics are tested against the
 * test DB via `testPrisma`.
 */
const TOKEN = 'test-cluster-token'
const NAME = 'rt-node-skeleton'

const app = express()
app.use('/cluster', clusterRouter)

// `hwOverrides` merge INTO hardware (cores/ram/etc.), since that is where the
// service reads capacity from.
function payload (hwOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: NAME,
    role: 'compute',
    address: '10.10.0.42',
    agentVersion: '0.0.0-test',
    hardware: {
      currentRaid: 'single',
      cpuFlags: { raw: 'model x', values: ['model', 'x'] },
      ram: 8192,
      cores: 4,
      ...hwOverrides
    }
  }
}

describe('POST /cluster/heartbeat (route + token gate)', () => {
  beforeAll(() => { process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN })
  beforeEach(() => { jest.clearAllMocks() })

  it('returns 503 when the cluster token is not configured (fail-closed)', async () => {
    const saved = process.env.INFINIBAY_CLUSTER_TOKEN
    delete process.env.INFINIBAY_CLUSTER_TOKEN
    try {
      const res = await request(app).post('/cluster/heartbeat').send(payload())
      expect(res.status).toBe(503)
    } finally {
      process.env.INFINIBAY_CLUSTER_TOKEN = saved
    }
  })

  it('returns 401 without a valid bearer token', async () => {
    const noToken = await request(app).post('/cluster/heartbeat').send(payload())
    expect(noToken.status).toBe(401)
    const badToken = await request(app).post('/cluster/heartbeat').set('authorization', 'Bearer wrong').send(payload())
    expect(badToken.status).toBe(401)
  })

  it('returns 400 when name or hardware is missing', async () => {
    const res = await request(app)
      .post('/cluster/heartbeat')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ role: 'compute' })
    expect(res.status).toBe(400)
  })

  it('registers a new node (created:true), stamping status=online + lastHeartbeat', async () => {
    mockPrisma.node.findFirst.mockResolvedValue(null as never)
    mockPrisma.node.create.mockResolvedValue({ id: 'node-xyz' } as never)

    const res = await request(app)
      .post('/cluster/heartbeat')
      .set('authorization', `Bearer ${TOKEN}`)
      .send(payload())

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, nodeId: 'node-xyz', created: true })
    expect(mockPrisma.node.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: NAME,
        role: 'compute',
        status: 'online',
        address: '10.10.0.42',
        agentVersion: '0.0.0-test',
        cores: 4,
        ram: 8192,
        currentRaid: 'single',
        maintenanceMode: false,
        lastHeartbeat: expect.any(Date)
      })
    })
  })

  it('updates an existing node (created:false) without creating a duplicate', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-existing' } as never)
    mockPrisma.node.update.mockResolvedValue({ id: 'node-existing' } as never)

    const res = await request(app)
      .post('/cluster/heartbeat')
      .set('authorization', `Bearer ${TOKEN}`)
      .send(payload({ cores: 8 }))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, nodeId: 'node-existing', created: false })
    expect(mockPrisma.node.create).not.toHaveBeenCalled()
    expect(mockPrisma.node.update).toHaveBeenCalledWith({
      where: { id: 'node-existing' },
      data: expect.objectContaining({ status: 'online', cores: 8, lastHeartbeat: expect.any(Date) })
    })
  })
})

describe('NodeHeartbeatService upsert semantics (real test DB)', () => {
  const service = new NodeHeartbeatService(testPrisma.prisma)

  const cleanup = async (): Promise<void> => { await testPrisma.prisma.node.deleteMany({ where: { name: NAME } }) }
  afterEach(cleanup)
  afterAll(cleanup)

  it('creates a compute node marked online with a fresh heartbeat', async () => {
    const result = await service.recordHeartbeat(payload() as never)
    expect(result.created).toBe(true)

    const node = await testPrisma.prisma.node.findFirst({ where: { name: NAME } })
    expect(node).toBeTruthy()
    expect(node?.role).toBe('compute')
    expect(node?.status).toBe('online')
    expect(node?.cores).toBe(4)
    expect(node?.ram).toBe(8192)
    expect(node?.lastHeartbeat).toBeTruthy()
    expect(nodeHealth(node!.lastHeartbeat as Date)).toBe('online')
  })

  it('is an upsert — a second heartbeat updates (created:false) with no duplicate row', async () => {
    const first = await service.recordHeartbeat(payload() as never)
    const second = await service.recordHeartbeat(payload({ cores: 8 }) as never)

    expect(second.created).toBe(false)
    expect(second.nodeId).toBe(first.nodeId)

    const nodes = await testPrisma.prisma.node.findMany({ where: { name: NAME } })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].cores).toBe(8)
  })
})
