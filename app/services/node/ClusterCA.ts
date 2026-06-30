import fs from 'fs'
import path from 'path'
import forge from 'node-forge'
import logger from '@main/logger'
import { certFingerprint, csrPublicKeyFingerprint } from './clusterCrypto'

/**
 * Multi-node Phase 2 (onboarding): the cluster's private Certificate Authority.
 *
 * The master is the sole CA. On first use it generates a long-lived self-signed
 * CA keypair (persisted with the same load-or-create discipline as the host HMAC
 * master secret — the key never leaves the master host). When an admin APPROVES a
 * node's join (after the SAS double-verification), the master signs the node's
 * CSR into a short-lived client certificate whose identity (CN) is the
 * master-decided node name — NOT the self-asserted CN in the CSR. That cert is
 * what the node presents for mTLS on every cluster RPC, replacing the shared
 * bootstrap token and closing the nodeName-spoofing gap.
 *
 * The CA cert fingerprint is pinned out-of-band by joining nodes (it is mixed
 * into the SAS code), so a MITM that swaps the CA is detected by the human
 * comparing the short code on the node terminal and in the master UI.
 */

export interface IssuedCert {
  /** PEM of the signed client certificate. */
  certPem: string
  /** SHA-256 fingerprint of the certificate (lowercase hex, no separators). */
  fingerprint: string
  /** notAfter as an ISO string (for storage / renewal scheduling). */
  notAfter: string
}

const CA_KEY_FILE = 'cluster-ca-key.pem'
const CA_CERT_FILE = 'cluster-ca-cert.pem'

// Validity windows. The CA is long-lived (cluster lifetime); node certs are
// short-lived and renewed on heartbeat (a stolen node cert expires on its own).
const CA_VALIDITY_YEARS = 10
const NODE_CERT_VALIDITY_DAYS = 365

export class ClusterCA {
  private readonly caDir: string
  private caCert?: forge.pki.Certificate
  private caKey?: forge.pki.rsa.PrivateKey

  constructor (caDir?: string) {
    this.caDir = caDir ?? process.env.INFINIBAY_CLUSTER_CA_DIR ?? '/opt/infinibay/ca'
  }

  private keyPath (): string { return path.join(this.caDir, CA_KEY_FILE) }
  private certPath (): string { return path.join(this.caDir, CA_CERT_FILE) }

  /**
   * Load the CA from disk, or generate + persist it on first use. Idempotent:
   * once loaded it is cached in-process. The private key file is written 0600.
   */
  loadOrCreate (): void {
    if (this.caCert && this.caKey) return

    if (fs.existsSync(this.keyPath()) && fs.existsSync(this.certPath())) {
      this.caKey = forge.pki.privateKeyFromPem(fs.readFileSync(this.keyPath(), 'utf8')) as forge.pki.rsa.PrivateKey
      this.caCert = forge.pki.certificateFromPem(fs.readFileSync(this.certPath(), 'utf8'))
      return
    }

    logger.info('🔐 Generating cluster CA (first run)...')
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    // Random positive serial (leading 0 byte avoids a negative two's-complement).
    cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(16))
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS)

    const attrs = [{ name: 'commonName', value: 'Infinibay Cluster CA' }, { name: 'organizationName', value: 'Infinibay' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs) // self-signed
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())

    fs.mkdirSync(this.caDir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.keyPath(), forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })
    fs.writeFileSync(this.certPath(), forge.pki.certificateToPem(cert), { mode: 0o644 })

    this.caKey = keys.privateKey
    this.caCert = cert
    logger.info(`🔐 Cluster CA created at ${this.caDir} (fingerprint ${this.caFingerprint()})`)
  }

  /** PEM of the CA certificate (nodes pin this). */
  getCaCertPem (): string {
    this.loadOrCreate()
    return forge.pki.certificateToPem(this.caCert!)
  }

  /** SHA-256 fingerprint of the CA cert — the value pinned out-of-band / in the SAS. */
  caFingerprint (): string {
    this.loadOrCreate()
    return ClusterCA.fingerprintOf(this.caCert!)
  }

  /**
   * Sign a node's CSR into a client certificate. The issued identity (CN) is the
   * master-decided `nodeName`, NOT whatever the CSR self-asserts — enrollment, not
   * the applicant, decides identity. Only the CSR's public key is trusted (after
   * verifying the CSR self-signature).
   */
  signNodeCsr (csrPem: string, nodeName: string): IssuedCert {
    this.loadOrCreate()
    const csr = forge.pki.certificationRequestFromPem(csrPem)
    if (!csr.verify()) {
      throw new Error('CSR self-signature is invalid')
    }
    if (!csr.publicKey) {
      throw new Error('CSR has no public key')
    }

    const cert = forge.pki.createCertificate()
    cert.publicKey = csr.publicKey
    cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(16))
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + NODE_CERT_VALIDITY_DAYS)

    // Identity is assigned by the master, not copied from the CSR subject.
    cert.setSubject([{ name: 'commonName', value: nodeName }])
    cert.setIssuer(this.caCert!.subject.attributes)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      // clientAuth: this cert authenticates the node TO the master.
      { name: 'extKeyUsage', clientAuth: true, serverAuth: true }
    ])
    cert.sign(this.caKey!, forge.md.sha256.create())

    return {
      certPem: forge.pki.certificateToPem(cert),
      fingerprint: ClusterCA.fingerprintOf(cert),
      notAfter: cert.validity.notAfter.toISOString()
    }
  }

  /** SHA-256 fingerprint (lowercase hex) of a PEM certificate. */
  static fingerprint (certPem: string): string {
    return certFingerprint(certPem)
  }

  /**
   * SHA-256 fingerprint of the PUBLIC KEY inside a CSR. Binds a pending enrollment
   * to a specific keypair (the node must re-present the SAME public key at poll
   * time) and is mixed into the SAS code. Delegates to the shared cluster crypto.
   */
  static csrPublicKeyFingerprint (csrPem: string): string {
    return csrPublicKeyFingerprint(csrPem)
  }

  private static fingerprintOf (cert: forge.pki.Certificate): string {
    return certFingerprint(forge.pki.certificateToPem(cert))
  }
}
