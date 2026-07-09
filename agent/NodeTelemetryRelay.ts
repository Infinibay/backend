/// <reference types="node" />
/**
 * NodeTelemetryRelay — multi-node Phase 1: node-hosted VM guest telemetry.
 *
 * A compute node runs its VMs' QEMU locally, so each VM's infiniservice
 * virtio-serial socket (`<vmId>.socket`) lives on the NODE's filesystem — the
 * master's VirtioSocketWatcherService only watches its OWN local dir and never
 * sees it. Without this relay, a node-hosted VM's metrics / agent events never
 * reach the frontend (the gap tracked in the multi-node walking skeleton).
 *
 * This relay is a DUMB PASSIVE READER: it opens each local VM socket, reads the
 * NDJSON metric stream, and forwards the raw messages + a connection-state
 * summary to the master over the existing authenticated cluster channel. It
 * NEVER writes to the guest socket, so:
 *   - it needs NO HMAC secret (the master keeps INFINISERVICE_HMAC_MASTER_SECRET;
 *     signing + command delivery stay a master concern — Phase 2), and
 *   - infiniservice streams metrics on its own 30s timer regardless of a silent
 *     host (verified: keep-alive absence only flips an internal flag that the next
 *     metric send heals; the send-side circuit breaker never trips on a drained
 *     socket). See infiniservice src/service.rs / src/auth.rs.
 *
 * Robustness (master-down / partition tolerant): forwarding is a stateless,
 * batched POST with a BOUNDED ring buffer (drop-oldest) + adaptive backoff. If
 * the master is unreachable the node buffers the newest telemetry and retries;
 * on recovery it flushes and re-sends a full connection-state snapshot so the
 * master converges. The node cannot detect its own death, so the master expires
 * a node's remote connections when its telemetry POSTs stop (a periodic snapshot
 * is the liveness signal).
 *
 * Dependency-light on purpose (fs / path / net only, `post` injected) — the node
 * agent deliberately holds no Prisma/EventManager, and this must not drag them in.
 */
import fs from 'fs'
import path from 'path'
import net from 'net'

// NDJSON receive-buffer caps — mirror MessageRouter's guest-controlled-stream
// limits so a misbehaving guest can't OOM the node agent either.
const MAX_BUFFER_BYTES = Number(process.env.VIRTIO_MAX_BUFFER_BYTES) || 8 * 1024 * 1024
const MAX_MESSAGE_BYTES = Number(process.env.VIRTIO_MAX_MESSAGE_BYTES) || 4 * 1024 * 1024

// A socket is considered "stale" (guest agent silent) if no line arrived within
// this window. infiniservice sends metrics every ~30s, so 90s = 3 missed cycles.
const STALE_AFTER_MS = Number(process.env.NODE_TELEMETRY_STALE_MS) || 90_000

// Only these guest message types have a vmId-keyed handler on the master and are
// useful for the READ path. Everything else (keep_alive, circuit_breaker_state,
// error_report, response, request_pending_scripts, connection_state_change) is
// node-local connection health or needs a reply we can't sign in Phase 1 — drop it.
const FORWARDED_TYPES = new Set(['metrics', 'agent_event', 'script_completion', 'firewall_event'])

interface RelayFrame {
  vmId: string
  seq: number
  message: Record<string, unknown>
}

interface ConnState {
  vmId: string
  isConnected: boolean
  reconnectAttempts: number
  lastMessageTime: string // ISO
  droppedFrames: number
}

interface VmSocket {
  vmId: string
  socketPath: string
  socket: net.Socket | null
  buffer: string
  isConnected: boolean
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
  lastMessageTime: Date
  droppedFrames: number
  closed: boolean // relay asked this VM to stop (file gone / shutdown)
}

export interface TelemetryPostResult { status: number, text: string }

export interface NodeTelemetryRelayOptions {
  /** Directory where node-hosted VMs' `<vmId>.socket` files live (= INFINIZATION_SOCKET_DIR). */
  socketDir: string
  /** This node's name — self-asserted in the body (ignored by the master under mTLS, which uses the cert CN). */
  nodeName: string
  /** POST the telemetry batch to the master's /cluster/telemetry (mTLS or token — supplied by the caller). */
  post: (body: unknown) => Promise<TelemetryPostResult>
  /** Optional structured logger; defaults to console. */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export class NodeTelemetryRelay {
  private readonly socketDir: string
  private readonly nodeName: string
  private readonly post: (body: unknown) => Promise<TelemetryPostResult>
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void

  // A per-process epoch lets the master reset its dedup cursor when this relay
  // restarts (seq resets to 0). Random + start time so two nodes never collide.
  private readonly epoch: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  private seq = 0

  private readonly vms = new Map<string, VmSocket>()
  private readonly frameBuffer: RelayFrame[] = []

  private scanTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private snapshotTimer: NodeJS.Timeout | null = null
  private flushing = false
  private consecutiveFlushFailures = 0
  private lastSnapshotAt = 0
  private stopped = false

  // Tunables (env-overridable).
  private readonly scanMs = Number(process.env.NODE_TELEMETRY_SCAN_MS) || 5_000
  private readonly flushMs = Number(process.env.NODE_TELEMETRY_FLUSH_MS) || 2_000
  private readonly snapshotMs = Number(process.env.NODE_TELEMETRY_SNAPSHOT_MS) || 15_000
  private readonly maxBufferedFrames = Number(process.env.NODE_TELEMETRY_MAX_FRAMES) || 5_000
  private readonly maxFramesPerFlush = Number(process.env.NODE_TELEMETRY_MAX_FRAMES_PER_FLUSH) || 200
  // Bound a flush by BYTES too: metrics messages vary wildly (a big process list
  // is 100s of KB), so a count-only cap could blow past the master's body limit.
  private readonly maxFlushBytes = Number(process.env.NODE_TELEMETRY_MAX_FLUSH_BYTES) || 3 * 1024 * 1024
  private readonly maxBackoffMs = Number(process.env.NODE_TELEMETRY_MAX_BACKOFF_MS) || 60_000
  private readonly reconnectBaseMs = Number(process.env.NODE_TELEMETRY_RECONNECT_BASE_MS) || 3_000
  private readonly maxReconnectMs = Number(process.env.NODE_TELEMETRY_MAX_RECONNECT_MS) || 60_000

  constructor (opts: NodeTelemetryRelayOptions) {
    this.socketDir = opts.socketDir
    this.nodeName = opts.nodeName
    this.post = opts.post
    this.log = opts.log ?? ((level, msg) => { console[level === 'info' ? 'log' : level](`[telemetry] ${msg}`) })
  }

  start (): void {
    this.log('info', `relay started: watching ${this.socketDir} (flush ${this.flushMs}ms, snapshot ${this.snapshotMs}ms)`)
    // Discover sockets now and on an interval (poll instead of fs.watch: robust on
    // overlay/bind-mount container filesystems where inotify events are unreliable).
    this.scan()
    this.scanTimer = this.unref(setInterval(() => this.scan(), this.scanMs))
    this.flushTimer = this.unref(setInterval(() => { void this.flush(false) }, this.flushMs))
    this.snapshotTimer = this.unref(setInterval(() => { void this.flush(true) }, this.snapshotMs))
  }

  stop (): void {
    this.stopped = true
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    for (const vm of this.vms.values()) {
      if (vm.reconnectTimer) clearTimeout(vm.reconnectTimer)
      vm.closed = true
      vm.socket?.destroy()
    }
    this.vms.clear()
  }

  private unref (t: NodeJS.Timeout): NodeJS.Timeout {
    if (typeof t.unref === 'function') t.unref()
    return t
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Socket discovery
  // ──────────────────────────────────────────────────────────────────────────

  private scan (): void {
    let entries: string[]
    try {
      entries = fs.readdirSync(this.socketDir)
    } catch {
      // Dir not created yet (no VM has started on this node) — nothing to do.
      return
    }
    const present = new Set<string>()
    for (const name of entries) {
      const m = name.match(/^(.+)\.socket$/)
      if (!m) continue // QMP `.sock` and other files are not infiniservice channels
      const vmId = m[1]
      present.add(vmId)
      if (!this.vms.has(vmId)) {
        this.connect(vmId, path.join(this.socketDir, name))
      }
    }
    // A socket file that disappeared means the VM was destroyed/stopped — tear
    // down our reader (its disconnected state is reported on the next snapshot).
    for (const [vmId, vm] of this.vms) {
      if (!present.has(vmId)) {
        this.log('info', `socket for VM ${vmId} removed — closing reader`)
        vm.closed = true
        if (vm.reconnectTimer) clearTimeout(vm.reconnectTimer)
        vm.socket?.destroy()
        this.vms.delete(vmId)
        this.markConn(vm, false)
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Per-VM socket lifecycle (read-only)
  // ──────────────────────────────────────────────────────────────────────────

  private connect (vmId: string, socketPath: string): void {
    const existing = this.vms.get(vmId)
    const vm: VmSocket = existing ?? {
      vmId,
      socketPath,
      socket: null,
      buffer: '',
      isConnected: false,
      reconnectAttempts: 0,
      reconnectTimer: null,
      lastMessageTime: new Date(),
      droppedFrames: 0,
      closed: false
    }
    if (!existing) this.vms.set(vmId, vm)
    vm.closed = false
    vm.reconnectTimer = null

    const socket = new net.Socket()
    vm.socket = socket
    vm.buffer = ''
    socket.setTimeout(0) // Unix domain socket — keep open indefinitely

    socket.on('connect', () => {
      vm.reconnectAttempts = 0
      vm.lastMessageTime = new Date()
      this.markConn(vm, true)
      this.log('info', `connected to VM ${vmId} socket`)
    })

    socket.on('data', (data: Buffer) => {
      try {
        this.onData(vm, data)
      } catch (err) {
        // Buffer overflow / framing violation — tear the socket down (fail-closed);
        // the reconnect path re-establishes a clean stream.
        this.log('warn', `data error for VM ${vmId}: ${String(err)} — resetting socket`)
        socket.destroy()
      }
    })

    const onGone = (): void => {
      if (vm.socket === socket) {
        this.markConn(vm, false)
        this.scheduleReconnect(vm)
      }
    }
    socket.on('error', () => onGone())
    socket.on('close', () => onGone())

    try {
      socket.connect(socketPath)
    } catch {
      onGone()
    }
  }

  private scheduleReconnect (vm: VmSocket): void {
    if (vm.closed || this.stopped) return
    if (vm.reconnectTimer) return // already scheduled
    // The socket file may have been removed concurrently; the next scan() prunes it.
    if (!fs.existsSync(vm.socketPath)) return
    vm.reconnectAttempts++
    const delay = Math.min(this.reconnectBaseMs * Math.pow(1.5, Math.min(vm.reconnectAttempts, 12)), this.maxReconnectMs)
    vm.reconnectTimer = this.unref(setTimeout(() => {
      vm.reconnectTimer = null
      if (!vm.closed && !this.stopped && fs.existsSync(vm.socketPath)) {
        this.connect(vm.vmId, vm.socketPath)
      }
    }, delay))
  }

  private onData (vm: VmSocket, data: Buffer): void {
    const chunk = data.toString()
    if (vm.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      vm.buffer = ''
      throw new Error(`receive buffer overflow for VM ${vm.vmId}`)
    }
    vm.buffer += chunk
    vm.lastMessageTime = new Date()

    let idx: number
    while ((idx = vm.buffer.indexOf('\n')) !== -1) {
      const line = vm.buffer.slice(0, idx)
      vm.buffer = vm.buffer.slice(idx + 1)
      if (line.length > MAX_MESSAGE_BYTES) continue // drop one oversized message, keep the stream
      const trimmed = line.trim()
      if (!trimmed) continue
      this.onLine(vm, trimmed)
    }
  }

  private onLine (vm: VmSocket, line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return // ignore non-JSON noise
    }
    const type = typeof message.type === 'string' ? message.type : undefined
    if (!type || !FORWARDED_TYPES.has(type)) return
    this.enqueue(vm, message)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Forwarding — bounded ring buffer
  // ──────────────────────────────────────────────────────────────────────────

  private enqueue (vm: VmSocket, message: Record<string, unknown>): void {
    if (this.frameBuffer.length >= this.maxBufferedFrames) {
      // Drop the OLDEST frame: telemetry is time-series, the newest matters most.
      this.frameBuffer.shift()
      vm.droppedFrames++
      if (vm.droppedFrames === 1 || vm.droppedFrames % 100 === 0) {
        this.log('warn', `telemetry buffer full (${this.maxBufferedFrames}); dropped ${vm.droppedFrames} frames for VM ${vm.vmId} (master unreachable?)`)
      }
    }
    this.frameBuffer.push({ vmId: vm.vmId, seq: ++this.seq, message })
  }

  private markConn (vm: VmSocket, isConnected: boolean): void {
    if (vm.isConnected !== isConnected) {
      vm.isConnected = isConnected
      // Surface the change promptly (don't wait for the periodic snapshot).
      void this.flush(false)
    } else {
      vm.isConnected = isConnected
    }
  }

  private connSnapshot (): ConnState[] {
    const now = Date.now()
    const out: ConnState[] = []
    for (const vm of this.vms.values()) {
      // A socket can be "connected" at the TCP level but the guest agent silent;
      // treat a long gap as not-connected so the master's Sessions view is honest.
      const fresh = now - vm.lastMessageTime.getTime() < STALE_AFTER_MS
      out.push({
        vmId: vm.vmId,
        isConnected: vm.isConnected && fresh,
        reconnectAttempts: vm.reconnectAttempts,
        lastMessageTime: vm.lastMessageTime.toISOString(),
        droppedFrames: vm.droppedFrames
      })
    }
    return out
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Flush to master
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Send buffered frames + connection state to the master. `snapshot=true` sends
   * the FULL connection set (liveness beacon + convergence after a master restart
   * or a dropped ack); a plain flush is skipped when there's nothing to send.
   */
  private async flush (snapshot: boolean): Promise<void> {
    if (this.stopped || this.flushing) return
    // Adaptive backoff: while the master is failing, only the snapshot cadence
    // retries, and even that is spaced out — never hammer a down master.
    if (this.consecutiveFlushFailures > 0 && !snapshot) return
    if (snapshot && this.consecutiveFlushFailures > 0) {
      const backoff = Math.min(this.snapshotMs * Math.pow(2, this.consecutiveFlushFailures), this.maxBackoffMs)
      if (Date.now() - this.lastSnapshotAt < backoff) return
    }
    if (!snapshot && this.frameBuffer.length === 0) return

    this.flushing = true
    // Take frames up to BOTH a count and a byte budget so a long-buffered backlog
    // drains in bounded chunks the master can accept within its body limit +
    // request deadline. Always include at least one frame (even if it alone
    // exceeds the byte budget) so an oversized single message still makes progress.
    let take = 0
    let bytes = 0
    while (take < this.frameBuffer.length && take < this.maxFramesPerFlush) {
      const sz = Buffer.byteLength(JSON.stringify(this.frameBuffer[take].message))
      if (take > 0 && bytes + sz > this.maxFlushBytes) break
      bytes += sz
      take++
    }
    const frames = this.frameBuffer.slice(0, take)
    const isFullDrain = take === this.frameBuffer.length
    const body = {
      nodeName: this.nodeName,
      epoch: this.epoch,
      // Only advertise a full snapshot when we're draining everything — a partial
      // frame flush must NOT let the master prune VMs it hasn't heard the tail for.
      snapshot: snapshot && isFullDrain,
      frames,
      connections: (snapshot || this.vms.size > 0) ? this.connSnapshot() : []
    }

    try {
      const res = await this.post(body)
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`master rejected telemetry (${res.status}): ${res.text.slice(0, 200)}`)
      }
      // Success — drop exactly the frames we sent (new ones may have arrived).
      this.frameBuffer.splice(0, frames.length)
      if (snapshot) this.lastSnapshotAt = Date.now()
      if (this.consecutiveFlushFailures > 0) {
        this.log('info', `telemetry link to master recovered (was failing ${this.consecutiveFlushFailures}x)`)
        this.consecutiveFlushFailures = 0
      }
      // Keep draining a large backlog promptly instead of waiting a full tick.
      if (this.frameBuffer.length > 0 && !this.stopped) setImmediate(() => { void this.flush(false) })
    } catch (err) {
      this.consecutiveFlushFailures++
      if (snapshot) this.lastSnapshotAt = Date.now()
      // Frames are retained (not spliced) and retried on the next snapshot cadence.
      if (this.consecutiveFlushFailures === 1 || this.consecutiveFlushFailures % 10 === 0) {
        this.log('warn', `telemetry flush failed (${this.consecutiveFlushFailures}x, ${this.frameBuffer.length} frames buffered): ${String(err)}`)
      }
    } finally {
      this.flushing = false
    }
  }
}
