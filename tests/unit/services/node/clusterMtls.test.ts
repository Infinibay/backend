import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'
import request from 'supertest'
import type { Request, Response } from 'express'
import type { TLSSocket } from 'node:tls'

import { loadClusterIdentity, peerCommonName, requireClientCert, type ClusterAuthedRequest } from '../../../../app/services/node/clusterMtls'
import { createClusterRouter } from '../../../../app/routes/cluster'
import { ClusterCA } from '../../../../app/services/node/ClusterCA'
import { generateNodeKeyAndCsr } from '../../../../app/services/node/clusterCrypto'

/** A fake TLS socket good enough for peerCommonName / requireClientCert. */
function fakeSocket (opts: { authorized: boolean, cn?: string | null }): TLSSocket {
  return {
    authorized: opts.authorized,
    getPeerCertificate: () => (opts.cn === undefined ? {} : { subject: { CN: opts.cn } })
  } as unknown as TLSSocket
}

describe('clusterMtls — pure helpers', () => {
  describe('loadClusterIdentity', () => {
    let caDir: string
    let ca: ClusterCA
    let key: string
    let cert: string
    let caPem: string
    beforeAll(() => {
      caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-identity-ca-'))
      process.env.INFINIBAY_CLUSTER_CA_DIR = caDir
      ca = new ClusterCA(caDir)
      ca.loadOrCreate()
      caPem = ca.getCaCertPem()
      const g = generateNodeKeyAndCsr('worker-1')
      key = g.privateKeyPem
      cert = ca.signNodeCsr(g.csrPem, 'worker-1').certPem
    })
    afterAll(() => { fs.rmSync(caDir, { recursive: true, force: true }) })

    function freshDir (): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-identity-')) }

    it('returns null when the materials are not all present', () => {
      const dir = freshDir()
      expect(loadClusterIdentity(dir)).toBeNull()
      fs.writeFileSync(path.join(dir, 'node-key.pem'), key)
      expect(loadClusterIdentity(dir)).toBeNull() // cert + ca still missing
    })

    it('returns the bundle once a MATCHING key + cert + ca all exist', () => {
      const dir = freshDir()
      fs.writeFileSync(path.join(dir, 'node-key.pem'), key)
      fs.writeFileSync(path.join(dir, 'node-cert.pem'), cert)
      fs.writeFileSync(path.join(dir, 'cluster-ca.pem'), caPem)
      expect(loadClusterIdentity(dir)).toEqual({ key, cert, ca: caPem })
    })

    it('returns null for a TORN renewal — key and cert do not correspond (avoids a startup crash-loop)', () => {
      const dir = freshDir()
      const otherKey = generateNodeKeyAndCsr('worker-1').privateKeyPem // a different keypair
      fs.writeFileSync(path.join(dir, 'node-key.pem'), otherKey)
      fs.writeFileSync(path.join(dir, 'node-cert.pem'), cert) // cert for the ORIGINAL key
      fs.writeFileSync(path.join(dir, 'cluster-ca.pem'), caPem)
      expect(loadClusterIdentity(dir)).toBeNull()
    })
  })

  describe('peerCommonName', () => {
    it('returns the CN only for an AUTHORIZED peer', () => {
      expect(peerCommonName(fakeSocket({ authorized: true, cn: 'worker-1' }))).toBe('worker-1')
    })
    it('returns null for an unauthorized peer (wrong/foreign CA)', () => {
      expect(peerCommonName(fakeSocket({ authorized: false, cn: 'worker-1' }))).toBeNull()
    })
    it('returns null when no certificate / no CN was presented', () => {
      expect(peerCommonName(fakeSocket({ authorized: true }))).toBeNull()
      expect(peerCommonName(fakeSocket({ authorized: true, cn: '' }))).toBeNull()
      expect(peerCommonName(null)).toBeNull()
      expect(peerCommonName({} as unknown as TLSSocket)).toBeNull()
    })
  })

  describe('requireClientCert middleware', () => {
    function run (socket: TLSSocket, expectedCn?: string): { status: number, body: unknown, nextCalled: boolean, cn?: string } {
      const result = { status: 200, body: undefined as unknown, nextCalled: false, cn: undefined as string | undefined }
      const req = { socket } as unknown as Request
      const res = {
        status (code: number) { result.status = code; return this },
        json (b: unknown) { result.body = b; return this }
      } as unknown as Response
      requireClientCert(expectedCn)(req, res, () => {
        result.nextCalled = true
        result.cn = (req as ClusterAuthedRequest).clusterNodeName
      })
      return result
    }

    it('passes and stamps clusterNodeName for a verified cert', () => {
      const r = run(fakeSocket({ authorized: true, cn: 'worker-1' }))
      expect(r.nextCalled).toBe(true)
      expect(r.cn).toBe('worker-1')
    })

    it('401s with no verified cert', () => {
      const r = run(fakeSocket({ authorized: false, cn: 'worker-1' }))
      expect(r.nextCalled).toBe(false)
      expect(r.status).toBe(401)
    })

    it('403s when the CN does not match the pin', () => {
      const r = run(fakeSocket({ authorized: true, cn: 'worker-1' }), 'master-1')
      expect(r.nextCalled).toBe(false)
      expect(r.status).toBe(403)
    })
  })
})

describe('cluster router (token mode) — mTLS downgrade guard', () => {
  const TOKEN = 'test-cluster-token'
  const app = express()
  app.use('/cluster', createClusterRouter({ mode: 'token' }))

  afterEach(() => { delete process.env.INFINIBAY_CLUSTER_MTLS })

  it('retires the token OPS path with 421 when mTLS is enabled cluster-wide', async () => {
    process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN
    process.env.INFINIBAY_CLUSTER_MTLS = '1'
    const res = await request(app)
      .post('/cluster/db')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ nodeName: 'worker-1', method: 'findRunningVMs', args: [] })
    expect(res.status).toBe(421)
  })

  it('keeps ENROLLMENT reachable over the token path even when mTLS is enabled', async () => {
    process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN
    process.env.INFINIBAY_CLUSTER_MTLS = '1'
    // A cert-less joining node still enrolls over HTTP+token; a missing CSR is a
    // 400 (validation) — crucially NOT a 421 (the route is not retired).
    const res = await request(app)
      .post('/cluster/enroll')
      .set('authorization', `Bearer ${TOKEN}`)
      .send({ name: 'worker-1' })
    expect(res.status).not.toBe(421)
    expect(res.status).toBe(400)
  })
})
