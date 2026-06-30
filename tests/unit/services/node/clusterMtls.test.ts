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

/** A fake TLS socket good enough for peerCommonName / requireClientCert. */
function fakeSocket (opts: { authorized: boolean, cn?: string | null }): TLSSocket {
  return {
    authorized: opts.authorized,
    getPeerCertificate: () => (opts.cn === undefined ? {} : { subject: { CN: opts.cn } })
  } as unknown as TLSSocket
}

describe('clusterMtls — pure helpers', () => {
  describe('loadClusterIdentity', () => {
    let dir: string
    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-identity-')) })
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

    it('returns null when the materials are not all present', () => {
      expect(loadClusterIdentity(dir)).toBeNull()
      fs.writeFileSync(path.join(dir, 'node-key.pem'), 'KEY')
      expect(loadClusterIdentity(dir)).toBeNull() // cert + ca still missing
    })

    it('returns the bundle once key + cert + ca all exist', () => {
      fs.writeFileSync(path.join(dir, 'node-cert.pem'), 'CERT')
      fs.writeFileSync(path.join(dir, 'cluster-ca.pem'), 'CA')
      expect(loadClusterIdentity(dir)).toEqual({ key: 'KEY', cert: 'CERT', ca: 'CA' })
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
