import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import https from 'node:https'
import express from 'express'
import type { AddressInfo } from 'node:net'

import { mockPrisma } from '../setup/jest.setup'
import { ClusterCA } from '../../app/services/node/ClusterCA'
import { generateNodeKeyAndCsr } from '../../app/services/node/clusterCrypto'
import { clusterServerOptions, httpsJsonPost, type ClusterIdentity } from '../../app/services/node/clusterMtls'
import { createAgentDiskRouter, LocalDiskStore } from '../../app/services/node/AgentDiskServer'
import { AgentStorageMigrationAdapter } from '../../app/services/node/AgentStorageMigrationAdapter'

/**
 * Phase 3 (cold migration): the REAL disk transfer over mTLS, in-process. Two
 * agent disk servers (source + target) are started with their own CA-signed leaf
 * and confined disk stores; the master's AgentStorageMigrationAdapter pulls the
 * qcow2 from one and pushes it to the other, proves the sha256 end-to-end, and
 * deletes the source only after the target is verified (invariant I2).
 */

let caDir: string
let masterIdentity: ClusterIdentity
const dirs: string[] = []

function tmp (prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(d)
  return d
}

function makeNodeIdentity (ca: ClusterCA, cn: string, caPem: string): ClusterIdentity {
  const { privateKeyPem, csrPem } = generateNodeKeyAndCsr(cn)
  return { key: privateKeyPem, cert: ca.signNodeCsr(csrPem, cn).certPem, ca: caPem }
}

interface AgentServer { port: number, diskDir: string, close: () => Promise<void> }

/** A real mTLS agent that serves ONLY the disk router (master-CN gated). */
async function startAgent (identity: ClusterIdentity, masterCn: string): Promise<AgentServer> {
  const diskDir = tmp('infinibay-agentdisk-')
  const app = express()
  app.use('/agent', createAgentDiskRouter({ store: new LocalDiskStore(diskDir), auth: 'mtls', masterCn }))
  const server = https.createServer(clusterServerOptions(identity, { rejectUnauthorized: true }), app)
  // A cert-less / mid-handshake client trips a TLS error; swallow it so a stray
  // post-test socket event never surfaces as an unhandled exception under jest.
  server.on('clientError', () => {})
  server.on('tlsClientError', () => {})
  server.keepAliveTimeout = 1
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    diskDir,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function sha256File (p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

beforeAll(() => {
  caDir = tmp('infinibay-diskmig-ca-')
  process.env.INFINIBAY_CLUSTER_CA_DIR = caDir
  const ca = new ClusterCA(caDir)
  ca.loadOrCreate()
  masterIdentity = ca.getMasterIdentity('master-1')
})

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

beforeEach(() => { jest.clearAllMocks() })

function adapterFor (deps: Partial<ConstructorParameters<typeof AgentStorageMigrationAdapter>[1]> = {}): AgentStorageMigrationAdapter {
  return new AgentStorageMigrationAdapter(mockPrisma as never, {
    localDiskDir: tmp('infinibay-master-disks-'),
    resolveLocalNodeId: async () => 'master-id',
    identity: () => masterIdentity,
    ...deps
  })
}

/** Point the adapter's node lookups at the two live test servers. */
function wireNodes (src: { port: number } | null, tgt: { port: number } | null): void {
  mockPrisma.node.findUnique.mockImplementation((async (args: any) => {
    const id = args.where.id
    if (id === 'source-id' && src) return { id, name: 'source-node', address: '127.0.0.1', agentPort: src.port }
    if (id === 'target-id' && tgt) return { id, name: 'target-node', address: '127.0.0.1', agentPort: tgt.port }
    return null
  }) as never)
}

describe('Phase 3 cold disk migration — real mTLS transfer', () => {
  it('moves a disk remote→remote, verifies the sha256, and deletes the source (I2)', async () => {
    const ca = new ClusterCA(caDir)
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    const target = await startAgent(makeNodeIdentity(ca, 'target-node', ca.getCaCertPem()), 'master-1')
    try {
      // A non-trivial disk (1 MiB random) lives on the source node only.
      const fileName = 'vm-under-test.qcow2'
      const srcPath = path.join(source.diskDir, fileName)
      const payload = crypto.randomBytes(1024 * 1024)
      fs.writeFileSync(srcPath, payload)
      const srcSha = sha256File(srcPath)

      wireNodes(source, target)
      await adapterFor().prepareMachineStorage({
        machineId: 'vm-1', sourceNodeId: 'source-id', targetNodeId: 'target-id', diskPaths: [fileName]
      })

      // Landed on the target, byte-identical…
      const tgtPath = path.join(target.diskDir, fileName)
      expect(fs.existsSync(tgtPath)).toBe(true)
      expect(sha256File(tgtPath)).toBe(srcSha)
      expect(fs.readFileSync(tgtPath).equals(payload)).toBe(true)
      // …and the source was reclaimed only AFTER verification.
      expect(fs.existsSync(srcPath)).toBe(false)
    } finally {
      await source.close(); await target.close()
    }
  })

  it('moves a disk remote→master(local) onto the master filesystem', async () => {
    const ca = new ClusterCA(caDir)
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    try {
      const fileName = 'vm-local.qcow2'
      const payload = crypto.randomBytes(512 * 1024)
      fs.writeFileSync(path.join(source.diskDir, fileName), payload)

      const masterDisks = tmp('infinibay-master-target-')
      wireNodes(source, null)
      // target is the master's own node → written to the local disk dir, no HTTP.
      await adapterFor({ localDiskDir: masterDisks }).prepareMachineStorage({
        machineId: 'vm-2', sourceNodeId: 'source-id', targetNodeId: 'master-id', diskPaths: [fileName]
      })

      const landed = path.join(masterDisks, fileName)
      expect(fs.existsSync(landed)).toBe(true)
      expect(fs.readFileSync(landed).equals(payload)).toBe(true)
      expect(fs.existsSync(path.join(source.diskDir, fileName))).toBe(false) // source reclaimed
    } finally {
      await source.close()
    }
  })

  it('keeps the source intact when the target write is corrupted (I2 — no data loss)', async () => {
    const ca = new ClusterCA(caDir)
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    const target = await startAgent(makeNodeIdentity(ca, 'target-node', ca.getCaCertPem()), 'master-1')
    try {
      const fileName = 'vm-flip.qcow2'
      const srcPath = path.join(source.diskDir, fileName)
      fs.writeFileSync(srcPath, crypto.randomBytes(256 * 1024))

      wireNodes(source, target)
      // Inject a streamPost that lies about the written sha256 → mismatch must throw.
      // Drain the real source stream first (as the real transport would).
      const lyingPush = (async (_url: string, body: NodeJS.ReadableStream) => {
        await new Promise<void>((resolve) => { body.on('end', resolve).on('error', resolve); (body as any).resume() })
        return { status: 200, text: JSON.stringify({ ok: true, size: 1, sha256: 'deadbeef' }) }
      }) as never
      await expect(adapterFor({ streamPost: lyingPush }).prepareMachineStorage({
        machineId: 'vm-3', sourceNodeId: 'source-id', targetNodeId: 'target-id', diskPaths: [fileName]
      })).rejects.toThrow(/sha256 mismatch/)

      // Source MUST still be there — a failed migration never deletes the original.
      expect(fs.existsSync(srcPath)).toBe(true)
    } finally {
      await source.close(); await target.close()
    }
  })

  it('refuses a disk pull with no client certificate at the TLS layer (cert required)', async () => {
    const ca = new ClusterCA(caDir)
    // The agent disk server runs with rejectUnauthorized:true, so a cert-less
    // caller never reaches HTTP — the TLS handshake itself is aborted. Either way
    // the disk bytes are unreachable without the master's client certificate.
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    try {
      fs.writeFileSync(path.join(source.diskDir, 'secret.qcow2'), Buffer.from('x'))
      const attempt = new Promise<number>((resolve, reject) => {
        const req = https.request({
          method: 'GET', hostname: '127.0.0.1', port: source.port,
          path: '/agent/disk/pull?path=secret.qcow2', ca: ca.getCaCertPem(),
          checkServerIdentity: () => undefined
        }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
        req.on('error', reject); req.end()
      })
      // Rejected at TLS (certificate required) — never a 2xx that leaks the disk.
      await expect(attempt).rejects.toThrow(/certificate required|alert|socket/i)
    } finally {
      await source.close()
    }
  })

  it('stat hashes only on demand — sha256:false skips the whole-file read, default includes it', async () => {
    const ca = new ClusterCA(caDir)
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    try {
      const fileName = 'vm-stat.qcow2'
      const payload = crypto.randomBytes(64 * 1024)
      fs.writeFileSync(path.join(source.diskDir, fileName), payload)
      const expectedSha = crypto.createHash('sha256').update(payload).digest('hex')
      const url = `https://127.0.0.1:${source.port}/agent/disk/stat`

      // Opt out of hashing (the sparse transfer path): size + allocated come back, sha256 does NOT.
      const lean = await httpsJsonPost(url, { path: fileName, sha256: false }, masterIdentity, { expectedCn: 'source-node' })
      const leanBody = JSON.parse(lean.text)
      expect(leanBody).toMatchObject({ ok: true, exists: true, size: payload.length })
      expect(typeof leanBody.allocated).toBe('number')
      expect(leanBody.sha256).toBeUndefined()

      // Default (raw transfer + backup staging) still returns the hash.
      const full = await httpsJsonPost(url, { path: fileName }, masterIdentity, { expectedCn: 'source-node' })
      expect(JSON.parse(full.text)).toMatchObject({ ok: true, exists: true, size: payload.length, sha256: expectedSha })
    } finally {
      await source.close()
    }
  })

  it('confines disk paths to the store — a traversal path is rejected 400', async () => {
    const ca = new ClusterCA(caDir)
    const source = await startAgent(makeNodeIdentity(ca, 'source-node', ca.getCaCertPem()), 'master-1')
    try {
      const r = await httpsJsonPost(
        `https://127.0.0.1:${source.port}/agent/disk/stat`,
        { path: '../../etc/shadow' }, masterIdentity, { expectedCn: 'source-node' }
      )
      expect(r.status).toBe(400)
      expect(r.text).toMatch(/outside the node disk store/)
    } finally {
      await source.close()
    }
  })
})
