import os from 'os'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { UserInputError, AuthenticationError } from '@utils/errors'
import { ClusterCA } from './ClusterCA'
import { computeSas } from './clusterCrypto'

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
    return computeSas(csrPublicKeyFingerprint, joinNonce, caFingerprint)
  }

  private static hashSas (sasCode: string): string {
    return createHash('sha256').update(sasCode).digest('hex')
  }

  // The node name becomes the persisted identity, the X.509 CommonName of the
  // CA-signed leaf (signNodeCsr → setSubject commonName) AND the verbatim mTLS
  // pin value compared on the ops channel (clusterMtls: cn !== node.name). It is
  // the whole authorization basis, so REJECT — never normalize — anything that
  // isn't a plain hostname-style label: normalizing would desync the persisted
  // name from the CSR-bound / self-computed identity. This bars control chars,
  // whitespace (incl. trailing), DN metacharacters (, + = " \), NUL bytes, and
  // homoglyph/over-length abuse while still allowing FQDN-style names.
  private static readonly NODE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/
  private static assertValidName (name: string): void {
    if (!NodeEnrollmentService.NODE_NAME_RE.test(name)) {
      throw new Error('invalid node name (must be 1-63 chars: letters, digits, and _.- , not leading with _.-)')
    }
  }

  /**
   * Step 1: a node requests to join. Upserts a PENDING node bound to the CSR's
   * public key and returns the SAS material the node displays on its terminal.
   */
  async requestEnrollment (req: EnrollmentRequest): Promise<Extract<EnrollmentResult, { status: 'pending' }>> {
    // Reserve the master's name: a node enrolled under it would receive a leaf whose
    // CN collides with the master's, defeating the master-CN pin on the verb channel
    // (and the upsert below would flip the master's own row to pending).
    const masterName = process.env.INFINIBAY_NODE_NAME || os.hostname()
    if (req.name === masterName) {
      throw new Error(`'${req.name}' is reserved for the master node and cannot be enrolled`)
    }
    // Validate before req.name touches the DB / SAS / eventual CN (see assertValidName).
    NodeEnrollmentService.assertValidName(req.name)

    const pubKeyFp = ClusterCA.csrPublicKeyFingerprint(req.csrPem) // also verifies the CSR self-signature
    const joinNonce = randomBytes(16).toString('hex')
    const caFingerprint = this.ca.caFingerprint()
    const sasCode = NodeEnrollmentService.computeSas(pubKeyFp, joinNonce, caFingerprint)
    const joinCodeHash = NodeEnrollmentService.hashSas(sasCode)

    // `name` is not a DB-unique column (matching NodeHeartbeatService), so we
    // manually upsert via findFirst → create/update rather than prisma.upsert.
    const existing = await this.prisma.node.findFirst({
      where: { name: req.name },
      select: { id: true, role: true, status: true, certPem: true }
    })
    let nodeId: string
    if (existing) {
      // Refuse to SILENTLY rebind a live identity: a token holder must not be able
      // to take over an already-approved / already-issued node by re-enrolling its
      // name with a fresh key. An admin must explicitly reject it first (which
      // clears its cert), after which re-enrollment is allowed.
      if (existing.role === 'master') {
        throw new Error(`'${req.name}' is the master node and cannot be enrolled`)
      }
      if (existing.status === 'approved' || existing.certPem) {
        throw new Error(`node '${req.name}' is already enrolled; an admin must reject it before it can re-enroll`)
      }
      // Pending / rejected → allow re-enrollment (new key): reset to pending.
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
    // approve() crosses the GraphQL boundary (approveNode resolver); throw the
    // machine-coded error classes so clients get BAD_USER_INPUT/UNAUTHENTICATED
    // instead of INTERNAL_SERVER_ERROR leaking raw internal state strings.
    if (!node) {
      throw new UserInputError('Node not found')
    }
    if (node.status !== 'pending') {
      throw new UserInputError(`Node ${node.name} is not pending (status=${node.status})`)
    }
    if (typedSas !== undefined) {
      // Constant-time compare of the two fixed-length SHA-256 hex digests (the
      // SAS is a pairing/out-of-band identity control): a null stored hash means
      // we cannot confirm the code, so treat it as a mismatch.
      const typedHash = Buffer.from(NodeEnrollmentService.hashSas(typedSas), 'hex')
      if (node.joinCodeHash == null ||
          !timingSafeEqual(typedHash, Buffer.from(node.joinCodeHash, 'hex'))) {
        throw new AuthenticationError('Pairing code mismatch')
      }
    }
    await this.prisma.node.update({ where: { id: nodeId }, data: { status: 'approved' } })
    logger.info(`✅ Node '${node.name}' approved for the cluster`)
  }

  /**
   * Reject a node: mark rejected and drop ALL identity material (join material AND
   * any issued cert). Clearing certPem is what lets the name be cleanly re-enrolled
   * afterwards — it is the explicit operator reset that the rebind guard in
   * requestEnrollment requires.
   */
  async reject (nodeId: string): Promise<void> {
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { status: 'rejected', joinNonce: null, joinCodeHash: null, certPem: null }
    })
  }

  /**
   * List nodes awaiting approval, each with the 6-digit pairing code the master
   * computed (recomputed from the stored pubkey fingerprint + join nonce + CA
   * fingerprint) so the admin UI can show it next to the one on the node terminal.
   */
  async listPending (): Promise<Array<{
    id: string, name: string, role: string, address: string | null, fingerprint: string | null, pairingCode: string, createdAt: Date
  }>> {
    const nodes = await this.prisma.node.findMany({
      where: { status: 'pending' },
      select: { id: true, name: true, role: true, address: true, fingerprint: true, joinNonce: true, createdAt: true }
    })
    const caFingerprint = this.ca.caFingerprint()
    return nodes.map(n => ({
      id: n.id,
      name: n.name,
      role: n.role,
      address: n.address,
      fingerprint: n.fingerprint,
      createdAt: n.createdAt,
      pairingCode: (n.fingerprint && n.joinNonce)
        ? NodeEnrollmentService.computeSas(n.fingerprint, n.joinNonce, caFingerprint)
        : ''
    }))
  }

  /**
   * Step 4: the node polls for its certificate. Returns 'pending' until approved,
   * throws on 'rejected', and on first poll after approval signs the (re-presented)
   * CSR into a client cert. Idempotent: a re-poll after issuance returns the
   * already-issued cert.
   */
  async poll (req: EnrollmentRequest): Promise<EnrollmentResult> {
    // Defensive: never let an unvalidated name reach signNodeCsr as the CN, even
    // if a row were somehow created via another path (see assertValidName).
    NodeEnrollmentService.assertValidName(req.name)
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

  /**
   * Renew an already-onboarded node's client certificate (Phase 2.1e). Unlike
   * enrollment this needs NO SAS/approval: the caller is identified by its CURRENT
   * valid mTLS client cert (the route passes the verified CN as `nodeName`), so
   * re-issuing for that same identity is safe. A fresh CSR rotates the key too.
   *
   * Only an approved, already-issued node may renew — a node that was never
   * onboarded (or was rejected) must go through enrollment, not renewal.
   */
  async renew (nodeName: string, csrPem: string): Promise<Extract<EnrollmentResult, { status: 'issued' }>> {
    // Defensive: never let an unvalidated name reach signNodeCsr as the CN, even
    // if a row were somehow created via another path (see assertValidName).
    NodeEnrollmentService.assertValidName(nodeName)
    const node = await this.prisma.node.findFirst({
      where: { name: nodeName },
      select: { id: true, name: true, status: true, certPem: true }
    })
    if (!node) {
      throw new Error(`no such node: ${nodeName}`)
    }
    if (node.status !== 'approved' || !node.certPem) {
      throw new Error(`node '${nodeName}' is not an onboarded node (status=${node.status}); cannot renew`)
    }

    // CN is the verified caller identity (nodeName), NOT the CSR's self-asserted
    // subject — only the CSR's public key is trusted.
    const issued = this.ca.signNodeCsr(csrPem, node.name)
    await this.prisma.node.update({
      where: { id: node.id },
      data: { certPem: issued.certPem, fingerprint: issued.fingerprint }
    })
    logger.info(`🔄 Renewed client certificate for node '${node.name}' (fingerprint ${issued.fingerprint.slice(0, 16)}…)`)
    return { status: 'issued', certPem: issued.certPem, caCertPem: this.ca.getCaCertPem(), fingerprint: issued.fingerprint }
  }
}
