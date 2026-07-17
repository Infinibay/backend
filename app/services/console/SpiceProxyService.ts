/**
 * SpiceProxyService — per-session TCP relay for VM SPICE/VNC consoles (Variant A).
 *
 * WHY: a VM's display server binds on the host that RUNS it (0.0.0.0/loopback on
 * the master, or a compute node's address). Exposing every node:port to the
 * client network is a security and reachability problem (and in the containerised
 * master only the API port is published). Instead, the master runs a relay: the
 * client always connects to ONE reachable ingress on the master, and the relay
 * forwards the raw SPICE/VNC stream to the correct upstream (host, port). This is
 * the same model as oVirt's websocket-proxy / OpenStack's spice/nova proxy, but
 * as a raw-TCP relay so the native `.vv` / virt-viewer flow keeps working.
 *
 * SECURITY (see also the callers):
 *  - The upstream (host, port) is resolved SERVER-SIDE from the VM's node record
 *    and its own display port — NEVER from client input. Each listener forwards
 *    only to that ONE fixed upstream, so this is not an open relay / SSRF pivot.
 *  - Session creation is gated by `vm:console` at the resolver. The relay itself
 *    is additionally protected by the per-VM SPICE ticket (password).
 *  - Listeners are bounded to a configurable port range, capped in count, and
 *    torn down on idle so an abandoned console cannot linger indefinitely.
 */
import net from 'net'
import logger from '@main/logger'

const debug = logger.child({ module: 'spice-proxy' })

export interface SpiceProxyConfig {
  /** Address the master listens on for CLIENTS. Must be client-reachable. */
  bindAddr: string
  /** Inclusive port range the relay allocates session listeners from. */
  portMin: number
  portMax: number
  /** Close a session this long after its LAST client disconnects. */
  idleMs: number
  /** Absolute cap on a session's lifetime regardless of activity. */
  maxLifetimeMs: number
  /** Max concurrent sessions (port-exhaustion / resource guard). */
  maxSessions: number
  /** Max concurrent client connections a single session listener will accept. */
  maxConnsPerSession: number
}

export interface ProxySession {
  vmId: string
  listenPort: number
  upstreamHost: string
  upstreamPort: number
  expiresAt: number
}

/**
 * Client-safe view of a live relay session for the Sessions UI. Deliberately
 * omits upstreamHost/upstreamPort — those are internal node addresses and must
 * never leak to a tenant. `channels` is the count of live client TCP sockets on
 * the listener (a single SPICE viewer opens several channels), so `connected`
 * (channels > 0) is the honest "someone has this console open right now" signal.
 */
export interface ConsoleSessionView {
  vmId: string
  listenPort: number
  channels: number
  connected: boolean
  expiresAt: number
}

interface InternalSession extends ProxySession {
  server: net.Server
  sockets: Set<net.Socket>
  idleTimer: NodeJS.Timeout | null
  hardTimer: NodeJS.Timeout
}

function envInt (name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) ? n : fallback
}

export function defaultConfig (): SpiceProxyConfig {
  return {
    bindAddr: process.env.SPICE_PROXY_BIND || '0.0.0.0',
    portMin: envInt('SPICE_PROXY_PORT_MIN', 6100),
    portMax: envInt('SPICE_PROXY_PORT_MAX', 6199),
    idleMs: envInt('SPICE_PROXY_IDLE_MS', 5 * 60 * 1000),
    maxLifetimeMs: envInt('SPICE_PROXY_MAX_LIFETIME_MS', 12 * 60 * 60 * 1000),
    maxSessions: envInt('SPICE_PROXY_MAX_SESSIONS', 200),
    // Bound the client connections a single console listener will accept. A SPICE
    // session legitimately opens a handful of channels (main/display/inputs/cursor,
    // plus optional audio/usbredir/smartcard for multi-monitor use), so the default
    // leaves headroom for those while capping abusive fan-out far below the
    // fd-exhausting "thousands". Tunable via SPICE_PROXY_MAX_CONNS_PER_SESSION.
    maxConnsPerSession: envInt('SPICE_PROXY_MAX_CONNS_PER_SESSION', 32)
  }
}

// A bare IPv4/IPv6/hostname sanity check — defence in depth so a careless caller
// can never turn the relay into an arbitrary-destination tunnel.
const HOST_RE = /^[a-zA-Z0-9._-]+$|^[0-9a-fA-F:]+$/

export class SpiceProxyService {
  private readonly cfg: SpiceProxyConfig
  private readonly sessions = new Map<string, InternalSession>() // key: vmId

  constructor (cfg: Partial<SpiceProxyConfig> = {}) {
    this.cfg = { ...defaultConfig(), ...cfg }
    if (this.cfg.portMin > this.cfg.portMax) {
      throw new Error(`SpiceProxy: invalid port range ${this.cfg.portMin}-${this.cfg.portMax}`)
    }
  }

  /**
   * Ensure a live relay session exists for `vmId` forwarding to (upstreamHost,
   * upstreamPort). Reuses an existing session for the same upstream; otherwise
   * allocates a new listener. Returns the client-facing listen port.
   */
  async ensureSession (vmId: string, upstreamHost: string, upstreamPort: number): Promise<ProxySession> {
    this.validateUpstream(upstreamHost, upstreamPort)

    const existing = this.sessions.get(vmId)
    if (existing) {
      if (existing.upstreamHost === upstreamHost && existing.upstreamPort === upstreamPort) {
        this.touch(existing)
        return this.publicView(existing)
      }
      // Upstream changed (e.g. VM migrated to another node) — replace it.
      this.close(vmId)
    }

    if (this.sessions.size >= this.cfg.maxSessions) {
      // Reclaim the oldest idle session before giving up.
      this.evictOldestIdle()
      if (this.sessions.size >= this.cfg.maxSessions) {
        throw new Error('SpiceProxy: session capacity reached; try again shortly')
      }
    }

    const session = await this.listenOnFreePort(vmId, upstreamHost, upstreamPort)
    return this.publicView(session)
  }

  private validateUpstream (host: string, port: number): void {
    if (typeof host !== 'string' || host.trim() === '' || !HOST_RE.test(host.trim())) {
      throw new Error('SpiceProxy: invalid upstream host')
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SpiceProxy: invalid upstream port')
    }
  }

  /**
   * Bind a relay listener on the first free port in the configured range.
   * Resolves with the fully-wired InternalSession.
   */
  private async listenOnFreePort (
    vmId: string,
    upstreamHost: string,
    upstreamPort: number
  ): Promise<InternalSession> {
    const inUse = new Set(Array.from(this.sessions.values()).map(s => s.listenPort))
    let lastErr: Error | null = null

    for (let port = this.cfg.portMin; port <= this.cfg.portMax; port++) {
      if (inUse.has(port)) continue
      try {
        const session = await this.tryListen(vmId, upstreamHost, upstreamPort, port)
        debug.info(`session up for VM ${vmId}: ${this.cfg.bindAddr}:${port} -> ${upstreamHost}:${upstreamPort}`)
        return session
      } catch (err: any) {
        lastErr = err
        if (err?.code === 'EADDRINUSE') continue // race with another allocator; try next
        throw err
      }
    }
    throw new Error(`SpiceProxy: no free port in ${this.cfg.portMin}-${this.cfg.portMax}${lastErr ? ` (${lastErr.message})` : ''}`)
  }

  private tryListen (vmId: string, upstreamHost: string, upstreamPort: number, port: number): Promise<InternalSession> {
    return new Promise<InternalSession>((resolve, reject) => {
      const sockets = new Set<net.Socket>()

      const server = net.createServer((client) => {
        // Defensive per-session fan-out guard for the rare race where a burst of
        // clients slips past server.maxConnections (set below): tear the client
        // down BEFORE opening any upstream socket. Each live connection contributes
        // two sockets (client + upstream), so the ceiling is 2x the per-session cap.
        if (sockets.size >= 2 * this.cfg.maxConnsPerSession) {
          client.destroy()
          return
        }
        // Relay one client <-> a fresh upstream connection. Errors on either leg
        // tear down BOTH; a failure here must never crash the process.
        const upstream = net.connect(upstreamPort, upstreamHost)
        sockets.add(client)
        sockets.add(upstream)

        const cleanup = (): void => {
          sockets.delete(client)
          sockets.delete(upstream)
          client.destroy()
          upstream.destroy()
          const s = this.sessions.get(vmId)
          if (s && s.sockets.size === 0) this.armIdle(s)
        }

        client.on('error', cleanup)
        upstream.on('error', (e) => { debug.warn(`upstream error VM ${vmId}: ${e.message}`); cleanup() })
        client.on('close', cleanup)
        upstream.on('close', cleanup)
        client.pipe(upstream)
        upstream.pipe(client)

        const live = this.sessions.get(vmId)
        if (live) this.touch(live)
      })

      // Cap concurrent client connections on this listener so a single authorized
      // console port cannot be used to open an unbounded number of upstream
      // sockets (fd / memory exhaustion, checklist 6). Node closes sockets beyond
      // the cap WITHOUT invoking the handler above, so no upstream net.connect is
      // ever spawned for the excess.
      server.maxConnections = this.cfg.maxConnsPerSession

      server.on('error', (err: any) => {
        server.close()
        reject(err)
      })

      server.listen(port, this.cfg.bindAddr, () => {
        server.removeAllListeners('error')
        server.on('error', (e) => debug.error(`listener error VM ${vmId}: ${e.message}`))
        const now = Date.now()
        const session: InternalSession = {
          vmId,
          listenPort: port,
          upstreamHost,
          upstreamPort,
          expiresAt: now + this.cfg.maxLifetimeMs,
          server,
          sockets,
          idleTimer: null,
          hardTimer: setTimeout(() => {
            debug.info(`session for VM ${vmId} hit max lifetime; closing`)
            this.close(vmId)
          }, this.cfg.maxLifetimeMs)
        }
        if (typeof session.hardTimer.unref === 'function') session.hardTimer.unref()
        this.sessions.set(vmId, session)
        this.armIdle(session) // no clients yet -> idle countdown starts
        resolve(session)
      })
    })
  }

  /** (Re)start the idle countdown; called when the session has no live clients. */
  private armIdle (session: InternalSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      if (session.sockets.size === 0) {
        debug.info(`session for VM ${session.vmId} idle; closing`)
        this.close(session.vmId)
      }
    }, this.cfg.idleMs)
    if (typeof session.idleTimer.unref === 'function') session.idleTimer.unref()
  }

  /** Cancel the idle countdown while a client is connected. */
  private touch (session: InternalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  private evictOldestIdle (): void {
    let oldest: InternalSession | null = null
    for (const s of this.sessions.values()) {
      if (s.sockets.size === 0 && (!oldest || s.expiresAt < oldest.expiresAt)) oldest = s
    }
    if (oldest) {
      debug.info(`evicting idle session for VM ${oldest.vmId} (capacity)`)
      this.close(oldest.vmId)
    }
  }

  /** Tear down a session and free its port. Idempotent. */
  close (vmId: string): void {
    const s = this.sessions.get(vmId)
    if (!s) return
    this.sessions.delete(vmId)
    if (s.idleTimer) clearTimeout(s.idleTimer)
    clearTimeout(s.hardTimer)
    for (const sock of s.sockets) sock.destroy()
    s.sockets.clear()
    try { s.server.close() } catch { /* already closed */ }
  }

  /** Tear down every session (shutdown / test cleanup). */
  closeAll (): void {
    for (const vmId of Array.from(this.sessions.keys())) this.close(vmId)
  }

  get sessionCount (): number {
    return this.sessions.size
  }

  /** Client-safe snapshot of every live relay session (for the Sessions UI). */
  listSessions (): ConsoleSessionView[] {
    const out: ConsoleSessionView[] = []
    for (const s of this.sessions.values()) {
      // `sockets` holds TWO entries per live channel (client + upstream — see the
      // fan-out guard in tryListen, `2 * maxConnsPerSession`), so halve it to get
      // the real client-channel count.
      const channels = Math.floor(s.sockets.size / 2)
      out.push({
        vmId: s.vmId,
        listenPort: s.listenPort,
        channels,
        connected: channels > 0,
        expiresAt: s.expiresAt
      })
    }
    return out
  }

  private publicView (s: InternalSession): ProxySession {
    return { vmId: s.vmId, listenPort: s.listenPort, upstreamHost: s.upstreamHost, upstreamPort: s.upstreamPort, expiresAt: s.expiresAt }
  }
}

// ---- Process-wide singleton (master) ----
let instance: SpiceProxyService | null = null
export function getSpiceProxyService (): SpiceProxyService {
  if (!instance) instance = new SpiceProxyService()
  return instance
}
