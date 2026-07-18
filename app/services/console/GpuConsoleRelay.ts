/**
 * GpuConsoleRelay — WebSocket-aware master-side relay for infinigpu's infiniPixel
 * remote-display stream, WITH a guest-input back-channel.
 *
 * A GPU VM has no SPICE/VNC, so it also has no SPICE input path: the infinigpu viewer
 * (native or browser) is the only way to drive the guest. This relay terminates the
 * viewer's WebSocket on the master and:
 *   - forwards every **binary** message from the per-VM device server (the H.264
 *     infiniPixel frames on 127.0.0.1:<pixelPort>) straight through to the viewer, and
 *   - interprets every **text** message from the viewer as a guest-input event and
 *     injects it into the VM over the master's existing QMP connection
 *     (`input-send-event`) — mouse when the pointer is in the viewer window, keys when it
 *     has focus. The device server never sees viewer→server traffic.
 *
 * WHY terminate (vs. SpiceProxyService's raw-TCP passthrough): the input back-channel has
 * to be split out of the client stream and routed to QMP, which the raw relay cannot do.
 * The upstream (host, pixelPort) and the injected VM are BOTH resolved server-side from
 * the vmId — never from client input — so a connected viewer can only drive the one VM it
 * was authorized for (no relay/SSRF pivot, no cross-VM input).
 *
 * Ports come from the same range as EncodedConsoleStreamService (INFINIPIXEL_PROXY_PORT_MIN
 * ..MAX, default 6120-6139), adjacent to and non-overlapping with the SPICE proxy's
 * 6100-6119, so a GPU stream can never collide with a SPICE session.
 */
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { createServer, type Server as HttpServer } from 'http'
import logger from '@main/logger'
import { getInfinization } from '../InfinizationService'

const debug = { info: (m: string) => logger.info(`(infinipixel-relay) ${m}`), warn: (m: string) => logger.warn(`(infinipixel-relay) ${m}`) }

function envInt (name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) ? n : fallback
}

// A bare IPv4/IPv6/hostname sanity check — defence in depth so a careless caller can't
// point the relay at an arbitrary host (mirrors SpiceProxyService.validateUpstream).
const HOST_RE = /^[a-zA-Z0-9._:-]+$/

export interface RelaySession {
  vmId: string
  listenPort: number
  connected: boolean
}

interface InternalSession {
  vmId: string
  listenPort: number
  upstreamHost: string
  upstreamPort: number
  wss: WebSocketServer
  http: HttpServer
  clients: Set<WebSocket>
  lastActivity: number
  idleTimer: NodeJS.Timeout | null
  bindLabel: string
}

/** Per-VM ordered input backlog drained one QMP injection at a time (see `inputQueues`). */
interface InputQueue {
  items: string[]
  draining: boolean
}

export interface GpuConsoleRelayConfig {
  portMin: number
  portMax: number
  /** Close a session this long after its LAST client disconnects (ms). */
  idleTimeoutMs: number
  /** Max concurrent viewer connections a single session will accept. */
  maxClientsPerSession: number
  bindAddr: string
  /** Pause the loopback device upstream once a viewer's outbound buffer exceeds this (bytes). */
  sendHighWaterMark: number
  /** Resume the upstream once the viewer's outbound buffer drains below this (bytes). */
  sendLowWaterMark: number
}

/** Normalized viewer→server input event (see the module doc for the wire shape). */
type QmpEvent = { type: string, data: Record<string, unknown> }

export class GpuConsoleRelay {
  private readonly cfg: GpuConsoleRelayConfig
  private readonly sessions = new Map<string, InternalSession>()
  // Per-VM ORDERED input queue. Each viewer input message becomes a QMP `input-send-event`;
  // firing them concurrently (fire-and-forget) let rapid events race and reach QEMU out of
  // order — e.g. `ctrl↓ ctrl↑ x↓` landing as ctrl-still-held (→ phantom Ctrl+X / stuck
  // modifiers). Draining one at a time preserves order. Bursts of absolute mouse-moves are
  // COALESCED (only the newest cursor position matters), so a move flood can't stack N QMP
  // round-trips ahead of the next click/keystroke — the dominant input-lag source.
  private readonly inputQueues = new Map<string, InputQueue>()

  constructor (cfg?: Partial<GpuConsoleRelayConfig>) {
    this.cfg = {
      portMin: cfg?.portMin ?? envInt('INFINIPIXEL_PROXY_PORT_MIN', 6120),
      portMax: cfg?.portMax ?? envInt('INFINIPIXEL_PROXY_PORT_MAX', 6139),
      idleTimeoutMs: cfg?.idleTimeoutMs ?? envInt('INFINIPIXEL_PROXY_IDLE_MS', 5 * 60_000),
      maxClientsPerSession: cfg?.maxClientsPerSession ?? envInt('INFINIPIXEL_PROXY_MAX_CLIENTS', 4),
      bindAddr: cfg?.bindAddr ?? (process.env.INFINIPIXEL_PROXY_BIND ?? '0.0.0.0'),
      sendHighWaterMark: cfg?.sendHighWaterMark ?? envInt('INFINIPIXEL_PROXY_HWM_BYTES', 1024 * 1024),
      sendLowWaterMark: cfg?.sendLowWaterMark ?? envInt('INFINIPIXEL_PROXY_LWM_BYTES', 256 * 1024)
    }
    if (this.cfg.portMin > this.cfg.portMax) {
      throw new Error(`GpuConsoleRelay: invalid port range ${this.cfg.portMin}-${this.cfg.portMax}`)
    }
  }

  /**
   * Ensure a live relay for `vmId` bridging viewers to (upstreamHost, upstreamPort) and
   * injecting their input into `vmId` over QMP. Reuses an existing session for the same
   * upstream; otherwise allocates a new listener. Returns the client-facing listen port.
   */
  async ensureSession (vmId: string, upstreamHost: string, upstreamPort: number): Promise<RelaySession> {
    this.validateUpstream(upstreamHost, upstreamPort)
    const existing = this.sessions.get(vmId)
    if (existing) {
      if (existing.upstreamHost === upstreamHost && existing.upstreamPort === upstreamPort) {
        this.touch(existing)
        return this.publicView(existing)
      }
      this.close(vmId) // upstream changed (VM restarted / new pixelPort) — replace it
    }
    const session = await this.listenOnFreePort(vmId, upstreamHost, upstreamPort)
    return this.publicView(session)
  }

  close (vmId: string): void {
    const s = this.sessions.get(vmId)
    if (!s) return
    this.sessions.delete(vmId)
    this.inputQueues.delete(vmId)
    if (s.idleTimer) clearTimeout(s.idleTimer)
    for (const c of s.clients) { try { c.terminate() } catch { /* ignore */ } }
    try { s.wss.close() } catch { /* ignore */ }
    try { s.http.close() } catch { /* ignore */ }
    debug.info(`session for VM ${vmId} closed (${s.bindLabel})`)
  }

  private validateUpstream (host: string, port: number): void {
    if (typeof host !== 'string' || host.trim() === '' || !HOST_RE.test(host.trim())) {
      throw new Error('GpuConsoleRelay: invalid upstream host')
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('GpuConsoleRelay: invalid upstream port')
    }
  }

  private async listenOnFreePort (vmId: string, upstreamHost: string, upstreamPort: number): Promise<InternalSession> {
    let lastErr: Error | null = null
    for (let port = this.cfg.portMin; port <= this.cfg.portMax; port++) {
      try {
        return await this.tryListen(vmId, upstreamHost, upstreamPort, port)
      } catch (e) {
        lastErr = e as Error // EADDRINUSE (another session or the SPICE range) — try next
      }
    }
    throw new Error(`GpuConsoleRelay: no free port in ${this.cfg.portMin}-${this.cfg.portMax}${lastErr ? ` (${lastErr.message})` : ''}`)
  }

  private tryListen (vmId: string, upstreamHost: string, upstreamPort: number, port: number): Promise<InternalSession> {
    return new Promise((resolve, reject) => {
      const http = createServer()
      const wss = new WebSocketServer({ server: http })
      const session: InternalSession = {
        vmId, listenPort: port, upstreamHost, upstreamPort, wss, http,
        clients: new Set(), lastActivity: Date.now(), idleTimer: null,
        bindLabel: `${this.cfg.bindAddr}:${port} -> ${upstreamHost}:${upstreamPort}`
      }

      wss.on('connection', (client) => this.onClient(session, client))
      http.once('error', (e) => reject(e))
      http.listen(port, this.cfg.bindAddr, () => {
        http.removeAllListeners('error')
        this.sessions.set(vmId, session)
        this.touch(session)
        debug.info(`session up for VM ${vmId}: ${session.bindLabel}`)
        resolve(session)
      })
    })
  }

  private onClient (session: InternalSession, client: WebSocket): void {
    if (session.clients.size >= this.cfg.maxClientsPerSession) {
      try { client.close(1013, 'too many viewers') } catch { /* ignore */ }
      return
    }
    this.touch(session)
    session.clients.add(client)
    debug.info(`viewer connected to VM ${session.vmId} (${session.clients.size} total)`)

    // Upstream: the per-VM device server's infiniPixel WebSocket (loopback, server-side).
    const upstream = new WebSocket(`ws://${session.upstreamHost}:${session.upstreamPort}`)
    let upstreamOpen = false
    let upstreamPaused = false

    upstream.on('open', () => { upstreamOpen = true })
    upstream.on('message', (data: RawData, isBinary: boolean) => {
      // Device→viewer: forward encoded frames (binary) verbatim, then apply BACKPRESSURE.
      // We must not buffer unboundedly here — a slow viewer would accrue standing latency
      // equal to the queued bytes (bufferbloat) — and we cannot shed safely at this stage:
      // the relay has no way to force an IDR, so dropping P-frames would desync the decoder.
      // Instead, when the viewer's outbound buffer is congested we PAUSE the loopback device
      // upstream; the congestion signal propagates back through TCP to the pixel Hub, the one
      // stage that can shed correctly (collapse-to-keyframe + force a fresh IDR).
      if (client.readyState !== WebSocket.OPEN) return
      client.send(data, { binary: isBinary }, () => {
        // Flushed to the socket: resume the upstream once the buffer has drained enough.
        if (upstreamPaused && client.bufferedAmount < this.cfg.sendLowWaterMark) {
          upstreamPaused = false
          try { upstream.resume() } catch { /* ignore */ }
        }
      })
      if (!upstreamPaused && client.bufferedAmount > this.cfg.sendHighWaterMark) {
        upstreamPaused = true
        try { upstream.pause() } catch { /* ignore */ }
      }
    })
    upstream.on('close', () => { try { client.close() } catch { /* ignore */ } })
    upstream.on('error', (e) => { debug.warn(`upstream error VM ${session.vmId}: ${e.message}`); try { client.close() } catch { /* ignore */ } })

    client.on('message', (data: RawData, isBinary: boolean) => {
      this.touch(session)
      // Viewer→server: text = a guest-input event → QMP. Binary is not expected from a
      // viewer; forward it upstream only if the device ever grows a client channel.
      if (isBinary) return
      const text = data.toString()
      this.enqueueInput(session.vmId, text)
    })
    const cleanup = (): void => {
      session.clients.delete(client)
      try { if (upstreamOpen) upstream.close(); else upstream.terminate() } catch { /* ignore */ }
      this.touch(session)
      debug.info(`viewer disconnected from VM ${session.vmId} (${session.clients.size} left)`)
    }
    client.on('close', cleanup)
    client.on('error', cleanup)
  }

  /**
   * Enqueue one viewer input message for ordered injection. Consecutive absolute mouse-moves
   * collapse to the latest (an old cursor position is worthless once a newer one exists), so a
   * move flood can't push N QMP round-trips ahead of the next click/keystroke.
   */
  private enqueueInput (vmId: string, text: string): void {
    let q = this.inputQueues.get(vmId)
    if (!q) { q = { items: [], draining: false }; this.inputQueues.set(vmId, q) }
    const last = q.items.length > 0 ? q.items[q.items.length - 1] : undefined
    if (isMouseMove(text) && last !== undefined && isMouseMove(last)) {
      q.items[q.items.length - 1] = text // coalesce: keep only the newest pending move
    } else {
      q.items.push(text)
    }
    void this.drainInput(vmId)
  }

  /** Drain a VM's input backlog in order, one QMP injection at a time. */
  private async drainInput (vmId: string): Promise<void> {
    const q = this.inputQueues.get(vmId)
    if (!q || q.draining) return
    q.draining = true
    try {
      while (q.items.length > 0) {
        const text = q.items.shift() as string
        await this.handleInput(vmId, text)
      }
    } finally {
      q.draining = false
    }
  }

  /** Translate one viewer input message to QMP events and inject over the VM's monitor. */
  private async handleInput (vmId: string, text: string): Promise<void> {
    let events: QmpEvent[]
    try {
      events = translateInput(JSON.parse(text))
    } catch {
      return // malformed input is dropped, never fatal
    }
    if (events.length === 0) return
    try {
      const infinization = await getInfinization()
      const qmp = infinization.getQMPClient(vmId)
      if (!qmp) return // VM not attached (e.g. mid-restart) — drop input rather than throw
      // Bound the injection. Input rides the single in-band QMP monitor, so if QEMU's main loop
      // is momentarily stalled (e.g. the device server blocking the vfio-user thread), a naive
      // await would hold this serial drain for the full 30s command timeout — freezing the whole
      // cursor queue. Cap it: on a stall, abandon THIS injection and keep draining; the newest
      // coalesced mouse position is re-sent on the next event, so the cursor self-heals instead
      // of wedging. The device-side fix removes the stall itself; this bounds the worst case and
      // surfaces it. The `.catch` keeps a late (post-timeout) rejection from going unhandled.
      const t0 = Date.now()
      const exec = qmp.execute('input-send-event', { events }).then(() => true).catch(() => false)
      const injected = await Promise.race([
        exec,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), INPUT_INJECT_TIMEOUT_MS))
      ])
      const dt = Date.now() - t0
      if (!injected) {
        debug.warn(`input inject slow VM ${vmId}: abandoned after ${dt}ms (QMP monitor stalled) — cursor will catch up`)
      } else if (dt > 150) {
        debug.warn(`input inject slow VM ${vmId}: ${dt}ms on the QMP monitor`)
      }
    } catch (e) {
      debug.warn(`input inject failed VM ${vmId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private touch (session: InternalSession): void {
    session.lastActivity = Date.now()
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      if (session.clients.size === 0) this.close(session.vmId)
      else this.touch(session)
    }, this.cfg.idleTimeoutMs)
    if (typeof session.idleTimer.unref === 'function') session.idleTimer.unref()
  }

  private publicView (s: InternalSession): RelaySession {
    return { vmId: s.vmId, listenPort: s.listenPort, connected: s.clients.size > 0 }
  }
}

/**
 * Max time to wait for a single `input-send-event` on the shared QMP monitor before abandoning
 * it and continuing to drain. Well above a healthy round-trip (sub-ms on a live monitor), so it
 * only trips on a genuine QEMU main-loop stall — bounding a would-be 30s wedge to under a second.
 */
const INPUT_INJECT_TIMEOUT_MS = 800

/** Cheap test for an absolute mouse-move message (the viewer emits compact `{"t":"m",...}`). */
function isMouseMove (text: string): boolean {
  return text.startsWith('{"t":"m"')
}

/** Clamp a normalized 0..1 axis into QEMU's absolute 0..32767 range. */
function absAxis (v: unknown): number {
  const n = typeof v === 'number' ? v : 0
  return Math.max(0, Math.min(32767, Math.round(n * 32767)))
}

const BUTTON = { l: 'left', r: 'right', m: 'middle' } as const

/**
 * Translate a compact viewer input message to QEMU `input-send-event` events.
 *   {"t":"m","x":0..1,"y":0..1}         mouse absolute move
 *   {"t":"b","b":"l"|"r"|"m","d":0|1}   mouse button up/down
 *   {"t":"w","d":+1|-1}                 wheel notch
 *   {"t":"k","q":"<qcode>","d":0|1}     key up/down (viewer sends the QEMU qcode)
 */
function translateInput (msg: unknown): QmpEvent[] {
  if (msg == null || typeof msg !== 'object') return []
  const m = msg as Record<string, unknown>
  switch (m.t) {
    case 'm':
      return [
        { type: 'abs', data: { axis: 'x', value: absAxis(m.x) } },
        { type: 'abs', data: { axis: 'y', value: absAxis(m.y) } }
      ]
    case 'b': {
      const button = BUTTON[m.b as keyof typeof BUTTON]
      if (!button) return []
      return [{ type: 'btn', data: { button, down: !!m.d } }]
    }
    case 'w': {
      const up = (typeof m.d === 'number' ? m.d : 0) > 0
      const button = up ? 'wheel-up' : 'wheel-down'
      // A wheel notch is a press+release of the wheel "button".
      return [
        { type: 'btn', data: { button, down: true } },
        { type: 'btn', data: { button, down: false } }
      ]
    }
    case 'k': {
      if (typeof m.q !== 'string' || m.q.length === 0) return []
      return [{ type: 'key', data: { down: !!m.d, key: { type: 'qcode', data: m.q } } }]
    }
    default:
      return []
  }
}

let instance: GpuConsoleRelay | null = null

/** Singleton WS-aware infiniPixel relay (display out + input in). */
export function getGpuConsoleRelay (): GpuConsoleRelay {
  if (instance == null) instance = new GpuConsoleRelay()
  return instance
}
