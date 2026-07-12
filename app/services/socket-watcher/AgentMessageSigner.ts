/**
 * AgentMessageSigner — HMAC-SHA256 signing of host→agent messages.
 *
 * The virtio-serial channel to the in-guest infiniservice agent is untrusted:
 * the agent now rejects (fail-closed) any inbound line that is not a valid
 * signed envelope. This module produces those envelopes.
 *
 * Key model (no per-VM secret stored in the DB):
 *   - The backend holds ONE master secret in INFINISERVICE_HMAC_MASTER_SECRET.
 *   - Each VM's secret is derived deterministically: HMAC(master, vmId) → hex.
 *   - That derived hex string is what provisioning injects into the guest as
 *     INFINISERVICE_SHARED_SECRET, and what the agent uses verbatim as its HMAC
 *     key. The master never leaves the host; a single VM's leaked secret cannot
 *     forge for any other VM.
 *
 * Wire format (must match src/auth.rs in infiniservice):
 *   envelope = {"type":"signed","v":1,"ts":<ms>,"nonce":<uuid>,
 *               "payload":<exact inner-message JSON string>,"sig":<hex>}
 *   sig = HMAC_SHA256(derivedSecret, `${v}\n${ts}\n${nonce}\n${payload}`)
 * The payload is signed verbatim (exact bytes), so there is no
 * JSON-canonicalization mismatch between Node and Rust.
 */

import { createHmac, randomUUID } from 'crypto'

/** Envelope protocol version; kept in lock-step with the agent. */
export const ENVELOPE_VERSION = 1

export interface SignedEnvelope {
  type: 'signed'
  v: number
  ts: number
  nonce: string
  payload: string
  sig: string
}

/** The host-wide master secret, or null when unconfigured. */
function masterSecret(): string | null {
  const s = process.env.INFINISERVICE_HMAC_MASTER_SECRET
  return s && s.length > 0 ? s : null
}

/** True when the backend can sign (master secret present). */
export function isAgentSigningConfigured(): boolean {
  return masterSecret() !== null
}

/**
 * Derive a VM's shared secret: HMAC(master, vmId) as a hex string.
 * Returns null when no master secret is configured.
 *
 * This is the value that must be planted in the guest as
 * INFINISERVICE_SHARED_SECRET during provisioning.
 */
export function deriveVmSecret(vmId: string): string | null {
  const master = masterSecret()
  if (!master) return null
  return createHmac('sha256', master).update(vmId, 'utf8').digest('hex')
}

/**
 * Wrap an outbound message in a signed envelope for the given VM.
 * Returns null when signing is not possible (no master secret) — callers must
 * treat that as fail-closed and NOT send an unsigned message (the agent would
 * reject it anyway).
 *
 * `offsetMs` is the VM's clock offset (guestClock − hostClock, in ms), learned
 * from the timestamps the guest stamps on every inbound message. The agent
 * rejects a signed envelope whose `ts` is outside its HMAC freshness window
 * (±5 min in src/auth.rs) — so a guest whose clock is skewed past that window
 * would drop EVERY command as stale (fail-closed) while metrics still flow,
 * surfacing only as an opaque command timeout. Stamping `ts` in the guest's
 * clock frame keeps the envelope fresh from the guest's point of view at any
 * skew, with no guest-side change and no weakening of replay protection (the
 * window is still enforced, just relative to the guest's own clock).
 */
export function signForVm(vmId: string, message: unknown, offsetMs = 0): SignedEnvelope | null {
  const secret = deriveVmSecret(vmId)
  if (!secret) return null

  const v = ENVELOPE_VERSION
  const ts = Date.now() + Math.round(offsetMs)
  const nonce = randomUUID()
  const payload = JSON.stringify(message)
  const sig = createHmac('sha256', secret)
    .update(`${v}\n${ts}\n${nonce}\n${payload}`, 'utf8')
    .digest('hex')

  return { type: 'signed', v, ts, nonce, payload, sig }
}
