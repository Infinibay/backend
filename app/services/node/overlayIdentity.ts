/// <reference types="node" />
/**
 * Node-agent WireGuard / VTEP identity for the department L2 overlay
 * (07-networking.md §1). Shared by the enrollment client (join.ts, which reports
 * the identity to the master) and the running agent (heartbeat-agent.ts, which
 * re-reports it on each heartbeat AND hands the private-key path to infinization so
 * it can realize segments locally).
 *
 * The WireGuard PRIVATE key is generated once, written 0600, and NEVER transmitted
 * — only the public key + endpoint go to the master. Addresses default to the
 * host's primary IPv4 (single-NIC collapse: vtepIp == mgmtIp) and are overridable
 * per-plane via env for multi-NIC deployments.
 */
import os from 'os'
import fs from 'fs'
import path from 'path'
import { generateWireguardKeypair } from './clusterCrypto'

const CERT_DIR = process.env.INFINIBAY_CERT_DIR || '/opt/infinibay/certs'
export const WG_PRIVATE_KEY_PATH = path.join(CERT_DIR, 'wg-private.key')
export const WG_PUBLIC_KEY_PATH = path.join(CERT_DIR, 'wg-public.key')
export const WG_LISTEN_PORT = parseInt(process.env.INFINIBAY_WG_PORT || '51820', 10)

export interface UnderlayReport { vtepIp: string, mgmtIp?: string | null, wgPubKey: string, wgEndpoint: string }
export interface OverlaySelfIdentity { vtepIp: string, wgPrivateKeyPath: string, wgListenPort: number }

/** Virtual / bridge / container interfaces whose IP is NOT a usable underlay VTEP.
 *  Picking one of these silently partitions the overlay, so skip them and prefer a
 *  real NIC. Operators on multi-NIC hosts should set INFINIBAY_VTEP_IP explicitly. */
const VIRTUAL_IFACE_RE = /^(infiwg|infivx-|infinibr-|vnet-|lxdbr|docker|veth|virbr|br-|cni|flannel|cali|tap|tun|wg)/

/** First non-internal, non-virtual IPv4 address on this host, or null. Default
 *  underlay/mgmt IP when INFINIBAY_VTEP_IP / INFINIBAY_WG_ENDPOINT_HOST are unset. */
export function detectPrimaryIPv4 (): string | null {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue
    for (const a of ifaces[name] ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

/**
 * Ensure a WireGuard keypair exists on disk (0600 private / 0644 public) and return
 * the base64 public key. Idempotent — reuses an existing key so a node's identity
 * is stable across restarts and re-enrollments.
 */
export function ensureWireguardKeypair (): string {
  if (fs.existsSync(WG_PRIVATE_KEY_PATH) && fs.existsSync(WG_PUBLIC_KEY_PATH)) {
    return fs.readFileSync(WG_PUBLIC_KEY_PATH, 'utf8').trim()
  }
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o755 })
  const { privateKeyBase64, publicKeyBase64 } = generateWireguardKeypair()
  fs.writeFileSync(WG_PRIVATE_KEY_PATH, privateKeyBase64 + '\n', { mode: 0o600 })
  fs.writeFileSync(WG_PUBLIC_KEY_PATH, publicKeyBase64 + '\n', { mode: 0o644 })
  return publicKeyBase64
}

/**
 * Build this node's overlay endpoint report for the enroll/heartbeat body. Returns
 * null when no usable IP can be determined (a host with no non-loopback NIC — treat
 * as not overlay-capable rather than reporting a bogus 127.0.0.1 VTEP).
 *
 * Env overrides (multi-NIC / plane separation):
 *   INFINIBAY_VTEP_IP          overlay/data-plane address (default: primary IPv4)
 *   INFINIBAY_MGMT_IP          management-plane address   (default: primary IPv4)
 *   INFINIBAY_WG_ENDPOINT_HOST underlay host peers dial   (default: primary IPv4)
 *   INFINIBAY_WG_PORT          WireGuard listen port      (default: 51820)
 */
export function buildUnderlayReport (): UnderlayReport | null {
  const primary = detectPrimaryIPv4()
  const vtepIp = process.env.INFINIBAY_VTEP_IP || primary
  const endpointHost = process.env.INFINIBAY_WG_ENDPOINT_HOST || primary
  if (!vtepIp || !endpointHost) return null
  const wgPubKey = ensureWireguardKeypair()
  return {
    vtepIp,
    mgmtIp: process.env.INFINIBAY_MGMT_IP || primary,
    wgPubKey,
    wgEndpoint: `${endpointHost}:${WG_LISTEN_PORT}`
  }
}

/**
 * The overlay self-identity to pass as `InfinizationConfig.overlay` on a node that
 * hosts VMs. Returns undefined when this host has no WireGuard key (not
 * overlay-capable) — infinization then throws if asked to realize a segment.
 */
export function loadOverlaySelfIdentity (): OverlaySelfIdentity | undefined {
  if (!fs.existsSync(WG_PRIVATE_KEY_PATH)) return undefined
  const vtepIp = process.env.INFINIBAY_VTEP_IP || detectPrimaryIPv4()
  if (!vtepIp) return undefined
  return { vtepIp, wgPrivateKeyPath: WG_PRIVATE_KEY_PATH, wgListenPort: WG_LISTEN_PORT }
}
