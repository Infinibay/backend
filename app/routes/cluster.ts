import express, { Request, RequestHandler, Response } from 'express'
import { PrismaAdapter, isPrismaAdapterError, type InfinizationConfig } from '@infinibay/infinization'
import logger from '@main/logger'
import prisma from '../utils/database'
import { NodeHeartbeatService } from '../services/node/NodeHeartbeatService'
import { DB_FACADE_METHODS } from '../services/node/RpcDatabaseAdapter'
import { requireClusterToken } from '../services/node/clusterAuth'
import { requireClientCert, peerCertFingerprint, type ClusterAuthedRequest } from '../services/node/clusterMtls'
import { certFingerprint } from '../services/node/clusterCrypto'
import { ClusterCA } from '../services/node/ClusterCA'
import type { TLSSocket } from 'node:tls'
import { NodeEnrollmentService } from '../services/node/NodeEnrollmentService'
import { PrismaClient } from '@prisma/client'
import { isValidMachineStatus } from '../constants/machine-status'

const service = new NodeHeartbeatService(prisma as unknown as PrismaClient)

// A joining node's `name` becomes the issued certificate CN, the persisted
// Node.name, the mTLS identity later compared by the CN pin, AND an enrollment log
// line. Constrain it to a DNS-style label (1-63 chars, no control chars / CRLF /
// whitespace) so it can't be an oversized/degenerate CN or a log-forging string.
// (X.509 CN is capped at 64 chars; a DNS label at 63.)
function isValidNodeLabel (name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(name)
}

/**
 * Auth mode for the cluster router:
 *   - 'token' — the pre-mTLS path: a shared bootstrap bearer token, `nodeName`
 *     self-asserted in the body. Mounted on the main HTTP server (port 4000).
 *   - 'mtls'  — the production path: a per-node client certificate, the node
 *     identity DERIVED from the verified cert CN (the body's nodeName is ignored,
 *     closing the spoofing gap). Mounted on the dedicated cluster HTTPS server.
 * Enrollment routes are token-gated in BOTH modes (a joining node has no cert).
 */
export type ClusterRouterMode = 'token' | 'mtls'

// Lazy so INFINIBAY_CLUSTER_CA_DIR is read at first request (after env is set),
// and so the CA is generated only on a host that actually onboards nodes.
let _enrollment: NodeEnrollmentService | null = null
function enrollment (): NodeEnrollmentService {
  if (!_enrollment) {
    _enrollment = new NodeEnrollmentService(prisma as unknown as PrismaClient, new ClusterCA())
  }
  return _enrollment
}

// Allowlist of DB-facade methods a node may invoke over /cluster/db. Anything
// else is rejected — the wire surface is exactly the 16 methods infinization
// needs, nothing more (no arbitrary Prisma access).
const DB_METHOD_ALLOWLIST = new Set<string>(DB_FACADE_METHODS as readonly string[])

// Facade methods whose FIRST argument is a Machine.id (the VM the call targets).
// These are gated by a node-ownership check below: the caller may only touch a
// machine assigned to ITS OWN node. Everything not listed here is either an
// enumeration read already node-scoped inside PrismaAdapter (findRunningVMs,
// findMachinesByStatuses, findMachineByInternalName) and therefore needs no
// arg-level gate.
const MACHINE_ID_KEYED_METHODS = new Set<string>([
  'findMachine',
  'findMachineWithConfig',
  'updateMachineStatus',
  'updateMachineConfiguration',
  'transitionVMStatus',
  'clearMachineConfiguration',
  'clearVolatileMachineConfiguration',
  'getMachineInternalName',
  'getMachineDiskPath',
  'getFirewallRules',
  'getFirewallRulesSplit',
  'getDepartmentFirewallPolicy',
  'getFirewallRuleSetId'
])

// Methods whose SECOND argument (callArgs[1]) is the target machine status. A
// compromised node could otherwise persist an arbitrary status on its own VMs
// (e.g. a 200 KB blob or a bogus literal like 'running_fake'); the master's
// reconcilers only ever match KNOWN statuses, so such a row becomes invisible to
// crash/orphan cleanup and reconcile and can never be started again — a stuck,
// unmanageable VM. Validate the status against the canonical machine-status set.
const STATUS_WRITE_METHODS = new Set<string>([
  'updateMachineStatus',
  'transitionVMStatus'
])

/**
 * Build the cluster router for the given auth mode. `mode: 'token'` is the
 * default-exported router mounted on the main HTTP server; `mode: 'mtls'` is
 * mounted on the dedicated cluster HTTPS server (clusterMtlsServer.ts).
 */
export function createClusterRouter (opts: { mode?: ClusterRouterMode } = {}): express.Router {
  const mode: ClusterRouterMode = opts.mode ?? 'token'
  const router = express.Router()

  // Ops routes (heartbeat / db) authenticate by client cert under mTLS, else by
  // the shared bootstrap token. Under mTLS the caller's node identity is the
  // verified cert CN (req.clusterNodeName), NOT a self-asserted body field.
  // In token mode, when mTLS is enabled cluster-wide the token ops path is RETIRED
  // (421) so there is no spoofable downgrade route — nodes must use the mTLS
  // endpoint, where identity is their cert CN. Enrollment stays reachable (below).
  // Under mTLS, after the cert is verified, ALSO enforce that the node is still an
  // ACTIVE cluster member and is presenting its CURRENT certificate. Without this,
  // a 365-day client cert keeps working after the node is rejected/decommissioned
  // (there is no CRL), and a pre-rotation cert could be replayed. We gate on
  // node.status ∈ {approved, online} AND peerCertFingerprint === fp(node.certPem),
  // so reject()/decommission and cert rotation actually revoke ops access.
  const requireActiveClusterNode: RequestHandler = (req, res, next) => {
    const cn = (req as ClusterAuthedRequest).clusterNodeName
    if (typeof cn !== 'string' || cn.length === 0) {
      res.status(401).json({ error: 'a verified client certificate is required (mTLS)' })
      return
    }
    void (async () => {
      try {
        const node = await prisma.node.findFirst({ where: { name: cn }, select: { id: true, status: true, certPem: true } })
        if (!node) { res.status(403).json({ error: `node not registered: ${cn}` }); return }
        if (node.status !== 'approved' && node.status !== 'online') {
          res.status(403).json({ error: `node ${cn} is not an active cluster member (status=${node.status})` })
          return
        }
        if (!node.certPem) { res.status(403).json({ error: `node ${cn} has no issued certificate` }); return }
        const presented = peerCertFingerprint(req.socket as TLSSocket)
        if (!presented || presented !== certFingerprint(node.certPem)) {
          res.status(403).json({ error: `node ${cn} presented a stale or unrecognized certificate` })
          return
        }
        ;(req as ClusterAuthedRequest).clusterNodeId = node.id
        next()
      } catch (err) {
        logger.error('cluster ops node authorization failed', err)
        res.status(500).json({ error: 'authorization failed' })
      }
    })()
  }
  const certThenActive: RequestHandler = (req, res, next) => {
    requireClientCert()(req, res, () => requireActiveClusterNode(req, res, next))
  }
  const opsAuth: RequestHandler = mode === 'mtls'
    ? certThenActive
    : (req, res, next) => {
        if (process.env.INFINIBAY_CLUSTER_MTLS === '1') {
          res.status(421).json({ error: 'cluster ops require mTLS — use the cluster HTTPS endpoint (INFINIBAY_CLUSTER_PORT)' })
          return
        }
        requireClusterToken(req, res, next)
      }
  const verifiedCn = (req: Request): string | undefined =>
    mode === 'mtls' ? (req as ClusterAuthedRequest).clusterNodeName : undefined

  /**
   * POST /cluster/heartbeat — a node agent reports it is alive + its capacity.
   * Upserts the Node and stamps lastHeartbeat (drives online/stale in the UI).
   */
  router.post('/heartbeat', express.json({ limit: '64kb' }), opsAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {}
      // Under mTLS the node name is the verified cert CN — a node can only
      // heartbeat as ITSELF, never as another node by changing the body.
      const name = verifiedCn(req) ?? body.name
      if (typeof name !== 'string' || name.length === 0 || typeof body.hardware !== 'object' || body.hardware === null) {
        res.status(400).json({ error: 'name (string) and hardware (object) are required' })
        return
      }
      // Vet the self-reported capacity + identity BEFORE it reaches the Node row.
      // ram/cores are exactly what NodePlacementService/NodeCapacity use to rank
      // nodes, so an unbounded/negative value here would poison cluster-wide VM
      // placement (funnel every create onto this node, or silently remove it). Bound
      // them, constrain role to the known enum (also fixes a role={} → .toLowerCase()
      // 500), and stop forwarding unvetted body fields to the DB. Same house style as
      // the /db STATUS_WRITE / MACHINE_ID_KEYED guards below.
      const hw = body.hardware
      const MAX_CORES = 4096
      const MAX_RAM_MB = 64 * 1024 * 1024 // 64 TiB in MB — well above any real host
      if (!Number.isInteger(hw.cores) || hw.cores <= 0 || hw.cores > MAX_CORES ||
          !Number.isInteger(hw.ram) || hw.ram <= 0 || hw.ram > MAX_RAM_MB ||
          typeof hw.currentRaid !== 'string') {
        res.status(400).json({ error: 'hardware.cores/ram must be positive integers within bounds and currentRaid a string' })
        return
      }
      const role = body.role === undefined ? 'compute' : body.role
      if (role !== 'compute' && role !== 'master') {
        res.status(400).json({ error: 'role must be compute or master' })
        return
      }
      if (body.address != null && typeof body.address !== 'string') {
        res.status(400).json({ error: 'address must be a string' })
        return
      }
      if (body.agentVersion != null && typeof body.agentVersion !== 'string') {
        res.status(400).json({ error: 'agentVersion must be a string' })
        return
      }
      const result = await service.recordHeartbeat({
        name,
        role,
        address: body.address ?? null,
        agentVersion: body.agentVersion ?? null,
        hardware: { ram: hw.ram, cores: hw.cores, currentRaid: hw.currentRaid, cpuFlags: hw.cpuFlags ?? {} }
      })
      res.json({ ok: true, nodeId: result.nodeId, created: result.created })
    } catch (error) {
      logger.error('cluster heartbeat failed', error)
      res.status(500).json({ error: 'heartbeat failed' })
    }
  })

/**
 * POST /cluster/db — the master side of the node DB facade (Phase 1 increment 3).
 *
 * A node agent's RpcDatabaseAdapter forwards each of the 16 InfinizationDatabase
 * methods here. The master executes the method on a PrismaAdapter SCOPED TO THE
 * CALLING NODE (reusing the G0 node-scoping), so a node can only read/write its
 * own VMs. The method must be in the allowlist (no arbitrary Prisma access).
 *
 * SECURITY (pre-mTLS): with a SHARED cluster token the `nodeName` is
 * agent-asserted, so a token holder could currently claim another node's name.
 * Phase 2 replaces the token with a per-node client certificate and derives the
 * nodeId from the verified cert identity (ADR-CP5), closing this gap.
 */
  router.post('/db', express.json({ limit: '256kb' }), opsAuth, async (req: Request, res: Response) => {
    try {
      const { nodeName: bodyNodeName, method, args } = (req.body ?? {}) as { nodeName?: unknown, method?: unknown, args?: unknown }
      // Under mTLS the calling node is the verified cert CN; the body's nodeName is
      // ignored (a token holder could otherwise claim another node's name).
      const nodeName = verifiedCn(req) ?? bodyNodeName
      if (typeof nodeName !== 'string' || nodeName.length === 0) {
        res.status(400).json({ error: 'nodeName (string) is required' })
        return
      }
      if (typeof method !== 'string' || !DB_METHOD_ALLOWLIST.has(method)) {
        res.status(400).json({ error: `method not allowed: ${String(method)}` })
        return
      }
      const callArgs = Array.isArray(args) ? args : []

      const node = await prisma.node.findFirst({ where: { name: nodeName }, select: { id: true } })
      if (!node) {
        res.status(404).json({ error: `node not registered: ${nodeName}` })
        return
      }

      // Node-ownership enforcement (G0) — the authoritative trust-boundary check.
      // For a machine-id-keyed method, the first argument MUST be a non-empty
      // string AND name a machine assigned to the CALLING node. This closes three
      // holes that the PrismaAdapter's enumeration-only scoping leaves open:
      //   - mass wipe: clearMachineConfiguration([]) would otherwise hit
      //     updateMany({ where: { machineId: undefined } }) → Prisma elides the
      //     undefined filter → every VM's config nulled cluster-wide.
      //   - cross-node write: transitionVMStatus(<other node's vmId>, …) mutates a
      //     VM that lives on another host.
      //   - cross-node read: findMachineWithConfig(<other node's vmId>) discloses
      //     another VM's graphic password / disk paths / firewall rules.
      // (mTLS de-spoofs nodeName; it does NOT scope these methods, so this gate is
      // required regardless of auth mode.)
      if (MACHINE_ID_KEYED_METHODS.has(method)) {
        const vmId = callArgs[0]
        if (typeof vmId !== 'string' || vmId.length === 0) {
          res.status(400).json({ error: `method ${method} requires a machine id as the first argument` })
          return
        }
        const owned = await prisma.machine.findFirst({ where: { id: vmId, nodeId: node.id }, select: { id: true } })
        if (!owned) {
          res.status(403).json({ error: `node ${nodeName} does not own machine ${vmId}` })
          return
        }
      }

      // Reject a bogus/oversized status BEFORE it reaches the DB. Without this a
      // compromised node could strand its own VM in an unknown status invisible
      // to every reconciler. (callArgs[1] is the target status for both
      // updateMachineStatus(id, status, opts?) and
      // transitionVMStatus(id, newStatus, expectedStatus, version).)
      if (STATUS_WRITE_METHODS.has(method)) {
        const status = callArgs[1]
        if (typeof status !== 'string' || !isValidMachineStatus(status)) {
          res.status(400).json({ error: `method ${method} received an invalid machine status` })
          return
        }
      }

      // Node-scoped adapter (G0): every enumeration read is filtered to this node's
      // VMs. The cast bridges the ExtendedPrismaClient/PrismaClientLike structural
      // gap (runtime-compatible; see InfinizationService for the same cast).
      const adapter = new PrismaAdapter(
        prisma as unknown as NonNullable<InfinizationConfig['prismaClient']>,
        node.id
      )
      const fn = (adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]
      const result = await fn.apply(adapter, callArgs)
      res.json({ ok: true, result })
    } catch (error) {
      // A facade method that threw is a DOMAIN result, not an infra failure — the
      // RPC completed. Forward the TYPED PrismaAdapterError (code + message + vmId)
      // so the node's RpcDatabaseAdapter can reconstruct it and infinization's
      // `isPrismaAdapterError(e) && e.code === MACHINE_NOT_FOUND` (firewall
      // default-deny-continue) / VERSION_CONFLICT (concurrent-modification)
      // branches fire on the remote path exactly as they do single-node (F8).
      // Erasing it to a generic 500 made every typed branch take the wrong path.
      if (isPrismaAdapterError(error)) {
        res.json({
          ok: false,
          error: { name: 'PrismaAdapterError', code: error.code, message: error.message, vmId: error.vmId }
        })
        return
      }
      logger.error('cluster db rpc failed', error)
      res.status(500).json({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
    }
  })

  /**
   * POST /cluster/renew (mTLS only) — an onboarded node rotates its certificate
   * before it expires (Phase 2.1e). Authenticated by the node's CURRENT client
   * cert; identity is the verified CN, so no SAS/approval is needed. The node
   * submits a fresh CSR (new key) and gets a new cert for the same identity.
   */
  if (mode === 'mtls') {
    router.post('/renew', express.json({ limit: '64kb' }), opsAuth, async (req: Request, res: Response) => {
      try {
        const nodeName = verifiedCn(req)
        const { csrPem } = (req.body ?? {}) as { csrPem?: unknown }
        if (typeof nodeName !== 'string' || nodeName.length === 0) {
          res.status(401).json({ error: 'a verified client certificate is required' })
          return
        }
        if (typeof csrPem !== 'string' || csrPem.length === 0) {
          res.status(400).json({ error: 'csrPem (string) is required' })
          return
        }
        const result = await enrollment().renew(nodeName, csrPem)
        res.json({ status: 'issued', certPem: result.certPem, caCertPem: result.caCertPem, fingerprint: result.fingerprint })
      } catch (error) {
        res.status(409).json({ error: error instanceof Error ? error.message : 'renew failed' })
      }
    })
  }

  /**
   * POST /cluster/enroll — a new node requests to join (Phase 2 onboarding).
   *
   * Token-gated in BOTH modes (a joining node has no client cert yet). The SAS +
   * admin approval is the IDENTITY gate; the install-time token only bounds who may
   * REQUEST a join. Returns the join nonce + CA cert so the node can INDEPENDENTLY
   * compute the 6-digit SAS to show on its terminal — the master UI shows the same
   * code, and a human comparing them catches a MITM. The master-computed sasCode is
   * deliberately NOT returned (the node must compute its own, or MITM detection is
   * defeated).
   */
  router.post('/enroll', express.json({ limit: '64kb' }), requireClusterToken, async (req: Request, res: Response) => {
    try {
      const { name, csrPem } = (req.body ?? {}) as { name?: unknown, csrPem?: unknown }
      if (typeof name !== 'string' || name.length === 0 || typeof csrPem !== 'string' || csrPem.length === 0) {
        res.status(400).json({ error: 'name (string) and csrPem (string) are required' })
        return
      }
      if (!isValidNodeLabel(name)) {
        res.status(400).json({ error: 'invalid node name: must be a 1-63 char DNS-style label' })
        return
      }
      const result = await enrollment().requestEnrollment({ name, csrPem })
      res.json({ status: result.status, joinNonce: result.joinNonce, caCertPem: result.caCertPem })
    } catch (error) {
      // A bad CSR (unparseable / failed self-signature) is a client error.
      res.status(400).json({ error: error instanceof Error ? error.message : 'enrollment failed' })
    }
  })

  /**
   * POST /cluster/enroll/poll — the node polls for its certificate after approval.
   * 'pending' until an admin approves; on first poll after approval the master
   * verifies the re-presented CSR's public key matches the enrolled one and signs
   * it into a client cert. 409 for a rejected / unknown / key-mismatched poll.
   */
  router.post('/enroll/poll', express.json({ limit: '64kb' }), requireClusterToken, async (req: Request, res: Response) => {
    try {
      const { name, csrPem } = (req.body ?? {}) as { name?: unknown, csrPem?: unknown }
      if (typeof name !== 'string' || name.length === 0 || typeof csrPem !== 'string' || csrPem.length === 0) {
        res.status(400).json({ error: 'name (string) and csrPem (string) are required' })
        return
      }
      if (!isValidNodeLabel(name)) {
        res.status(400).json({ error: 'invalid node name: must be a 1-63 char DNS-style label' })
        return
      }
      const result = await enrollment().poll({ name, csrPem })
      if (result.status === 'issued') {
        res.json({ status: 'issued', certPem: result.certPem, caCertPem: result.caCertPem, fingerprint: result.fingerprint })
        return
      }
      res.json({ status: result.status })
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : 'poll failed' })
    }
  })

  return router
}

// Default: the token-mode router mounted on the main HTTP server (pre-mTLS path).
export default createClusterRouter({ mode: 'token' })
