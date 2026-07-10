/**
 * Overlay crypto + underlay-report validation unit tests. Pure (no IO), so they pin
 * the security-critical WireGuard keygen and the input validation that guards the
 * overlay peer plumbing.
 */
import { createPrivateKey, createPublicKey } from 'crypto'
import { generateWireguardKeypair } from '@services/node/clusterCrypto'
import { isValidUnderlayReport } from '@services/node/NodeEnrollmentService'

describe('generateWireguardKeypair', () => {
  it('produces raw 32-byte (base64) X25519 keys, distinct per call', () => {
    const a = generateWireguardKeypair()
    const b = generateWireguardKeypair()
    for (const k of [a.privateKeyBase64, a.publicKeyBase64]) {
      expect(Buffer.from(k, 'base64')).toHaveLength(32)
      expect(k).toHaveLength(44) // 32 bytes base64
    }
    expect(a.privateKeyBase64).not.toEqual(a.publicKeyBase64)
    expect(a.privateKeyBase64).not.toEqual(b.privateKeyBase64) // fresh randomness
  })

  it('the public key genuinely corresponds to the private key (wg pubkey round-trip)', () => {
    const { privateKeyBase64, publicKeyBase64 } = generateWireguardKeypair()
    // Rebuild a KeyObject from the raw private scalar and derive its public point;
    // it MUST equal the reported public key (else `wg` would reject the pair).
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(privateKeyBase64, 'base64')])
    const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
    const derivedPub = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32)
    expect(derivedPub.equals(Buffer.from(publicKeyBase64, 'base64'))).toBe(true)
  })
})

describe('isValidUnderlayReport', () => {
  const ok = { vtepIp: '10.77.0.3', mgmtIp: '10.0.0.3', wgPubKey: 'PUBKEY=', wgEndpoint: '192.168.1.4:51820' }

  it('accepts a well-formed report', () => {
    expect(isValidUnderlayReport(ok)).toBe(true)
    expect(isValidUnderlayReport({ ...ok, mgmtIp: null })).toBe(true)
  })

  it('rejects a non-IPv4 vtepIp (would fail-close every co-hosted VM start)', () => {
    expect(isValidUnderlayReport({ ...ok, vtepIp: 'not-an-ip' })).toBe(false)
    expect(isValidUnderlayReport({ ...ok, vtepIp: '10.77.0.999' })).toBe(false)
  })

  it('rejects a bad wgEndpoint (missing/invalid host:port)', () => {
    expect(isValidUnderlayReport({ ...ok, wgEndpoint: 'nohost' })).toBe(false)
    expect(isValidUnderlayReport({ ...ok, wgEndpoint: '192.168.1.4:0' })).toBe(false)
    expect(isValidUnderlayReport({ ...ok, wgEndpoint: '192.168.1.4:70000' })).toBe(false)
  })

  it('rejects a whitespace-bearing wgPubKey and an undefined report', () => {
    expect(isValidUnderlayReport({ ...ok, wgPubKey: 'has space' })).toBe(false)
    expect(isValidUnderlayReport(undefined)).toBe(false)
  })
})
