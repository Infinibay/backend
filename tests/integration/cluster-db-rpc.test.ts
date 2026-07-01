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
    // The node-ownership gate verifies the target machine belongs to the caller.
    mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)

    const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', 'off'] })

    expect(res.status).toBe(200)
    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'off' } })
    // Ownership was checked node-scoped before the write ran.
    expect(mockPrisma.machine.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', nodeId: 'node-1-id' } })
    )
  })

  describe('status-write validation gate (compromised-node hardening)', () => {
    it('rejects a bogus status literal (400) — never persists an unknown status', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)

      const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', 'running_fake'] })

      expect(res.status).toBe(400)
      // A row stuck in an unknown status is invisible to every reconciler — the
      // write must be blocked before it reaches the DB.
      expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    })

    it('rejects an oversized status blob (400)', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)

      const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', 'z'.repeat(200000)] })

      expect(res.status).toBe(400)
      expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    })

    it('rejects a non-string status (400)', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)

      const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', { evil: true }] })

      expect(res.status).toBe(400)
      expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    })

    it('still accepts a valid non-trivial status like "moving" (200) — not over-restricted to the 8 DBVMStatus', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)
      mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)

      const res = await post({ nodeName: 'node-1', method: 'updateMachineStatus', args: ['m1', 'moving'] })

      expect(res.status).toBe(200)
      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'moving' } })
    })
  })

  describe('node-ownership gate (G0 — F3/F4/F5)', () => {
    it('rejects an id-keyed method with an EMPTY id (400) — blocks the cluster-wide mass wipe', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)

      const res = await post({ nodeName: 'node-1', method: 'clearMachineConfiguration', args: [] })

      expect(res.status).toBe(400)
      // The dangerous updateMany must never run for an absent id.
      expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    })

    it("rejects a method targeting a machine the caller does NOT own (403) — blocks cross-node write/read", async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      // Ownership lookup scoped to node-1 finds nothing (the VM lives on node-2).
      mockPrisma.machine.findFirst.mockResolvedValue(null as never)

      const res = await post({ nodeName: 'node-1', method: 'transitionVMStatus', args: ['vm-on-node-2', 'running', 'off', 3] })

      expect(res.status).toBe(403)
      expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    })

    it('allows a non-id-keyed enumeration read (findRunningVMs) without an ownership lookup', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      mockPrisma.machine.findMany.mockResolvedValue([] as never)

      const res = await post({ nodeName: 'node-1', method: 'findRunningVMs', args: [] })

      expect(res.status).toBe(200)
      expect(mockPrisma.machine.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('typed-error forwarding (F8)', () => {
    it('serializes a thrown PrismaAdapterError (code + message + vmId) as a structured ok:false body', async () => {
      mockPrisma.node.findFirst.mockResolvedValue({ id: 'node-1-id' } as never)
      // Ownership passes…
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'm1' } as never)
      // …but getFirewallRulesSplit's own lookup finds no machine → it throws
      // PrismaAdapterError(MACHINE_NOT_FOUND).
      mockPrisma.machine.findUnique.mockResolvedValue(null as never)

      const res = await post({ nodeName: 'node-1', method: 'getFirewallRulesSplit', args: ['m1'] })

      // The RPC completed (200) but reports a typed domain error, NOT a generic 500.
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(false)
      expect(res.body.error).toEqual(
        expect.objectContaining({ name: 'PrismaAdapterError', code: 'MACHINE_NOT_FOUND', vmId: 'm1' })
      )
      expect(res.body.error.message).toMatch(/not found/i)
    })
  })
})
