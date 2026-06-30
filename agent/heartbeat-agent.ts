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
import https from 'node:https'
import express from 'express'
import { Infinization } from '@infinibay/infinization'
import { RpcDatabaseAdapter, HttpDbRpcTransport } from '../app/services/node/RpcDatabaseAdapter'
import { createAgentVerbRouter } from '../app/services/node/AgentVerbServer'
import { type NodeExecutor } from '../app/services/node/NodeExecutor'
import { loadClusterIdentity, httpsJsonPost, clusterServerOptions, type ClusterIdentity } from '../app/services/node/clusterMtls'

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
const MASTER_CLUSTER_URL = (process.env.MASTER_CLUSTER_URL || MASTER_URL).replace(/\/+$/, '')
// The master's certificate CN — pinned on BOTH directions (the agent verifies the
// master's server cert on agent→master calls, and only the master's CN may call
// the verb server). Required under mTLS; the agent fails closed if it is unset.
const MASTER_CN = process.env.INFINIBAY_MASTER_CN || undefined
const IDENTITY: ClusterIdentity | null = loadClusterIdentity(CERT_DIR)
// mTLS is REQUESTED when INFINIBAY_CLUSTER_MTLS=1 (hard requirement) and ACTIVE
// when the client certs are present and it is not explicitly disabled.
const MTLS_REQUIRED = process.env.INFINIBAY_CLUSTER_MTLS === '1'
const MTLS = IDENTITY !== null && process.env.INFINIBAY_CLUSTER_MTLS !== '0'

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
        ? { masterUrl: MASTER_CLUSTER_URL, nodeName: NAME, identity: IDENTITY!, masterCn: MASTER_CN! }
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
      const r = await httpsJsonPost(`${MASTER_CLUSTER_URL}/cluster/heartbeat`, body, IDENTITY!, { expectedCn: MASTER_CN! })
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
    const server = https.createServer(clusterServerOptions(IDENTITY!, { rejectUnauthorized: true }), app)
    server.on('error', onListenError)
    server.listen(AGENT_PORT, () => {
      console.log(`[agent] verb server listening on :${AGENT_PORT} (HTTPS mTLS, master CN '${MASTER_CN}', POST /agent/vm)`)
    })
  } else {
    app.use('/agent', createAgentVerbRouter({ getTarget }))
    const server = app.listen(AGENT_PORT, () => {
      console.log(`[agent] verb server listening on :${AGENT_PORT} (POST /agent/vm)`)
    })
    server.on('error', onListenError)
  }
}

function main (): void {
  // Fail closed when mTLS is MANDATED but the materials to do it securely are absent —
  // never silently downgrade to the cleartext token channel against operator intent.
  if (MTLS_REQUIRED && IDENTITY === null) {
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
  const shutdown = (): void => { clearInterval(timer); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
