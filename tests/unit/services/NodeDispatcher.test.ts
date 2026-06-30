import 'reflect-metadata'
import { describe, it, expect, jest } from '@jest/globals'
import { PrismaClient } from '@prisma/client'
import { NodeDispatcher, type RemoteNodeInfo } from '../../../app/services/node/NodeDispatcher'
import { type NodeExecutor } from '../../../app/services/node/NodeExecutor'

/**
 * Multi-node VM-op routing: the master side. Given a Machine.id the dispatcher
 * decides which host executes the verb — LOCAL (in-process infinization) when the
 * VM is unowned/ours, REMOTE (the owning node agent) otherwise. The safety
 * invariant (G0): a VM owned by ANOTHER node is NEVER executed locally.
 */
const LOCAL: NodeExecutor = { local: true } as unknown as NodeExecutor
const REMOTE: NodeExecutor = { remote: true } as unknown as NodeExecutor

function makeDispatcher (opts: {
  machine: { nodeId: string | null } | null
  node?: { id: string, name: string, address: string | null, agentPort: number, status: string } | null
  localNodeId?: string
}) {
  const prisma = {
    machine: { findUnique: jest.fn(async () => opts.machine) },
    node: { findUnique: jest.fn(async () => opts.node ?? null) }
  } as unknown as PrismaClient

  const createRemote = jest.fn((_node: RemoteNodeInfo) => REMOTE)
  const dispatcher = new NodeDispatcher(prisma, {
    resolveLocalNodeId: async () => opts.localNodeId,
    createLocalExecutor: () => LOCAL,
    createRemoteExecutor: createRemote
  })
  return { dispatcher, prisma, createRemote }
}

describe('NodeDispatcher.executorFor', () => {
  it('routes to LOCAL when the VM has no owning node (legacy/unscoped)', async () => {
    const { dispatcher } = makeDispatcher({ machine: { nodeId: null }, localNodeId: 'node-A' })
    expect(await dispatcher.executorFor('m1')).toBe(LOCAL)
  })

  it('routes to LOCAL when the VM is owned by THIS node', async () => {
    const { dispatcher } = makeDispatcher({ machine: { nodeId: 'node-A' }, localNodeId: 'node-A' })
    expect(await dispatcher.executorFor('m1')).toBe(LOCAL)
  })

  it('routes to LOCAL when this host is not yet registered (single-host mode)', async () => {
    const { dispatcher } = makeDispatcher({ machine: { nodeId: 'node-A' }, localNodeId: undefined })
    expect(await dispatcher.executorFor('m1')).toBe(LOCAL)
  })

  it('routes to REMOTE (with the owning node address) when the VM lives on another node', async () => {
    const { dispatcher, createRemote } = makeDispatcher({
      machine: { nodeId: 'node-B' },
      localNodeId: 'node-A',
      node: { id: 'node-B', name: 'worker-2', address: '10.0.0.12', agentPort: 9443, status: 'online' }
    })
    const exec = await dispatcher.executorFor('m1')
    expect(exec).toBe(REMOTE)
    expect(createRemote).toHaveBeenCalledWith({ id: 'node-B', name: 'worker-2', address: '10.0.0.12', agentPort: 9443 })
  })

  it('THROWS (never falls back to local) when the owning node has no reachable address', async () => {
    const { dispatcher, createRemote } = makeDispatcher({
      machine: { nodeId: 'node-B' },
      localNodeId: 'node-A',
      node: { id: 'node-B', name: 'worker-2', address: null, agentPort: 9443, status: 'pending' }
    })
    await expect(dispatcher.executorFor('m1')).rejects.toThrow(/no reachable address/)
    expect(createRemote).not.toHaveBeenCalled()
  })

  it('THROWS when the owning node row is missing entirely', async () => {
    const { dispatcher } = makeDispatcher({
      machine: { nodeId: 'node-ghost' },
      localNodeId: 'node-A',
      node: null
    })
    await expect(dispatcher.executorFor('m1')).rejects.toThrow(/no reachable address/)
  })

  it('routes to LOCAL when the machine row does not exist', async () => {
    const { dispatcher } = makeDispatcher({ machine: null, localNodeId: 'node-A' })
    expect(await dispatcher.executorFor('m1')).toBe(LOCAL)
  })
})
