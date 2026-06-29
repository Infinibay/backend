import { createHmac } from 'crypto'
import {
  deriveVmSecret,
  signForVm,
  isAgentSigningConfigured,
  ENVELOPE_VERSION
} from '../../app/services/socket-watcher/AgentMessageSigner'

describe('AgentMessageSigner', () => {
  const ORIGINAL = process.env.INFINISERVICE_HMAC_MASTER_SECRET

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INFINISERVICE_HMAC_MASTER_SECRET
    else process.env.INFINISERVICE_HMAC_MASTER_SECRET = ORIGINAL
  })

  it('is unconfigured (fail-closed) without a master secret', () => {
    delete process.env.INFINISERVICE_HMAC_MASTER_SECRET
    expect(isAgentSigningConfigured()).toBe(false)
    expect(deriveVmSecret('vm-1')).toBeNull()
    expect(signForVm('vm-1', { type: 'Metrics' })).toBeNull()
  })

  it('derives a stable, per-VM secret = HMAC(master, vmId)', () => {
    process.env.INFINISERVICE_HMAC_MASTER_SECRET = 'master-key'
    const expected = createHmac('sha256', 'master-key').update('vm-1', 'utf8').digest('hex')
    expect(deriveVmSecret('vm-1')).toBe(expected)
    // Different VMs get different secrets; a leak of one cannot forge another.
    expect(deriveVmSecret('vm-2')).not.toBe(deriveVmSecret('vm-1'))
  })

  it('produces a verifiable signed envelope', () => {
    process.env.INFINISERVICE_HMAC_MASTER_SECRET = 'master-key'
    const env = signForVm('vm-1', { type: 'Metrics' })!
    expect(env).not.toBeNull()
    expect(env.type).toBe('signed')
    expect(env.v).toBe(ENVELOPE_VERSION)

    const secret = deriveVmSecret('vm-1')!
    const expectedSig = createHmac('sha256', secret)
      .update(`${env.v}\n${env.ts}\n${env.nonce}\n${env.payload}`, 'utf8')
      .digest('hex')
    expect(env.sig).toBe(expectedSig)
    // Payload is the verbatim inner message JSON.
    expect(JSON.parse(env.payload)).toEqual({ type: 'Metrics' })
  })

  it('matches the cross-language reference vector (agrees with the Rust agent)', () => {
    // Same vector asserted in infiniservice src/auth.rs
    // cross_language_signature_matches_node_backend.
    const v = 1, ts = 1700000000000, nonce = 'fixed-nonce-123', payload = '{"type":"Metrics"}'
    const sig = createHmac('sha256', 'cross-lang-test-key')
      .update(`${v}\n${ts}\n${nonce}\n${payload}`, 'utf8')
      .digest('hex')
    expect(sig).toBe('417f2b895d7dd56461af56b07525ca476532ac795f8b92aab6c78a560686bdf5')
  })
})
