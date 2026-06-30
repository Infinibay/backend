import { createHash, randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { ClusterCA } from './ClusterCA'

/**
 * Multi-node Phase 2 (onboarding): SAS-verified node enrollment.
 *
 * The "add a node, simply + safely" flow the operator asked for:
 *
 *   1. requestEnrollment — a new node POSTs its name + CSR. The master records a
 *      PENDING node and returns a join nonce + the CA cert. NO trust yet.
 *   2. SAS double-verification — both the node terminal AND the master UI display
 *      the SAME 6-digit code, computed independently from
 *      SHA256(csrPublicKeyFingerprint | joinNonce | caFingerprint). A human
 *      confirms they match. A MITM that swaps either the node's key or the CA
 *      produces a different code on one side → the human catches it.
 *   3. approve — an admin approves the pending node (optionally re-typing the SAS
 *      to prove out-of-band sight of the node terminal).
 *   4. poll — the node re-presents its CSR; the master verifies the public key
 *      matches the enrolled one, signs it into a client cert, and returns it. The
 *      node now holds an mTLS identity and stops using the shared bootstrap token.
 *
 * The CSR is NEVER stored: the node re-presents it at poll time, bound to the
 * enrollment by its public-key fingerprint. Only the public-key fingerprint, the
 * join nonce, and the SAS hash live on the pending Node row.
 */

export interface EnrollmentRequest {
  name: string
  csrPem: string
}

export type EnrollmentResult =
  | { status: 'pending', nodeId: string, sasCode: string, joinNonce: string, caCertPem: string }
  | { status: 'rejected' }
  | { status: 'issued', certPem: string, caCertPem: string, fingerprint: string }

// Placeholder hardware for a node row created at enrollment time (before the
// first heartbeat reports the real values). These columns are non-nullable.
const PLACEHOLDER_HW = { currentRaid: 'unknown', cpuFlags: {}, ram: 0, cores: 0 }

export class NodeEnrollmentService {
  constructor (private readonly prisma: PrismaClient, private readonly ca: ClusterCA) {}

  /**
   * The 6-digit short authentication string both sides compute independently.
   * Deterministic in its three inputs; uniform over 000000-999999.
   */
  static computeSas (csrPublicKeyFingerprint: string, joinNonce: string, caFingerprint: string): string {
    const digest = createHash('sha256')
      .update(`${csrPublicKeyFingerprint}|${joinNonce}|${caFingerprint}`)
      .digest()
    const n = digest.readUInt32BE(0) % 1_000_000
    return n.toString().padStart(6, '0')
  }

  private static hashSas (sasCode: string): string {
    return createHash('sha256').update(sasCode).digest('hex')
  }

  /**
   * Step 1: a node requests to join. Upserts a PENDING node bound to the CSR's
   * public key and returns the SAS material the node displays on its terminal.
   */
  async requestEnrollment (req: EnrollmentRequest): Promise<Extract<EnrollmentResult, { status: 'pending' }>> {
    const pubKeyFp = ClusterCA.csrPublicKeyFingerprint(req.csrPem) // also verifies the CSR self-signature
    const joinNonce = randomBytes(16).toString('hex')
    const caFingerprint = this.ca.caFingerprint()
    const sasCode = NodeEnrollmentService.computeSas(pubKeyFp, joinNonce, caFingerprint)
    const joinCodeHash = NodeEnrollmentService.hashSas(sasCode)

    // `name` is not a DB-unique column (matching NodeHeartbeatService), so we
    // manually upsert via findFirst → create/update rather than prisma.upsert.
    const existing = await this.prisma.node.findFirst({ where: { name: req.name }, select: { id: true } })
    let nodeId: string
    if (existing) {
      // Re-enrollment (node reinstalled / new key): reset back to pending and
      // drop any previously-issued cert.
      await this.prisma.node.update({
        where: { id: existing.id },
        data: { status: 'pending', joinNonce, joinCodeHash, fingerprint: pubKeyFp, certPem: null }
      })
      nodeId = existing.id
    } else {
      const created = await this.prisma.node.create({
        data: {
          name: req.name,
          role: 'compute',
          status: 'pending',
          joinNonce,
          joinCodeHash,
          fingerprint: pubKeyFp,
          ...PLACEHOLDER_HW
        },
        select: { id: true }
      })
      nodeId = created.id
    }

    logger.info(`🔗 Node '${req.name}' requested enrollment (pending approval, SAS computed)`)
    return { status: 'pending', nodeId, sasCode, joinNonce, caCertPem: this.ca.getCaCertPem() }
  }

  /**
   * Step 3: an admin approves a pending node. If `typedSas` is supplied it must
   * match the stored SAS hash — i.e. the admin proves they read the code off the
   * node's own terminal (the strongest form of the double-check).
   */
  async approve (nodeId: string, typedSas?: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, name: true, status: true, joinCodeHash: true }
    })
    if (!node) {
      throw new Error(`node not found: ${nodeId}`)
    }
    if (node.status !== 'pending') {
      throw new Error(`node ${node.name} is not pending (status=${node.status})`)
    }
    if (typedSas !== undefined && NodeEnrollmentService.hashSas(typedSas) !== node.joinCodeHash) {
      throw new Error('SAS code mismatch — the typed pairing code does not match the node')
    }
    await this.prisma.node.update({ where: { id: nodeId }, data: { status: 'approved' } })
    logger.info(`✅ Node '${node.name}' approved for the cluster`)
  }

  /** Reject a pending node: mark rejected and drop the join material. */
  async reject (nodeId: string): Promise<void> {
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { status: 'rejected', joinNonce: null, joinCodeHash: null }
    })
  }

  /**
   * Step 4: the node polls for its certificate. Returns 'pending' until approved,
   * throws on 'rejected', and on first poll after approval signs the (re-presented)
   * CSR into a client cert. Idempotent: a re-poll after issuance returns the
   * already-issued cert.
   */
  async poll (req: EnrollmentRequest): Promise<EnrollmentResult> {
    const node = await this.prisma.node.findFirst({
      where: { name: req.name },
      select: { id: true, name: true, status: true, fingerprint: true, certPem: true }
    })
    if (!node) {
      throw new Error(`no enrollment for node: ${req.name}`)
    }
    if (node.status === 'rejected') {
      throw new Error(`enrollment for ${req.name} was rejected`)
    }

    // Already issued → idempotent return (a node that lost the response re-polls).
    if (node.certPem) {
      return { status: 'issued', certPem: node.certPem, caCertPem: this.ca.getCaCertPem(), fingerprint: node.fingerprint ?? '' }
    }

    if (node.status !== 'approved') {
      // still pending (or any non-terminal, non-approved state)
      return { status: 'pending', nodeId: node.id, sasCode: '', joinNonce: '', caCertPem: this.ca.getCaCertPem() }
    }

    // Approved + not yet issued: bind to the enrolled key, then sign.
    const pubKeyFp = ClusterCA.csrPublicKeyFingerprint(req.csrPem)
    if (pubKeyFp !== node.fingerprint) {
      throw new Error('CSR public key does not match the enrolled key for this node')
    }
    const issued = this.ca.signNodeCsr(req.csrPem, node.name)
    await this.prisma.node.update({
      where: { id: node.id },
      data: {
        certPem: issued.certPem,
        fingerprint: issued.fingerprint, // now the CERT fingerprint (the TOFU pin)
        joinNonce: null,
        joinCodeHash: null
      }
    })
    logger.info(`📜 Issued client certificate to node '${node.name}' (fingerprint ${issued.fingerprint.slice(0, 16)}…)`)
    return { status: 'issued', certPem: issued.certPem, caCertPem: this.ca.getCaCertPem(), fingerprint: issued.fingerprint }
  }
}
