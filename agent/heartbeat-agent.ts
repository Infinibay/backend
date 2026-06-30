/// <reference types="node" />
/**
 * Infinibay Node Agent (multi-node Phase 1).
 *
 * Runs on every compute host (one container per node in
 * docker-compose.cluster.yml). Two responsibilities:
 *
 *   1. HEARTBEAT — register this node with the master and keep it 'online' by
 *      POSTing a heartbeat on an interval. Proves the topology end-to-end ("the
 *      master sees N nodes online").
 *
 *   2. VERB SERVER — host an infinization instance (its DB calls proxied to the
 *      master via RpcDatabaseAdapter, so the node holds NO Prisma connection) and
 *      serve VM lifecycle verbs at POST /agent/vm. The master's RemoteNodeExecutor
 *      forwards createVM/startVM/stopVM/... here; this agent runs them against
 *      LOCAL qemu. Infinization is constructed LAZILY on the first verb, so a node
 *      with no KVM can still heartbeat.
 *
 * Pre-mTLS: both directions authenticate with the shared INFINIBAY_CLUSTER_TOKEN.
 * Phase 2 replaces it with per-node mTLS + the SAS onboarding flow.
 *
 * Config (env):
 *   MASTER_URL                base URL of the master backend (e.g. http://backend:4000)
 *   INFINIBAY_NODE_NAME       this node's name (defaults to hostname)
 *   INFINIBAY_NODE_ROLE       'compute' (default)
 *   INFINIBAY_CLUSTER_TOKEN   shared bootstrap bearer token (must match the master)
 *   INFINIBAY_AGENT_PORT      verb-server listen port (default 9443, matches Node.agentPort)
 *   NODE_ADDRESS              reachable management address to advertise (optional)
 *   HEARTBEAT_INTERVAL_MS     default 15000
 *   AGENT_VERSION             reported build (optional)
 *   INFINIZATION_DISK_DIR / _SOCKET_DIR / _PID_DIR   infinization storage paths
 */
import os from 'os'
import fs from 'fs'
import path from 'path'
import https from 'node:https'
import express from 'express'
import { Infinization } from '@infinibay/infinization'
import { RpcDatabaseAdapter, HttpDbRpcTransport } from '../app/services/node/RpcDatabaseAdapter'
import { createAgentVerbRouter } from '../app/services/node/AgentVerbServer'
import { createAgentDiskRouter, LocalDiskStore } from '../app/services/node/AgentDiskServer'
import { type NodeExecutor } from '../app/services/node/NodeExecutor'
import { loadClusterIdentity, httpsJsonPost, clusterServerOptions, type ClusterIdentity } from '../app/services/node/clusterMtls'
import { generateNodeKeyAndCsr, certFingerprint, certExpiresWithinDays } from '../app/services/node/clusterCrypto'

const MASTER_URL = (process.env.MASTER_URL || 'http://localhost:4000').replace(/\/+$/, '')
const NAME = process.env.INFINIBAY_NODE_NAME || os.hostname()
const ROLE = (process.env.INFINIBAY_NODE_ROLE || 'compute').toLowerCase()
const TOKEN = process.env.INFINIBAY_CLUSTER_TOKEN || ''
const ADDRESS = process.env.NODE_ADDRESS || null
const AGENT_PORT = parseInt(process.env.INFINIBAY_AGENT_PORT || '9443', 10)
const INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '15000', 10)
const VERSION = process.env.AGENT_VERSION || '0.0.0-skeleton'

const DISK_DIR = process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks'
const SOCKET_DIR = process.env.INFINIZATION_SOCKET_DIR || '/opt/infinibay/sockets'
const PID_DIR = process.env.INFINIZATION_PID_DIR || '/opt/infinibay/pids'

// mTLS (Phase 2.1d): if this node has been enrolled (join.ts wrote its key/cert/CA
// into INFINIBAY_CERT_DIR), present that client certificate on the ops channel and
// run the verb server over HTTPS — the shared token is no longer used for ops. The
// master's cluster server is a SEPARATE HTTPS endpoint (MASTER_CLUSTER_URL).
const CERT_DIR = process.env.INFINIBAY_CERT_DIR || '/opt/infinibay/certs'
const KEY_PATH = path.join(CERT_DIR, 'node-key.pem')
const CERT_PATH = path.join(CERT_DIR, 'node-cert.pem')
const CA_PATH = path.join(CERT_DIR, 'cluster-ca.pem')
const MASTER_CLUSTER_URL = (process.env.MASTER_CLUSTER_URL || MASTER_URL).replace(/\/+$/, '')
// The master's certificate CN — pinned on BOTH directions (the agent verifies the
// master's server cert on agent→master calls, and only the master's CN may call
// the verb server). Required under mTLS; the agent fails closed if it is unset.
const MASTER_CN = process.env.INFINIBAY_MASTER_CN || undefined
// Mutable so a renewed (rotated) certificate can be hot-swapped in-process without
// a restart (Phase 2.1e). Read via currentIdentity() everywhere it is used.
let identity: ClusterIdentity | null = loadClusterIdentity(CERT_DIR)
function currentIdentity (): ClusterIdentity { return identity! }
// mTLS is REQUESTED when INFINIBAY_CLUSTER_MTLS=1 (hard requirement) and ACTIVE
// when the client certs are present and it is not explicitly disabled.
const MTLS_REQUIRED = process.env.INFINIBAY_CLUSTER_MTLS === '1'
const MTLS = identity !== null && process.env.INFINIBAY_CLUSTER_MTLS !== '0'
// Renew the node's own cert this many days before it lapses; check on this interval.
const CERT_RENEW_BEFORE_DAYS = 30
const CERT_RENEW_CHECK_MS = 12 * 60 * 60 * 1000 // 12h

// ---------------------------------------------------------------------------
// Verb target: a lazily-constructed infinization instance whose DB access is
// proxied to the master. Built on first verb so heartbeat-only nodes never need
// root/KVM.
// ---------------------------------------------------------------------------
let target: NodeExecutor | null = null
let initPromise: Promise<NodeExecutor> | null = null

async function buildTarget (): Promise<NodeExecutor> {
  console.log('[agent] constructing infinization (DB proxied to master via RPC)...')
  for (const dir of [DISK_DIR, SOCKET_DIR, PID_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
  }
  const databaseAdapter = new RpcDatabaseAdapter(
    new HttpDbRpcTransport(
      MTLS
        // Pass the identity as a GETTER so a renewed cert is used on the next call.
        ? { masterUrl: MASTER_CLUSTER_URL, nodeName: NAME, identity: currentIdentity, masterCn: MASTER_CN! }
        : { masterUrl: MASTER_URL, nodeName: NAME, token: TOKEN }
    )
  )
  const inf = new Infinization({
    databaseAdapter,
    diskDir: DISK_DIR,
    qmpSocketDir: SOCKET_DIR,
    pidfileDir: PID_DIR
  })
  await inf.initialize()
  console.log('[agent] infinization ready — serving VM verbs')
  // Infinization structurally satisfies NodeExecutor (the interface is derived
  // from it), so this widening is sound.
  return inf as unknown as NodeExecutor
}

async function getTarget (): Promise<NodeExecutor> {
  if (target) return target
  if (!initPromise) initPromise = buildTarget()
  try {
    target = await initPromise
    return target
  } catch (error) {
    // Do NOT memoize a rejected init: a transient failure (storage dir not yet
    // mounted, nftables modules not loaded at container-start) must not brick the
    // verb server forever. Clear it so the next verb retries construction.
    initPromise = null
    throw error
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------
function collectHardware (): {
  currentRaid: string
  cpuFlags: { raw: string, values: string[] }
  ram: number
  cores: number
} {
  const cpus = os.cpus()
  const model = cpus[0]?.model ?? ''
  return {
    currentRaid: 'single',
    cpuFlags: { raw: model, values: model ? model.split(/\s+/).filter(Boolean) : [] },
    ram: Math.round(os.totalmem() / 1024 / 1024),
    cores: cpus.length || 1
  }
}

async function sendHeartbeat (): Promise<void> {
  const body = {
    name: NAME,
    role: ROLE,
    address: ADDRESS,
    agentVersion: VERSION,
    hardware: collectHardware()
  }
  try {
    let status: number
    let text: string
    if (MTLS) {
      const r = await httpsJsonPost(`${MASTER_CLUSTER_URL}/cluster/heartbeat`, body, currentIdentity(), { expectedCn: MASTER_CN! })
      status = r.status
      text = r.text
    } else {
      const res = await fetch(`${MASTER_URL}/cluster/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body)
      })
      status = res.status
      text = await res.text().catch(() => '')
    }
    if (status < 200 || status >= 300) {
      console.error(`[agent] heartbeat rejected (${status}): ${text}`)
      return
    }
    let json: { nodeId?: string, created?: boolean } = {}
    try { json = JSON.parse(text) } catch { /* tolerate a non-JSON 2xx */ }
    console.log(`[agent] heartbeat ok name=${NAME} nodeId=${json.nodeId ?? '?'}${json.created ? ' (registered)' : ''}`)
  } catch (error) {
    console.error(`[agent] heartbeat error: ${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Verb HTTP server
// ---------------------------------------------------------------------------
// Kept so cert renewal can hot-swap the TLS context (Phase 2.1e).
let verbHttpsServer: https.Server | null = null

function startVerbServer (): void {
  const app = express()
  app.get('/agent/health', (_req: express.Request, res: express.Response) => {
    res.json({ ok: true, node: NAME, role: ROLE, mtls: MTLS, infinizationReady: target !== null })
  })
  // POST /agent/vm — the master's RemoteNodeExecutor calls this. Under mTLS the
  // verb server runs over HTTPS and requires the master's verified client cert
  // (optionally pinned to MASTER_CN); otherwise plain HTTP + shared token.
  const onListenError = (err: unknown): void => {
    console.error(`[agent] FATAL: verb server failed to listen on :${AGENT_PORT}: ${String(err)}`)
    process.exit(1)
  }
  if (MTLS) {
    // Only the master's CN may call verbs (mandatory pin — guaranteed set by main()).
    app.use('/agent', createAgentVerbRouter({ getTarget, auth: 'mtls', masterCn: MASTER_CN }))
    // Cold-migration disk transfer (pull/push/stat/delete), confined to DISK_DIR and
    // restricted to the master's verified client cert (Phase 3).
    app.use('/agent', createAgentDiskRouter({ store: new LocalDiskStore(DISK_DIR), auth: 'mtls', masterCn: MASTER_CN }))
    const server = https.createServer(clusterServerOptions(currentIdentity(), { rejectUnauthorized: true }), app)
    server.on('error', onListenError)
    server.listen(AGENT_PORT, () => {
      console.log(`[agent] verb server listening on :${AGENT_PORT} (HTTPS mTLS, master CN '${MASTER_CN}', POST /agent/vm)`)
    })
    verbHttpsServer = server
  } else {
    app.use('/agent', createAgentVerbRouter({ getTarget }))
    const server = app.listen(AGENT_PORT, () => {
      console.log(`[agent] verb server listening on :${AGENT_PORT} (POST /agent/vm)`)
    })
    server.on('error', onListenError)
  }
}

// ---------------------------------------------------------------------------
// Certificate renewal (Phase 2.1e) — rotate this node's leaf before it expires,
// over the mTLS channel (the current cert is the auth; no re-approval), and
// hot-swap it in-process so a long-running agent never lapses.
// ---------------------------------------------------------------------------
async function maybeRenewCert (): Promise<void> {
  if (!MTLS) return
  const id = identity
  if (!id || !certExpiresWithinDays(id.cert, CERT_RENEW_BEFORE_DAYS)) return

  console.log('[agent] client certificate is near expiry — renewing…')
  const { privateKeyPem, csrPem } = generateNodeKeyAndCsr(NAME)
  const r = await httpsJsonPost(`${MASTER_CLUSTER_URL}/cluster/renew`, { csrPem }, id, { expectedCn: MASTER_CN! })
  if (r.status < 200 || r.status >= 300) {
    console.error(`[agent] cert renewal rejected (${r.status}): ${r.text}`)
    return
  }
  const body = JSON.parse(r.text) as { certPem?: string, caCertPem?: string }
  if (!body.certPem) {
    console.error('[agent] cert renewal response missing certPem')
    return
  }
  // Persist (key 0600), then hot-swap the in-process identity + the verb server's
  // TLS context. New agent→master calls use the getter, so they pick it up too.
  fs.writeFileSync(KEY_PATH, privateKeyPem, { mode: 0o600 })
  fs.writeFileSync(CERT_PATH, body.certPem, { mode: 0o644 })
  if (body.caCertPem) fs.writeFileSync(CA_PATH, body.caCertPem, { mode: 0o644 })
  identity = { key: privateKeyPem, cert: body.certPem, ca: body.caCertPem ?? id.ca }
  if (verbHttpsServer) {
    verbHttpsServer.setSecureContext(clusterServerOptions(identity, { rejectUnauthorized: true }))
  }
  console.log(`[agent] certificate renewed (fingerprint ${certFingerprint(body.certPem).slice(0, 16)}…)`)
}

function main (): void {
  // Fail closed when mTLS is MANDATED but the materials to do it securely are absent —
  // never silently downgrade to the cleartext token channel against operator intent.
  if (MTLS_REQUIRED && identity === null) {
    console.error('[agent] FATAL: INFINIBAY_CLUSTER_MTLS=1 but no client certificate in INFINIBAY_CERT_DIR')
    console.error('[agent]        run `npm run agent:join` to enroll this node, then restart')
    process.exit(1)
  }
  if (MTLS && !MASTER_CN) {
    console.error('[agent] FATAL: mTLS is active but INFINIBAY_MASTER_CN is unset')
    console.error('[agent]        set INFINIBAY_MASTER_CN to the master node name so the master can be pinned')
    console.error('[agent]        (and only the master can call this node\'s verb server)')
    process.exit(1)
  }
  if (MTLS) {
    console.log(`[agent] mTLS enabled (client cert from ${CERT_DIR}); master cluster endpoint ${MASTER_CLUSTER_URL}, master CN '${MASTER_CN}'`)
  } else if (TOKEN.length === 0) {
    console.error('[agent] FATAL: no client certificate in INFINIBAY_CERT_DIR and INFINIBAY_CLUSTER_TOKEN is unset')
    console.error('[agent]        run `npm run agent:join` to enroll, or set INFINIBAY_CLUSTER_TOKEN for the pre-mTLS path')
    process.exit(1)
  }
  console.log(`[agent] starting: name=${NAME} role=${ROLE} master=${MASTER_URL} port=${AGENT_PORT} interval=${INTERVAL_MS}ms mtls=${MTLS}`)
  startVerbServer()
  void sendHeartbeat()
  const timer = setInterval(() => { void sendHeartbeat() }, INTERVAL_MS)

  // Proactively rotate this node's certificate before it lapses (mTLS only).
  let renewTimer: NodeJS.Timeout | null = null
  if (MTLS) {
    const renew = (): void => { maybeRenewCert().catch((e) => console.error(`[agent] cert renewal error: ${String(e)}`)) }
    renew()
    renewTimer = setInterval(renew, CERT_RENEW_CHECK_MS)
    if (typeof renewTimer.unref === 'function') renewTimer.unref()
  }

  const shutdown = (): void => {
    clearInterval(timer)
    if (renewTimer) clearInterval(renewTimer)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
