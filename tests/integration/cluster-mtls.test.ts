import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import https from 'node:https'
import express from 'express'
import type { AddressInfo } from 'node:net'

import { mockPrisma } from '../setup/jest.setup'
import { ClusterCA } from '../../app/services/node/ClusterCA'
import { generateNodeKeyAndCsr } from '../../app/services/node/clusterCrypto'
import {
  clusterServerOptions,
  requireClientCert,
  httpsJsonPost,
  type ClusterAuthedRequest,
  type ClusterIdentity
} from '../../app/services/node/clusterMtls'
import { createClusterRouter } from '../../app/routes/cluster'

/**
 * Phase 2.1d: the REAL mTLS handshake, exercised in-process against a live
 * https.Server started with requestCert. This proves the security mechanism for
 * real (not a mock): a node's identity is the CN of its VERIFIED client cert, a
 * cert signed by a foreign CA is rejected, and a cert-less caller is rejected.
 *
 * It also proves the trust-boundary payoff: on /cluster/db the calling node is the
 * verified CN, NOT the self-asserted body.nodeName — closing the spoofing gap.
 */

let caDir: string
let evilCaDir: string
let masterIdentity: ClusterIdentity
let nodeIdentity: ClusterIdentity // CN = worker-1, signed by the real cluster CA
let evilIdentity: ClusterIdentity // CN = worker-1, signed by a DIFFERENT CA
let clusterCaPem: string

function makeNodeIdentity (ca: ClusterCA, cn: string, trustedCaPem: string): ClusterIdentity {
  const { privateKeyPem, csrPem } = generateNodeKeyAndCsr(cn)
  const issued = ca.signNodeCsr(csrPem, cn)
  return { key: privateKeyPem, cert: issued.certPem, ca: trustedCaPem }
}

beforeAll(() => {
  caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-mtls-ca-'))
  evilCaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-mtls-evil-'))
  process.env.INFINIBAY_CLUSTER_CA_DIR = caDir

  const ca = new ClusterCA(caDir)
  ca.loadOrCreate()
  clusterCaPem = ca.getCaCertPem()
  masterIdentity = ca.getMasterIdentity('master-1')
  nodeIdentity = makeNodeIdentity(ca, 'worker-1', clusterCaPem)

  const evilCa = new ClusterCA(evilCaDir)
  evilCa.loadOrCreate()
  // Presents an evil cert but still TRUSTS the real server (so the handshake
  // reaches the server, which then rejects the unrecognised client cert).
  evilIdentity = makeNodeIdentity(evilCa, 'worker-1', clusterCaPem)
})

afterAll(() => {
  fs.rmSync(caDir, { recursive: true, force: true })
  fs.rmSync(evilCaDir, { recursive: true, force: true })
})

/** Start a real mTLS https server (master cert, requestCert) serving `mount`. */
async function startServer (mount: express.Router | express.RequestHandler): Promise<{ url: string, close: () => Promise<void> }> {
  const app = express()
  app.use(mount)
  const server = https.createServer(clusterServerOptions(masterIdentity, { rejectUnauthorized: false }), app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `https://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** A raw mTLS-less POST (trusts the server CA, presents NO client cert). */
function rawPostNoCert (url: string, body: unknown, caPem: string): Promise<{ status: number, text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const payload = Buffer.from(JSON.stringify(body))
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      ca: caPem,
      checkServerIdentity: () => undefined,
      headers: { 'content-type': 'application/json', 'content-length': payload.length }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

describe('cluster mTLS — verified-cert identity (real handshake)', () => {
  it('extracts the node identity from a VALID client certificate CN', async () => {
    const router = express.Router()
    router.post('/echo', requireClientCert(), (req, res) => {
      res.json({ cn: (req as ClusterAuthedRequest).clusterNodeName })
    })
    const srv = await startServer(router)
    try {
      const r = await httpsJsonPost(`${srv.url}/echo`, {}, nodeIdentity, { expectedCn: 'master-1' })
      expect(r.status).toBe(200)
      expect(JSON.parse(r.text).cn).toBe('worker-1')
    } finally {
      await srv.close()
    }
  })

  it('CLIENT rejects a server whose cert CN is not the pinned peer (rogue-node MITM defeated)', async () => {
    const router = express.Router()
    router.post('/echo', requireClientCert(), (_req, res) => { res.json({ ok: true }) })
    // The server presents CN='master-1', but the client expects 'some-other-node'.
    const srv = await startServer(router)
    try {
      await expect(httpsJsonPost(`${srv.url}/echo`, {}, nodeIdentity, { expectedCn: 'some-other-node' }))
        .rejects.toThrow(/does not match expected/)
    } finally {
      await srv.close()
    }
  })

  it('rejects a client certificate signed by a FOREIGN CA (401)', async () => {
    const router = express.Router()
    router.post('/echo', requireClientCert(), (req, res) => {
      res.json({ cn: (req as ClusterAuthedRequest).clusterNodeName })
    })
    const srv = await startServer(router)
    try {
      const r = await httpsJsonPost(`${srv.url}/echo`, {}, evilIdentity, { expectedCn: 'master-1' })
      expect(r.status).toBe(401)
    } finally {
      await srv.close()
    }
  })

  it('rejects a caller that presents NO client certificate (401)', async () => {
    const router = express.Router()
    router.post('/echo', requireClientCert(), (_req, res) => { res.json({ ok: true }) })
    const srv = await startServer(router)
    try {
      const r = await rawPostNoCert(`${srv.url}/echo`, {}, clusterCaPem)
      expect(r.status).toBe(401)
    } finally {
      await srv.close()
    }
  })

  it('pins the CN: a CA-signed peer with the wrong CN is rejected (403) when expectedCn is set', async () => {
    const router = express.Router()
    router.post('/echo', requireClientCert('master-1'), (_req, res) => { res.json({ ok: true }) })
    const srv = await startServer(router)
    try {
      // nodeIdentity's CN is 'worker-1', not the pinned 'master-1'.
      const r = await httpsJsonPost(`${srv.url}/echo`, {}, nodeIdentity, { expectedCn: 'master-1' })
      expect(r.status).toBe(403)
    } finally {
      await srv.close()
    }
  })
})

describe('POST /cluster/db over mTLS — CN overrides body.nodeName', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function clusterApp (): express.Router {
    const r = express.Router()
    r.use('/cluster', createClusterRouter({ mode: 'mtls' }))
    return r
  }

  it('derives the calling node from the verified cert CN, ignoring a spoofed body.nodeName', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({ id: 'worker-1-id' } as never)
    mockPrisma.machine.findMany.mockResolvedValue([] as never)

    const srv = await startServer(clusterApp())
    try {
      // The cert CN is 'worker-1'; the body lies that it is 'attacker'.
      const r = await httpsJsonPost(
        `${srv.url}/cluster/db`,
        { nodeName: 'attacker', method: 'findRunningVMs', args: [] },
        nodeIdentity,
        { expectedCn: 'master-1' }
      )
      expect(r.status).toBe(200)
      expect(JSON.parse(r.text).ok).toBe(true)

      // The node was looked up by the VERIFIED CN, never by the body's claim.
      expect(mockPrisma.node.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'worker-1' } })
      )
      expect(mockPrisma.node.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'attacker' } })
      )
      // And the enumeration was scoped to the resolved node's id (G0).
      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ nodeId: 'worker-1-id' }) })
      )
    } finally {
      await srv.close()
    }
  })

  it('rejects an mTLS ops call with no client certificate (401), never reaching the DB', async () => {
    const srv = await startServer(clusterApp())
    try {
      const r = await rawPostNoCert(`${srv.url}/cluster/db`, { method: 'findRunningVMs', args: [] }, clusterCaPem)
      expect(r.status).toBe(401)
      expect(mockPrisma.node.findFirst).not.toHaveBeenCalled()
    } finally {
      await srv.close()
    }
  })
})

describe('POST /cluster/renew over mTLS (Phase 2.1e cert rotation)', () => {
  beforeEach(() => { jest.clearAllMocks() })

  function clusterApp () {
    const r = express.Router()
    r.use('/cluster', createClusterRouter({ mode: 'mtls' }))
    return r
  }

  it('renews an onboarded node cert, identity derived from the verified CN (no re-approval)', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({ id: 'worker-1-id', name: 'worker-1', status: 'approved', certPem: 'OLD-CERT' } as never)
    mockPrisma.node.update.mockResolvedValue({ id: 'worker-1-id' } as never)

    const srv = await startServer(clusterApp())
    try {
      // The node presents a FRESH CSR (key rotation) over its current mTLS cert.
      const { csrPem } = generateNodeKeyAndCsr('worker-1')
      const r = await httpsJsonPost(`${srv.url}/cluster/renew`, { csrPem }, nodeIdentity, { expectedCn: 'master-1' })

      expect(r.status).toBe(200)
      const body = JSON.parse(r.text)
      expect(body.status).toBe('issued')
      expect(typeof body.certPem).toBe('string')
      // Looked up + updated by the VERIFIED CN (worker-1), and the cert was persisted.
      expect(mockPrisma.node.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'worker-1' } })
      )
      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'worker-1-id' }, data: expect.objectContaining({ certPem: body.certPem }) })
      )
    } finally {
      await srv.close()
    }
  })

  it('rejects renew with no client certificate (401), never touching the DB', async () => {
    const srv = await startServer(clusterApp())
    try {
      const r = await rawPostNoCert(`${srv.url}/cluster/renew`, { csrPem: 'x' }, clusterCaPem)
      expect(r.status).toBe(401)
      expect(mockPrisma.node.update).not.toHaveBeenCalled()
    } finally {
      await srv.close()
    }
  })
})
