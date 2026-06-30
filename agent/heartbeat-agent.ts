/// <reference types="node" />
/**
 * Infinibay Node Agent — heartbeat walking skeleton (multi-node Phase 1).
 *
 * The minimal viable agent: it registers a compute node with the master and
 * keeps it 'online' by POSTing a heartbeat on an interval. It runs on every
 * compute host (one container per node in docker-compose.cluster.yml). This is
 * the seed of the real Node Agent — later increments grow it to host
 * infinization (with an injected RpcDatabaseAdapter) and serve lifecycle verbs
 * over mTLS. For now it only proves the topology end-to-end: "the master sees N
 * nodes online".
 *
 * Config (env):
 *   MASTER_URL                base URL of the master backend (e.g. http://backend:4000)
 *   INFINIBAY_NODE_NAME       this node's name (defaults to hostname)
 *   INFINIBAY_NODE_ROLE       'compute' (default)
 *   INFINIBAY_CLUSTER_TOKEN   shared bootstrap bearer token (must match the master)
 *   NODE_ADDRESS              reachable management address to advertise (optional)
 *   HEARTBEAT_INTERVAL_MS     default 15000
 *   AGENT_VERSION             reported build (optional)
 */
import os from 'os'

const MASTER_URL = (process.env.MASTER_URL || 'http://localhost:4000').replace(/\/+$/, '')
const NAME = process.env.INFINIBAY_NODE_NAME || os.hostname()
const ROLE = (process.env.INFINIBAY_NODE_ROLE || 'compute').toLowerCase()
const TOKEN = process.env.INFINIBAY_CLUSTER_TOKEN || ''
const ADDRESS = process.env.NODE_ADDRESS || null
const INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '15000', 10)
const VERSION = process.env.AGENT_VERSION || '0.0.0-skeleton'

function collectHardware (): {
  currentRaid: string
  cpuFlags: { raw: string, values: string[] }
  ram: number
  cores: number
} {
  const cpus = os.cpus()
  // os.cpus() doesn't expose CPU flags portably; the real agent will read
  // /proc/cpuinfo. The skeleton reports the model string as a coarse fingerprint.
  const model = cpus[0]?.model ?? ''
  return {
    currentRaid: 'single',
    cpuFlags: { raw: model, values: model ? model.split(/\s+/).filter(Boolean) : [] },
    ram: Math.round(os.totalmem() / 1024 / 1024), // MB, matching Node.ram units
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
    const res = await fetch(`${MASTER_URL}/cluster/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`
      },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error(`[agent] heartbeat rejected (${res.status}): ${text}`)
      return
    }
    const json = (await res.json().catch(() => ({}))) as { nodeId?: string, created?: boolean }
    console.log(`[agent] heartbeat ok name=${NAME} nodeId=${json.nodeId ?? '?'}${json.created ? ' (registered)' : ''}`)
  } catch (error) {
    console.error(`[agent] heartbeat error: ${String(error)}`)
  }
}

function main (): void {
  if (TOKEN.length === 0) {
    console.error('[agent] FATAL: INFINIBAY_CLUSTER_TOKEN is required')
    process.exit(1)
  }
  console.log(`[agent] starting: name=${NAME} role=${ROLE} master=${MASTER_URL} interval=${INTERVAL_MS}ms`)
  void sendHeartbeat()
  const timer = setInterval(() => { void sendHeartbeat() }, INTERVAL_MS)
  const shutdown = (): void => { clearInterval(timer); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
