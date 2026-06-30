import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'

import { mockPrisma } from '../setup/jest.setup'
import clusterRouter from '../../app/routes/cluster'

/**
 * Multi-node Phase 2: the node-facing onboarding endpoints (/cluster/enroll,
 * /cluster/enroll/poll). Token-gated bootstrap; the route wiring + validation is
 * tested here (the full SAS state machine is in NodeEnrollmentService.test). Uses
 * mockPrisma + a temp CA dir (the CA is generated on first enroll).
 */
const TOKEN = 'test-cluster-token'
let caDir: string

const app = express()
app.use('/cluster', clusterRouter)

function makeCsr (cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([{ name: 'commonName', value: cn }])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return forge.pki.certificationRequestToPem(csr)
}

function post (route: string, body: unknown, token: string | null = TOKEN): request.Test {
  const r = request(app).post(route)
  if (token) r.set('authorization', `Bearer ${token}`)
  return r.send(body as object)
}

describe('POST /cluster/enroll + /cluster/enroll/poll', () => {
  beforeAll(() => {
    caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-enroll-route-ca-'))
    process.env.INFINIBAY_CLUSTER_TOKEN = TOKEN
    process.env.INFINIBAY_CLUSTER_CA_DIR = caDir
  })
  afterAll(() => { fs.rmSync(caDir, { recursive: true, force: true }) })
  beforeEach(() => { jest.clearAllMocks() })

  it('returns 401 without a valid token', async () => {
    const res = await post('/cluster/enroll', { name: 'w1', csrPem: makeCsr('w1') }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('returns 400 when name or csrPem is missing', async () => {
    expect((await post('/cluster/enroll', { name: 'w1' })).status).toBe(400)
    expect((await post('/cluster/enroll', { csrPem: makeCsr('w1') })).status).toBe(400)
  })

  it('returns 400 for an unparseable CSR', async () => {
    const res = await post('/cluster/enroll', { name: 'w1', csrPem: 'not-a-csr' })
    expect(res.status).toBe(400)
  })

  it('enrolls a new node → pending, returns joinNonce + caCertPem, and does NOT leak the SAS', async () => {
    mockPrisma.node.findFirst.mockResolvedValue(null as never)
    mockPrisma.node.create.mockResolvedValue({ id: 'node-1' } as never)

    const res = await post('/cluster/enroll', { name: 'worker-1', csrPem: makeCsr('worker-1') })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending')
    expect(typeof res.body.joinNonce).toBe('string')
    expect(res.body.caCertPem).toMatch(/BEGIN CERTIFICATE/)
    // The node must compute its own SAS; the master must NOT hand it over.
    expect(res.body.sasCode).toBeUndefined()
  })

  it('poll for a still-pending node returns {status:pending} (no cert)', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({
      id: 'node-1', name: 'worker-1', status: 'pending', fingerprint: 'fp', certPem: null
    } as never)

    const res = await post('/cluster/enroll/poll', { name: 'worker-1', csrPem: makeCsr('worker-1') })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending')
    expect(res.body.certPem).toBeUndefined()
  })

  it('poll for a rejected node returns 409', async () => {
    mockPrisma.node.findFirst.mockResolvedValue({
      id: 'node-1', name: 'worker-1', status: 'rejected', fingerprint: 'fp', certPem: null
    } as never)

    const res = await post('/cluster/enroll/poll', { name: 'worker-1', csrPem: makeCsr('worker-1') })

    expect(res.status).toBe(409)
  })
})
