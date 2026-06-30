import { createHash } from 'crypto'
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
