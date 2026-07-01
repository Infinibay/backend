import { resolveConnectHost, hostFromHeader } from '../../../app/utils/resolveConnectHost'

describe('resolveConnectHost', () => {
  it('uses the VM node address — "the IP of the host that hosts it" (remote compute node)', () => {
    // A VM on a remote node MUST connect to that node, never to the master.
    const host = resolveConnectHost({
      configuredHost: '0.0.0.0', // bind addr, not dialable
      nodeAddress: '192.168.0.42', // the compute node's LAN IP
      envHost: '0.0.0.0',
      requestHost: '192.168.0.8' // the master (would be WRONG here)
    })
    expect(host).toBe('192.168.0.42')
  })

  it('falls back to the request host for a master VM whose node address is unknown (0.0.0.0)', () => {
    // The exact current state: bind/node/env are all 0.0.0.0; only the host the
    // browser reached the API on tells us the real reachable IP.
    const host = resolveConnectHost({
      configuredHost: '0.0.0.0',
      nodeAddress: '0.0.0.0',
      envHost: '0.0.0.0',
      requestHost: '192.168.0.8'
    })
    expect(host).toBe('192.168.0.8')
  })

  it('honours an explicit concrete graphicHost first (legacy/operator override)', () => {
    const host = resolveConnectHost({
      configuredHost: '10.20.30.40',
      nodeAddress: '192.168.0.42',
      envHost: 'graphics.example.com',
      requestHost: '192.168.0.8'
    })
    expect(host).toBe('10.20.30.40')
  })

  it('never returns a non-dialable address (0.0.0.0 / loopback / localhost are skipped)', () => {
    // Every source is a non-dialable placeholder -> must land on the default.
    expect(resolveConnectHost({ configuredHost: '0.0.0.0', nodeAddress: '127.0.0.1', envHost: '::1', requestHost: 'localhost' }))
      .toBe('localhost')
  })

  it('final fallback is localhost when nothing is usable', () => {
    expect(resolveConnectHost({ configuredHost: null, nodeAddress: null, envHost: undefined, requestHost: '' }))
      .toBe('localhost')
    expect(resolveConnectHost({ configuredHost: '0.0.0.0', nodeAddress: '0.0.0.0', envHost: '0.0.0.0', requestHost: '0.0.0.0' }))
      .toBe('localhost')
  })

  it('uses GRAPHIC_HOST env when node/config are unusable but before request host', () => {
    const host = resolveConnectHost({
      configuredHost: '0.0.0.0',
      nodeAddress: '',
      envHost: 'console.corp.example',
      requestHost: '192.168.0.8'
    })
    expect(host).toBe('console.corp.example')
  })
})

describe('hostFromHeader', () => {
  it('strips the port from host:port', () => {
    expect(hostFromHeader('192.168.0.8:4000')).toBe('192.168.0.8')
  })

  it('returns a bare host unchanged', () => {
    expect(hostFromHeader('192.168.0.8')).toBe('192.168.0.8')
    expect(hostFromHeader('console.example.com')).toBe('console.example.com')
  })

  it('handles an IPv6 literal in brackets with a port', () => {
    expect(hostFromHeader('[2001:db8::1]:4000')).toBe('2001:db8::1')
  })

  it('leaves a bare IPv6 (no brackets, no port) intact', () => {
    expect(hostFromHeader('2001:db8::1')).toBe('2001:db8::1')
  })

  it('takes the first hop of an X-Forwarded-Host list / array', () => {
    expect(hostFromHeader('192.168.0.8:4000, proxy.internal')).toBe('192.168.0.8')
    expect(hostFromHeader(['192.168.0.8:4000', 'proxy.internal'])).toBe('192.168.0.8')
  })

  it('returns null for empty / missing', () => {
    expect(hostFromHeader(undefined)).toBeNull()
    expect(hostFromHeader(null)).toBeNull()
    expect(hostFromHeader('')).toBeNull()
    expect(hostFromHeader('   ')).toBeNull()
  })
})
