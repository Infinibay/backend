import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'
import { PrismaClient } from '@prisma/client'
import { ClusterCA } from '../../../app/services/node/ClusterCA'
import { NodeEnrollmentService } from '../../../app/services/node/NodeEnrollmentService'

/**
 * Multi-node Phase 2: SAS-verified enrollment. Uses a real ClusterCA (temp dir)
 * and a faithful in-memory fake of prisma.node so the full pending → approve →
 * poll → issued state machine runs end to end. No DB, no KVM.
 */
function makeNodeKeyAndCsr (cn: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([{ name: 'commonName', value: cn }])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return forge.pki.certificationRequestToPem(csr)
}

function makeFakePrisma (): { prisma: PrismaClient, dump: () => Record<string, unknown> } {
  const byId = new Map<string, Record<string, unknown>>()
  const byName = new Map<string, Record<string, unknown>>()
  let seq = 0
  const put = (n: Record<string, unknown>): void => { byId.set(n.id as string, n); byName.set(n.name as string, n) }
  const find = (where: { id?: string, name?: string }): Record<string, unknown> | undefined =>
    where.id !== undefined ? byId.get(where.id) : byName.get(where.name as string)

  const node = {
    findFirst: async ({ where }: any) => {
      const n = byName.get(where.name)
      return n ? { ...n } : null
    },
    create: async ({ data }: any) => {
      const n = { id: `node-${++seq}`, ...data }
      put(n)
      return { ...n }
    },
    findUnique: async ({ where }: any) => {
      const n = find(where)
      return n ? { ...n } : null
    },
    update: async ({ where, data }: any) => {
      const n = find(where)
      if (!n) throw new Error('record not found')
      const updated = { ...n, ...data }
      put(updated)
      return updated
    }
  }
  return { prisma: { node } as unknown as PrismaClient, dump: () => Object.fromEntries(byName) }
}

describe('NodeEnrollmentService (SAS-verified onboarding)', () => {
  let caDir: string
  let ca: ClusterCA

  beforeAll(() => {
    caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-enroll-ca-'))
    ca = new ClusterCA(caDir)
    ca.loadOrCreate()
  })
  afterAll(() => { fs.rmSync(caDir, { recursive: true, force: true }) })

  it('SAS is deterministic and matches what the node computes independently (double-verification)', () => {
    const sasMaster = NodeEnrollmentService.computeSas('pubfp', 'nonce123', 'cafp')
    const sasNode = NodeEnrollmentService.computeSas('pubfp', 'nonce123', 'cafp')
    expect(sasMaster).toMatch(/^\d{6}$/)
    expect(sasNode).toBe(sasMaster)

    // A MITM that swaps the CA (different caFingerprint) yields a DIFFERENT code,
    // so the human comparing node-terminal vs master-UI catches it.
    const sasMitm = NodeEnrollmentService.computeSas('pubfp', 'nonce123', 'attacker-ca-fp')
    expect(sasMitm).not.toBe(sasMaster)
  })

  it('runs the full flow: request → (node recomputes SAS) → approve → poll → issued cert chaining to the CA', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const csrPem = makeNodeKeyAndCsr('worker-1')

    // 1. request
    const pending = await svc.requestEnrollment({ name: 'worker-1', csrPem })
    expect(pending.status).toBe('pending')
    expect(pending.sasCode).toMatch(/^\d{6}$/)

    // The NODE independently recomputes the SAS from its own pubkey fingerprint,
    // the returned nonce, and the CA fingerprint from the returned CA cert.
    const pubFp = ClusterCA.csrPublicKeyFingerprint(csrPem)
    const caFp = ClusterCA.fingerprint(pending.caCertPem)
    expect(NodeEnrollmentService.computeSas(pubFp, pending.joinNonce, caFp)).toBe(pending.sasCode)

    // 2. polling before approval → still pending, no cert
    const beforeApprove = await svc.poll({ name: 'worker-1', csrPem })
    expect(beforeApprove.status).toBe('pending')

    // 3. admin approves (re-typing the SAS read off the node terminal)
    await svc.approve(pending.nodeId, pending.sasCode)

    // 4. node polls → issued
    const issued = await svc.poll({ name: 'worker-1', csrPem })
    expect(issued.status).toBe('issued')
    if (issued.status !== 'issued') throw new Error('unreachable')

    const cert = forge.pki.certificateFromPem(issued.certPem)
    const caCert = forge.pki.certificateFromPem(ca.getCaCertPem())
    expect(caCert.verify(cert)).toBe(true) // chains to the CA
    expect(cert.subject.getField('CN')?.value).toBe('worker-1')
    expect(issued.fingerprint).toBe(ClusterCA.fingerprint(issued.certPem))

    // 5. idempotent re-poll returns the same cert
    const again = await svc.poll({ name: 'worker-1', csrPem })
    expect(again.status).toBe('issued')
    if (again.status === 'issued') expect(again.certPem).toBe(issued.certPem)
  })

  it('approve rejects a mismatched typed SAS', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const csrPem = makeNodeKeyAndCsr('worker-2')
    const pending = await svc.requestEnrollment({ name: 'worker-2', csrPem })

    await expect(svc.approve(pending.nodeId, '000000')).rejects.toThrow(/SAS code mismatch|mismatch/i)
    // and the node is still pending (not approved)
    const stillPending = await svc.poll({ name: 'worker-2', csrPem })
    expect(stillPending.status).toBe('pending')
  })

  it('poll after approval REFUSES a CSR with a different public key (binding)', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const csrPem = makeNodeKeyAndCsr('worker-3')
    const pending = await svc.requestEnrollment({ name: 'worker-3', csrPem })
    await svc.approve(pending.nodeId)

    // An attacker who saw the approval tries to redeem it with a DIFFERENT key.
    const attackerCsr = makeNodeKeyAndCsr('worker-3')
    await expect(svc.poll({ name: 'worker-3', csrPem: attackerCsr })).rejects.toThrow(/public key does not match/)
  })

  it('reject marks the node rejected and poll then throws', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const csrPem = makeNodeKeyAndCsr('worker-4')
    const pending = await svc.requestEnrollment({ name: 'worker-4', csrPem })

    await svc.reject(pending.nodeId)
    await expect(svc.poll({ name: 'worker-4', csrPem })).rejects.toThrow(/rejected/)
  })

  it('REFUSES to enroll under the master node name (CN-collision / row hijack guard)', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const prev = process.env.INFINIBAY_NODE_NAME
    process.env.INFINIBAY_NODE_NAME = 'the-master'
    try {
      const csrPem = makeNodeKeyAndCsr('the-master')
      await expect(svc.requestEnrollment({ name: 'the-master', csrPem })).rejects.toThrow(/reserved for the master/)
    } finally {
      if (prev === undefined) delete process.env.INFINIBAY_NODE_NAME
      else process.env.INFINIBAY_NODE_NAME = prev
    }
  })

  it('REFUSES to silently rebind an already-issued node; allows it only after an admin reject', async () => {
    const { prisma } = makeFakePrisma()
    const svc = new NodeEnrollmentService(prisma, ca)
    const csrPem = makeNodeKeyAndCsr('worker-6')
    const pending = await svc.requestEnrollment({ name: 'worker-6', csrPem })
    await svc.approve(pending.nodeId, pending.sasCode)
    const issued = await svc.poll({ name: 'worker-6', csrPem })
    expect(issued.status).toBe('issued')

    // An attacker holding the bootstrap token tries to take over the live identity
    // with a FRESH key — refused while the node is approved/issued.
    const attackerCsr = makeNodeKeyAndCsr('worker-6')
    await expect(svc.requestEnrollment({ name: 'worker-6', csrPem: attackerCsr }))
      .rejects.toThrow(/already enrolled.*reject/i)

    // After an explicit admin reject (which clears the issued cert), re-enrollment
    // is allowed again — the legitimate reinstall path.
    await svc.reject(pending.nodeId)
    const reenrolled = await svc.requestEnrollment({ name: 'worker-6', csrPem: attackerCsr })
    expect(reenrolled.status).toBe('pending')
  })
})
