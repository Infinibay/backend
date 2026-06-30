import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'node:stream'

import { mockPrisma } from '../../../setup/jest.setup'
import { LocalDiskStore } from '../../../../app/services/node/AgentDiskServer'
import { AgentStorageMigrationAdapter } from '../../../../app/services/node/AgentStorageMigrationAdapter'

const dirs: string[] = []
function tmp (): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-lds-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('LocalDiskStore (path-confined disk store)', () => {
  it('resolves a bare filename within the store and computes a stable sha256', async () => {
    const dir = tmp()
    const store = new LocalDiskStore(dir)
    const bytes = crypto.randomBytes(4096)
    fs.writeFileSync(path.join(dir, 'a.qcow2'), bytes)
    expect(store.exists('a.qcow2')).toBe(true)
    expect(store.size('a.qcow2')).toBe(4096)
    expect(await store.sha256('a.qcow2')).toBe(crypto.createHash('sha256').update(bytes).digest('hex'))
  })

  it('rejects paths that escape the store (traversal / elsewhere-absolute)', () => {
    const store = new LocalDiskStore(tmp())
    expect(() => store.resolveWithin('../escape')).toThrow(/outside the node disk store/)
    expect(() => store.resolveWithin('/etc/shadow')).toThrow(/outside the node disk store/)
    expect(() => store.resolveWithin('')).toThrow(/disk path is required/)
  })

  it('accepts an absolute path that lies inside the store (production disk paths are absolute)', () => {
    const dir = tmp()
    const store = new LocalDiskStore(dir)
    const abs = path.join(dir, 'sub', 'vm.qcow2')
    expect(store.resolveWithin(abs)).toBe(abs)
  })

  it('writeFrom is atomic + returns the sha256, and a partial path is cleaned on error', async () => {
    const dir = tmp()
    const store = new LocalDiskStore(dir)
    const bytes = crypto.randomBytes(8192)
    const written = await store.writeFrom('out.qcow2', Readable.from(bytes))
    expect(written.size).toBe(8192)
    expect(written.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'))
    expect(fs.readFileSync(path.join(dir, 'out.qcow2')).equals(bytes)).toBe(true)

    // A source that errors mid-stream must leave NO file and NO .part leftover.
    const boom = new Readable({ read () { this.destroy(new Error('read failed')) } })
    await expect(store.writeFrom('bad.qcow2', boom)).rejects.toThrow(/read failed/)
    expect(fs.existsSync(path.join(dir, 'bad.qcow2'))).toBe(false)
    expect(fs.readdirSync(dir).some((f) => f.includes('.part-'))).toBe(false)
  })

  it('unlink removes a present file and is a no-op (false) when already gone', async () => {
    const dir = tmp()
    const store = new LocalDiskStore(dir)
    fs.writeFileSync(path.join(dir, 'z.qcow2'), Buffer.from('z'))
    expect(await store.unlink('z.qcow2')).toBe(true)
    expect(await store.unlink('z.qcow2')).toBe(false)
  })
})

describe('AgentStorageMigrationAdapter — control flow', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function adapter (deps: Partial<ConstructorParameters<typeof AgentStorageMigrationAdapter>[1]> = {}) {
    return new AgentStorageMigrationAdapter(mockPrisma as never, {
      localDiskDir: tmp(),
      resolveLocalNodeId: async () => 'master-id',
      identity: () => ({ key: 'k', cert: 'c', ca: 'ca' }),
      ...deps
    })
  }

  it('does nothing when source and target are the same node', async () => {
    const streamPost = jest.fn()
    await adapter({ streamPost: streamPost as never }).prepareMachineStorage({
      machineId: 'vm', sourceNodeId: 'n1', targetNodeId: 'n1', diskPaths: ['d.qcow2']
    })
    expect(streamPost).not.toHaveBeenCalled()
    expect(mockPrisma.node.findUnique).not.toHaveBeenCalled()
  })

  it('does nothing when there are no disk paths to move', async () => {
    const streamGet = jest.fn()
    await adapter({ streamGet: streamGet as never }).prepareMachineStorage({
      machineId: 'vm', sourceNodeId: null, targetNodeId: 'target-id', diskPaths: []
    })
    expect(streamGet).not.toHaveBeenCalled()
  })

  it('master(local)→remote: reads the local disk, pushes it, verifies, and deletes the source when asked', async () => {
    const localDir = tmp()
    const bytes = crypto.randomBytes(2048)
    fs.writeFileSync(path.join(localDir, 'm.qcow2'), bytes)
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')

    mockPrisma.node.findUnique.mockResolvedValue({ id: 'target-id', name: 'target-node', address: '10.0.0.9', agentPort: 9443 } as never)
    // The push echoes back the sha the master computed from the local file → verified.
    // Drain the body like the real transport so the source ReadStream is consumed/closed.
    const streamPost = jest.fn(async (_url: string, body: Readable) => {
      await new Promise<void>((resolve) => { body.on('end', resolve).on('error', resolve).resume() })
      return { status: 200, text: JSON.stringify({ ok: true, size: bytes.length, sha256: sha }) }
    })

    await adapter({ localDiskDir: localDir, streamPost: streamPost as never, deleteSourceAfter: true })
      .prepareMachineStorage({ machineId: 'vm', sourceNodeId: 'master-id', targetNodeId: 'target-id', diskPaths: ['m.qcow2'] })

    expect(streamPost).toHaveBeenCalledTimes(1)
    const url = (streamPost.mock.calls[0] as unknown[])[0] as string
    expect(url).toContain('https://10.0.0.9:9443/agent/disk/push')
    expect(url).toContain(`sha256=${sha}`)
    // deleteSourceAfter → the local source file is reclaimed.
    expect(fs.existsSync(path.join(localDir, 'm.qcow2'))).toBe(false)
  })

  it('deleteSourceAfter=false keeps the source after a verified copy', async () => {
    const localDir = tmp()
    const bytes = crypto.randomBytes(1024)
    fs.writeFileSync(path.join(localDir, 'k.qcow2'), bytes)
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    mockPrisma.node.findUnique.mockResolvedValue({ id: 'target-id', name: 'target-node', address: '10.0.0.9', agentPort: 9443 } as never)
    const streamPost = jest.fn(async (_url: string, body: Readable) => {
      await new Promise<void>((resolve) => { body.on('end', resolve).on('error', resolve).resume() })
      return { status: 200, text: JSON.stringify({ ok: true, sha256: sha }) }
    })

    await adapter({ localDiskDir: localDir, streamPost: streamPost as never, deleteSourceAfter: false })
      .prepareMachineStorage({ machineId: 'vm', sourceNodeId: 'master-id', targetNodeId: 'target-id', diskPaths: ['k.qcow2'] })

    expect(fs.existsSync(path.join(localDir, 'k.qcow2'))).toBe(true)
  })

  it('throws when the target node has no reachable address (fails closed, no transfer)', async () => {
    // Both sides remote so the failure is purely the address check — no local file
    // to depend on. mockImplementation (not mockResolvedValue) so it is unambiguous
    // per-id and not leaked from a prior test.
    mockPrisma.node.findUnique.mockImplementation((async (args: any) => {
      if (args.where.id === 'source-id') return { id: 'source-id', name: 'source-node', address: '10.0.0.1', agentPort: 9443 }
      return { id: 'target-id', name: 'target-node', address: null, agentPort: 9443 }
    }) as never)
    const streamGet = jest.fn()
    await expect(adapter({ streamGet: streamGet as never }).prepareMachineStorage({
      machineId: 'vm', sourceNodeId: 'source-id', targetNodeId: 'target-id', diskPaths: ['p.qcow2']
    })).rejects.toThrow(/no reachable address/)
    // Failed closed before any byte was pulled.
    expect(streamGet).not.toHaveBeenCalled()
  })
})
