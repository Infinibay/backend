/// <reference types="node" />
/**
 * Infinibay Node Agent — join (enrollment) client (multi-node Phase 2).
 *
 * One-shot onboarding: this generates the node's keypair, requests enrollment,
 * prints the 6-digit SAS pairing code for the operator to COMPARE against the
 * master UI, then polls until an admin approves and the master signs the node's
 * client certificate. The cert + CA are written to disk; the agent then uses them
 * for mTLS (Phase 2.1d) instead of the shared bootstrap token.
 *
 * Run:  npm run agent:join
 *
 * Config (env):
 *   MASTER_URL                base URL of the master backend
 *   INFINIBAY_NODE_NAME       this node's name (defaults to hostname)
 *   INFINIBAY_CLUSTER_TOKEN   shared bootstrap bearer token (install-time secret)
 *   INFINIBAY_CERT_DIR        where to store node-key.pem / node-cert.pem / cluster-ca.pem
 *   JOIN_POLL_INTERVAL_MS     default 5000
 */
import os from 'os'
import fs from 'fs'
import path from 'path'
import {
  generateNodeKeyAndCsr,
  computeSas,
  csrPublicKeyFingerprint,
  certFingerprint
} from '../app/services/node/clusterCrypto'
import { buildUnderlayReport, type UnderlayReport } from '../app/services/node/overlayIdentity'

const MASTER_URL = (process.env.MASTER_URL || 'http://localhost:4000').replace(/\/+$/, '')
const NAME = process.env.INFINIBAY_NODE_NAME || os.hostname()
const TOKEN = process.env.INFINIBAY_CLUSTER_TOKEN || ''
const CERT_DIR = process.env.INFINIBAY_CERT_DIR || '/opt/infinibay/certs'
const POLL_INTERVAL_MS = parseInt(process.env.JOIN_POLL_INTERVAL_MS || '5000', 10)

const KEY_PATH = path.join(CERT_DIR, 'node-key.pem')
const CERT_PATH = path.join(CERT_DIR, 'node-cert.pem')
const CA_PATH = path.join(CERT_DIR, 'cluster-ca.pem')
const STATE_PATH = path.join(CERT_DIR, 'join-state.json')

interface JoinState { csrPem: string, joinNonce: string, caCertPem: string }

function authHeaders (): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }
}

function printSas (csrPem: string, st: JoinState): void {
  const sas = computeSas(csrPublicKeyFingerprint(csrPem), st.joinNonce, certFingerprint(st.caCertPem))
  const pretty = `${sas.slice(0, 3)} ${sas.slice(3)}`
  console.log('')
  console.log('  ┌─────────────────────────────────────────────┐')
  console.log('  │  PAIRING CODE                               │')
  console.log(`  │      ${pretty}                                 │`)
  console.log('  │                                             │')
  console.log('  │  Confirm this matches the code shown for     │')
  console.log(`  │  node '${NAME}' in the Infinibay master UI,   │`)
  console.log('  │  then APPROVE it there.                      │')
  console.log('  └─────────────────────────────────────────────┘')
  console.log('')
}

/** node → master: request enrollment, persist the join state, show the SAS. */
async function requestEnrollment (csrPem: string, underlay?: UnderlayReport): Promise<JoinState> {
  const res = await fetch(`${MASTER_URL}/cluster/enroll`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: NAME, csrPem, underlay })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`enroll rejected (${res.status}): ${text}`)
  }
  const body = (await res.json()) as { joinNonce?: string, caCertPem?: string }
  if (!body.joinNonce || !body.caCertPem) {
    throw new Error('enroll response missing joinNonce/caCertPem')
  }

  // SECURITY — out-of-band CA pinning (defeats a fake-CA MITM independent of the
  // 6-digit SAS). The SAS alone is tamper-EVIDENCE, not tamper-PROOF: an active
  // on-path attacker can substitute its own CA and grind the (short) pairing code
  // to match. If the operator pins the real CA's fingerprint out-of-band
  // (INFINIBAY_EXPECTED_CA_FP), we verify the received CA against it and abort on
  // mismatch — so the attacker's CA is rejected here, before it is ever trusted.
  const caFp = certFingerprint(body.caCertPem)
  const expectedCaFp = (process.env.INFINIBAY_EXPECTED_CA_FP || '').toLowerCase().replace(/[^0-9a-f]/g, '')
  if (expectedCaFp.length > 0 && caFp !== expectedCaFp) {
    throw new Error(
      `cluster CA fingerprint mismatch — refusing to trust this master.\n` +
      `  expected (pinned): ${expectedCaFp}\n  received:          ${caFp}\n` +
      `  The connection may be intercepted. Do NOT approve the pairing code.`
    )
  }
  console.log(`[join] cluster CA fingerprint: ${caFp}`)
  if (expectedCaFp.length === 0) {
    console.log('[join] (tip: set INFINIBAY_EXPECTED_CA_FP to this value, obtained out-of-band from the master, for tamper-PROOF onboarding)')
  }

  const state: JoinState = { csrPem, joinNonce: body.joinNonce, caCertPem: body.caCertPem }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state), { mode: 0o600 })
  fs.writeFileSync(CA_PATH, body.caCertPem, { mode: 0o644 })
  return state
}

/** node → master: poll once. Returns the cert PEM when issued, null while pending. */
async function pollOnce (csrPem: string): Promise<string | null> {
  const res = await fetch(`${MASTER_URL}/cluster/enroll/poll`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: NAME, csrPem })
  })
  if (res.status === 409) {
    const text = await res.text().catch(() => '')
    throw new Error(`enrollment cannot proceed (409): ${text}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`poll failed (${res.status}): ${text}`)
  }
  const body = (await res.json()) as { status?: string, certPem?: string, caCertPem?: string }
  if (body.status === 'issued' && body.certPem) {
    fs.writeFileSync(CERT_PATH, body.certPem, { mode: 0o644 })
    if (body.caCertPem) fs.writeFileSync(CA_PATH, body.caCertPem, { mode: 0o644 })
    return body.certPem
  }
  return null
}

function pollUntilIssued (csrPem: string): void {
  const tick = (): void => {
    pollOnce(csrPem)
      .then((certPem) => {
        if (certPem) {
          const fp = certFingerprint(certPem)
          console.log(`✅ Approved. Client certificate written to ${CERT_PATH}`)
          console.log(`   fingerprint ${fp}`)
          console.log('   The node can now connect over mTLS. You may start the agent.')
          process.exit(0)
        } else {
          console.log('… awaiting approval (compare + approve the pairing code in the master UI)')
          setTimeout(tick, POLL_INTERVAL_MS)
        }
      })
      .catch((err) => {
        console.error(`[join] ${String(err)}`)
        process.exit(1)
      })
  }
  tick()
}

async function main (): Promise<void> {
  if (TOKEN.length === 0) {
    console.error('[join] FATAL: INFINIBAY_CLUSTER_TOKEN is required')
    process.exit(1)
  }
  if (fs.existsSync(CERT_PATH)) {
    console.log(`[join] already enrolled (${CERT_PATH} exists) — nothing to do`)
    process.exit(0)
  }
  fs.mkdirSync(CERT_DIR, { recursive: true, mode: 0o700 })

  console.log(`[join] node='${NAME}' master=${MASTER_URL}`)
  // SECURITY (#8) — the bootstrap token is sent in the enroll REQUEST. Over plain
  // HTTP it (and the whole exchange) is exposed to any passive eavesdropper on the
  // path. Warn loudly when enrolling cross-host over http:// so the operator either
  // uses a trusted link or pins the CA fingerprint (INFINIBAY_EXPECTED_CA_FP).
  if (/^http:\/\//i.test(MASTER_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(MASTER_URL)) {
    console.warn('[join] WARNING: enrolling over CLEARTEXT http:// — the bootstrap token is exposed to network eavesdroppers.')
    console.warn('[join]          Use a trusted network for onboarding and set INFINIBAY_EXPECTED_CA_FP for tamper-proof verification.')
  }

  // Resume an in-progress join (same key → same pubkey binding), else start fresh.
  let csrPem: string
  let state: JoinState | null = null
  if (fs.existsSync(KEY_PATH) && fs.existsSync(STATE_PATH)) {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as JoinState
    csrPem = state.csrPem
    console.log('[join] resuming in-progress enrollment')
    // Resume by polling first; if the master has no record, re-enroll below.
    try {
      const cert = await pollOnce(csrPem)
      if (cert) { console.log(`✅ Already approved. Cert at ${CERT_PATH}`); process.exit(0) }
      printSas(csrPem, state)
      pollUntilIssued(csrPem)
      return
    } catch {
      console.log('[join] prior enrollment not found on master — re-enrolling')
    }
  }

  const { privateKeyPem, csrPem: freshCsr } = generateNodeKeyAndCsr(NAME)
  csrPem = freshCsr
  fs.writeFileSync(KEY_PATH, privateKeyPem, { mode: 0o600 })

  // Generate this node's WireGuard/VTEP identity and report it with enrollment so
  // the master can add it to its department overlay meshes (07-networking.md §1).
  // The private key stays on disk (0600); only the public key + endpoint are sent.
  const underlay = buildUnderlayReport() ?? undefined
  if (underlay) {
    console.log(`[join] overlay identity: vtep=${underlay.vtepIp} wgEndpoint=${underlay.wgEndpoint}`)
  } else {
    console.log('[join] no usable NIC for overlay VTEP — joining without overlay identity')
  }

  state = await requestEnrollment(csrPem, underlay)
  printSas(csrPem, state)
  pollUntilIssued(csrPem)
}

void main()
