import { createHash, generateKeyPairSync } from 'crypto'
import forge from 'node-forge'

/**
 * Pure cluster crypto primitives — NO Prisma, NO logger, NO filesystem. Shared by
 * the master (ClusterCA / NodeEnrollmentService) AND the node agent's enrollment
 * client, so both compute the SAS and fingerprints with byte-identical formulas.
 * Keep this module dependency-light so the agent can import it without dragging in
 * any backend singleton.
 */

/** SHA-256 fingerprint (lowercase hex) of a PEM certificate. */
export function certFingerprint (certPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return forge.md.sha256.create().update(der).digest().toHex()
}

/**
 * True if the PEM cert is expired or expires within `days` from `now` (default
 * the current time). Used to drive proactive certificate renewal — the master's
 * own leaf AND the node agent's leaf re-mint before they lapse, so a long-running
 * cluster never hits a fixed-date mTLS outage.
 */
export function certExpiresWithinDays (certPem: string, days: number, now: Date = new Date()): boolean {
  const cert = forge.pki.certificateFromPem(certPem)
  const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return cert.validity.notAfter <= threshold
}

/**
 * SHA-256 fingerprint of the PUBLIC KEY inside a CSR (SubjectPublicKeyInfo).
 * Verifies the CSR self-signature first.
 */
export function csrPublicKeyFingerprint (csrPem: string): string {
  const csr = forge.pki.certificationRequestFromPem(csrPem)
  if (!csr.verify()) {
    throw new Error('CSR self-signature is invalid')
  }
  if (!csr.publicKey) {
    throw new Error('CSR has no public key')
  }
  return forge.pki.getPublicKeyFingerprint(csr.publicKey, {
    type: 'SubjectPublicKeyInfo',
    md: forge.md.sha256.create(),
    encoding: 'hex'
  }) as string
}

/**
 * The 6-digit short authentication string both the node and the master compute
 * INDEPENDENTLY from the same three values. A MITM that swaps the node key or the
 * CA changes the code on one side → the human comparing the node terminal and the
 * master UI catches it. Deterministic; uniform over 000000-999999.
 */
export function computeSas (csrPubKeyFingerprint: string, joinNonce: string, caFingerprint: string): string {
  const digest = createHash('sha256')
    .update(`${csrPubKeyFingerprint}|${joinNonce}|${caFingerprint}`)
    .digest()
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
}

/**
 * Generate a fresh RSA-2048 keypair and a CSR (CN = commonName) for a node's
 * enrollment. Used by the agent's join client.
 */
export function generateNodeKeyAndCsr (commonName: string): { privateKeyPem: string, csrPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject([{ name: 'commonName', value: commonName }])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr)
  }
}

/**
 * Generate a WireGuard (Curve25519 / X25519) keypair for the department overlay
 * mesh (07-networking.md §1, ADR-N4). Returns the raw 32-byte keys base64-encoded,
 * exactly as WireGuard's `wg` tool expects — WITHOUT shelling out to `wg`, so a
 * node can mint its identity at enrollment before wireguard-tools is even present
 * (the `wg` binary is still needed at realize-time on an overlay-hosting node).
 *
 * The raw scalar/point are the last 32 bytes of the PKCS8 / SPKI DER encodings
 * (X25519 DER is fixed-length: 48-byte private, 44-byte public). WireGuard clamps
 * the scalar on load; the public point Node derived already corresponds to the
 * clamped scalar, so the pair round-trips through `wg` unchanged. The PRIVATE key
 * is the caller's secret to persist 0600 and never transmit.
 */
export function generateWireguardKeypair (): { privateKeyBase64: string, publicKeyBase64: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' })
  return {
    privateKeyBase64: pkcs8.subarray(pkcs8.length - 32).toString('base64'),
    publicKeyBase64: spki.subarray(spki.length - 32).toString('base64')
  }
}
