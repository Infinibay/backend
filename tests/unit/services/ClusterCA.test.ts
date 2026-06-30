import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import path from 'path'
import forge from 'node-forge'
import { ClusterCA } from '../../../app/services/node/ClusterCA'

/**
 * Multi-node Phase 2: the cluster CA. Pure crypto — no DB, no KVM. Proves the
 * master can mint node client certs that chain to its CA, with the identity the
 * MASTER decides (not the CSR's self-asserted CN), and that the CA persists.
 */
function makeCsr (cn: string): { csrPem: string, keys: forge.pki.rsa.KeyPair } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([{ name: 'commonName', value: cn }])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return { csrPem: forge.pki.certificationRequestToPem(csr), keys }
}

describe('ClusterCA', () => {
  let caDir: string

  beforeAll(() => {
    caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-ca-'))
  })
  afterAll(() => {
    fs.rmSync(caDir, { recursive: true, force: true })
  })

  it('creates + persists the CA on first use (key 0600), reuses it afterwards', () => {
    const ca = new ClusterCA(caDir)
    const fp1 = ca.caFingerprint()
    expect(fp1).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.existsSync(path.join(caDir, 'cluster-ca-key.pem'))).toBe(true)
    // The private key must not be world-readable.
    const mode = fs.statSync(path.join(caDir, 'cluster-ca-key.pem')).mode & 0o777
    expect(mode).toBe(0o600)

    // A fresh instance over the same dir loads the SAME CA (stable fingerprint).
    const ca2 = new ClusterCA(caDir)
    expect(ca2.caFingerprint()).toBe(fp1)
  })

  it('signs a node CSR into a cert that CHAINS TO THE CA', () => {
    const ca = new ClusterCA(caDir)
    const { csrPem } = makeCsr('worker-1')

    const issued = ca.signNodeCsr(csrPem, 'worker-1')
    const cert = forge.pki.certificateFromPem(issued.certPem)
    const caCert = forge.pki.certificateFromPem(ca.getCaCertPem())

    // The issued cert verifies against the CA's public key.
    expect(caCert.verify(cert)).toBe(true)
    // And via a CA store chain verification.
    const store = forge.pki.createCaStore([caCert])
    expect(() => forge.pki.verifyCertificateChain(store, [cert])).not.toThrow()

    expect(issued.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(ClusterCA.fingerprint(issued.certPem)).toBe(issued.fingerprint)
  })

  it('assigns the MASTER-decided identity (CN), not the CSR self-asserted one', () => {
    const ca = new ClusterCA(caDir)
    // The applicant lies in its CSR, claiming to be the master.
    const { csrPem } = makeCsr('master-impersonator')

    const issued = ca.signNodeCsr(csrPem, 'worker-2')
    const cert = forge.pki.certificateFromPem(issued.certPem)
    const cn = cert.subject.getField('CN')?.value

    // Enrollment decided 'worker-2'; the CSR's claimed CN is ignored.
    expect(cn).toBe('worker-2')
  })

  it('marks the node cert as a non-CA clientAuth leaf', () => {
    const ca = new ClusterCA(caDir)
    const { csrPem } = makeCsr('worker-3')
    const cert = forge.pki.certificateFromPem(ca.signNodeCsr(csrPem, 'worker-3').certPem)

    const bc = cert.getExtension('basicConstraints') as { cA?: boolean } | undefined
    expect(bc?.cA).toBeFalsy()
    const eku = cert.getExtension('extKeyUsage') as { clientAuth?: boolean } | undefined
    expect(eku?.clientAuth).toBe(true)
  })

  it('rejects a CSR with a broken self-signature', () => {
    const ca = new ClusterCA(caDir)
    const { csrPem } = makeCsr('worker-4')
    // Corrupt the CSR body so its self-signature no longer verifies.
    const tampered = csrPem.replace(/[A-Za-z0-9]{8}(?=[\s\S]{40})/, 'AAAAAAAA')
    expect(() => ca.signNodeCsr(tampered, 'worker-4')).toThrow()
  })

  it('expiresWithinDays detects an approaching expiry (drives renewal)', () => {
    const ca = new ClusterCA(caDir)
    const { csrPem } = makeCsr('worker-exp')
    const certPem = ca.signNodeCsr(csrPem, 'worker-exp').certPem // 365-day leaf
    expect(ClusterCA.expiresWithinDays(certPem, 30)).toBe(false) // not within 30 days
    expect(ClusterCA.expiresWithinDays(certPem, 400)).toBe(true) // within 400 days (it's a 365d cert)
  })

  it('mints the master mTLS identity (CN, chains to CA, persisted 0600, idempotent)', () => {
    const ca = new ClusterCA(caDir)
    const id = ca.getMasterIdentity('master-1')

    // Bundle is well-formed: a private key, a leaf cert, and the CA cert.
    expect(id.key).toMatch(/BEGIN (RSA )?PRIVATE KEY/)
    expect(id.ca).toBe(ca.getCaCertPem())

    const cert = forge.pki.certificateFromPem(id.cert)
    expect(cert.subject.getField('CN')?.value).toBe('master-1')
    // The leaf chains to the CA and carries BOTH client + server auth (the master
    // is a server to enrolling nodes and a client to node verb servers).
    const caCert = forge.pki.certificateFromPem(id.ca)
    expect(caCert.verify(cert)).toBe(true)
    const eku = cert.getExtension('extKeyUsage') as { clientAuth?: boolean, serverAuth?: boolean } | undefined
    expect(eku?.clientAuth).toBe(true)
    expect(eku?.serverAuth).toBe(true)

    // Persisted with a private key that is not world-readable.
    const keyMode = fs.statSync(path.join(caDir, 'cluster-master-key.pem')).mode & 0o777
    expect(keyMode).toBe(0o600)

    // Idempotent: a second call returns the SAME persisted leaf (stable fingerprint).
    expect(ClusterCA.fingerprint(new ClusterCA(caDir).getMasterIdentity('master-1').cert))
      .toBe(ClusterCA.fingerprint(id.cert))
  })
})
