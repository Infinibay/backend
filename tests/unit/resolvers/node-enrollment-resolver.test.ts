import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mockPrisma } from '../../setup/jest.setup'
import { NodeResolver } from '../../../app/graphql/resolvers/node/resolver'
import { ClusterCA } from '../../../app/services/node/ClusterCA'
import { NodeEnrollmentService } from '../../../app/services/node/NodeEnrollmentService'
import type { InfinibayContext } from '../../../app/utils/context'

/**
 * Phase 2: the admin GraphQL surface (pendingNodes / approveNode / rejectNode).
 * Resolver methods are called directly with a mock context — type-graphql
 * decorators are metadata and don't run on a direct call. Delegates to the
 * already-unit-tested NodeEnrollmentService; here we prove the wiring + mapping.
 */
const ctx = { prisma: mockPrisma } as unknown as InfinibayContext
const resolver = new NodeResolver()

describe('NodeResolver — enrollment admin ops', () => {
  let caDir: string

  beforeAll(() => {
    caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-resolver-ca-'))
    process.env.INFINIBAY_CLUSTER_CA_DIR = caDir
  })
  afterAll(() => { fs.rmSync(caDir, { recursive: true, force: true }) })
  beforeEach(() => { jest.clearAllMocks() })

  it('pendingNodes maps rows and attaches the recomputed 6-digit pairing code', async () => {
    mockPrisma.node.findMany.mockResolvedValue([
      { id: 'n1', name: 'worker-1', role: 'compute', address: '10.0.0.5', fingerprint: 'pubfp', joinNonce: 'nonce', createdAt: new Date() }
    ] as never)

    const pending = await resolver.pendingNodes(ctx)

    expect(pending).toHaveLength(1)
    expect(pending[0].name).toBe('worker-1')
    expect(pending[0].pairingCode).toMatch(/^\d{6}$/)
    // The code matches what the node would compute from the same inputs.
    const caFp = new ClusterCA(caDir).caFingerprint()
    expect(pending[0].pairingCode).toBe(NodeEnrollmentService.computeSas('pubfp', 'nonce', caFp))
    // Only pending nodes are listed.
    expect(mockPrisma.node.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending' } })
    )
  })

  it('approveNode flips a pending node to approved and returns true', async () => {
    mockPrisma.node.findUnique.mockResolvedValue({ id: 'n1', name: 'worker-1', status: 'pending', joinCodeHash: null } as never)
    mockPrisma.node.update.mockResolvedValue({ id: 'n1' } as never)

    const ok = await resolver.approveNode('n1', undefined, ctx)

    expect(ok).toBe(true)
    expect(mockPrisma.node.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1' }, data: { status: 'approved' } })
    )
  })

  it('approveNode rejects a wrong typed pairing code (does not approve)', async () => {
    // joinCodeHash is the sha256 of the real code; a wrong typed code must fail.
    const realHash = (await import('crypto')).createHash('sha256').update('123456').digest('hex')
    mockPrisma.node.findUnique.mockResolvedValue({ id: 'n1', name: 'worker-1', status: 'pending', joinCodeHash: realHash } as never)

    await expect(resolver.approveNode('n1', '000000', ctx)).rejects.toThrow(/mismatch/i)
    expect(mockPrisma.node.update).not.toHaveBeenCalled()
  })

  it('rejectNode marks the node rejected and returns true', async () => {
    mockPrisma.node.update.mockResolvedValue({ id: 'n1' } as never)

    const ok = await resolver.rejectNode('n1', ctx)

    expect(ok).toBe(true)
    expect(mockPrisma.node.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1' }, data: expect.objectContaining({ status: 'rejected' }) })
    )
  })
})
