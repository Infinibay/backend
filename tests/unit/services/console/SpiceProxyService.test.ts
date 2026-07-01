import net from 'net'
import { SpiceProxyService } from '../../../../app/services/console/SpiceProxyService'

// Silence the module logger.
jest.mock('@main/logger', () => ({
  __esModule: true,
  default: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
}))

// A minimal upstream that echoes back whatever it receives (stands in for the
// VM's SPICE server).
function startEchoServer (): Promise<{ port: number, close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => { sock.pipe(sock) })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({ port, close: () => server.close() })
    })
  })
}

// Connect to host:port, send `payload`, resolve with the first data chunk back.
function roundtrip (port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = net.connect(port, '127.0.0.1', () => c.write(payload))
    c.on('data', (d) => { resolve(d.toString()); c.destroy() })
    c.on('error', reject)
    c.setTimeout(3000, () => { c.destroy(); reject(new Error('client timeout')) })
  })
}

const cfg = { bindAddr: '127.0.0.1', portMin: 6300, portMax: 6320, idleMs: 60_000, maxLifetimeMs: 60_000, maxSessions: 5 }

describe('SpiceProxyService', () => {
  let proxy: SpiceProxyService
  let echo: { port: number, close: () => void }

  beforeEach(async () => {
    proxy = new SpiceProxyService(cfg)
    echo = await startEchoServer()
  })
  afterEach(() => {
    proxy.closeAll()
    echo.close()
  })

  it('relays raw bytes from a client through to the upstream and back', async () => {
    const session = await proxy.ensureSession('vm-1', '127.0.0.1', echo.port)
    expect(session.listenPort).toBeGreaterThanOrEqual(cfg.portMin)
    expect(session.listenPort).toBeLessThanOrEqual(cfg.portMax)

    const reply = await roundtrip(session.listenPort, 'SPICE-HELLO')
    expect(reply).toBe('SPICE-HELLO') // proves the full client->proxy->upstream->proxy->client path
  })

  it('reuses the SAME listen port for the same VM + upstream', async () => {
    const a = await proxy.ensureSession('vm-1', '127.0.0.1', echo.port)
    const b = await proxy.ensureSession('vm-1', '127.0.0.1', echo.port)
    expect(b.listenPort).toBe(a.listenPort)
    expect(proxy.sessionCount).toBe(1)
  })

  it('re-points the session to the new upstream when it changes (VM migrated)', async () => {
    const echo2 = await startEchoServer()
    try {
      await proxy.ensureSession('vm-1', '127.0.0.1', echo.port)
      const b = await proxy.ensureSession('vm-1', '127.0.0.1', echo2.port)
      // Still exactly one session for the VM, now aimed at the new upstream.
      // (The listen port may be reused — that is fine, the old listener is torn
      // down before the new one binds.)
      expect(proxy.sessionCount).toBe(1)
      expect(b.upstreamPort).toBe(echo2.port)
      // And the relay actually forwards to it.
      expect(await roundtrip(b.listenPort, 'AFTER-MIGRATE')).toBe('AFTER-MIGRATE')
    } finally {
      echo2.close()
    }
  })

  it('rejects an invalid upstream (SSRF / bad-input hardening)', async () => {
    await expect(proxy.ensureSession('vm-x', '', echo.port)).rejects.toThrow(/invalid upstream host/i)
    await expect(proxy.ensureSession('vm-x', 'evil host;rm', echo.port)).rejects.toThrow(/invalid upstream host/i)
    await expect(proxy.ensureSession('vm-x', '127.0.0.1', 0)).rejects.toThrow(/invalid upstream port/i)
    await expect(proxy.ensureSession('vm-x', '127.0.0.1', 70000)).rejects.toThrow(/invalid upstream port/i)
    expect(proxy.sessionCount).toBe(0)
  })

  it('closes a session and frees its port', async () => {
    const s = await proxy.ensureSession('vm-1', '127.0.0.1', echo.port)
    proxy.close('vm-1')
    expect(proxy.sessionCount).toBe(0)
    await expect(roundtrip(s.listenPort, 'x')).rejects.toBeDefined()
  })

  it('enforces the concurrent-session cap when all are in active use', async () => {
    const small = new SpiceProxyService({ ...cfg, maxSessions: 2 })
    try {
      // Hold a live client on each so none is idle-evictable.
      const s1 = await small.ensureSession('vm-1', '127.0.0.1', echo.port)
      const s2 = await small.ensureSession('vm-2', '127.0.0.1', echo.port)
      const c1 = net.connect(s1.listenPort, '127.0.0.1')
      const c2 = net.connect(s2.listenPort, '127.0.0.1')
      await new Promise((r) => setTimeout(r, 50))
      await expect(small.ensureSession('vm-3', '127.0.0.1', echo.port)).rejects.toThrow(/capacity/i)
      c1.destroy(); c2.destroy()
    } finally {
      small.closeAll()
    }
  })

  it('tears the session down after the idle timeout once clients disconnect', async () => {
    const quick = new SpiceProxyService({ ...cfg, idleMs: 120 })
    try {
      const s = await quick.ensureSession('vm-1', '127.0.0.1', echo.port)
      expect(quick.sessionCount).toBe(1)
      await new Promise((r) => setTimeout(r, 300))
      expect(quick.sessionCount).toBe(0)
      await expect(roundtrip(s.listenPort, 'x')).rejects.toBeDefined()
    } finally {
      quick.closeAll()
    }
  })
})
