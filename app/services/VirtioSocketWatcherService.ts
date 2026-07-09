/**
 * VirtioSocketWatcherService - Orchestrator for VM InfiniService agent connections
 *
 * This file is the thin orchestrator that wires together the extracted sub-modules:
 * - ConnectionManager: connection lifecycle, reconnection, filesystem watcher
 * - MessageRouter: incoming socket data parsing and message dispatch
 * - KeepAliveManager: bidirectional keep-alive monitoring and RTT tracking
 * - MetricsHandler: metrics storage and auto-check responses
 * - CommandDispatcher: safe/unsafe command sending
 *
 * Debug output control:
 * - To see all debug messages: DEBUG=infinibay:virtio-socket:* npm run dev
 * - To see only errors/warnings: DEBUG=infinibay:virtio-socket:error,infinibay:virtio-socket:warn npm run dev
 * - To see info level: DEBUG=infinibay:virtio-socket:info npm run dev
 * - To disable all output: (default, or set DEBUG to other namespaces)
 */
import prisma from '@utils/database'
import { EventEmitter } from 'events'
import * as path from 'path'
import { VmEventManager } from './VmEventManager'
import { getEventManager } from './EventManager'
import { VMHealthQueueManager } from './VMHealthQueueManager'
import { Logger } from 'winston'
import logger from '@main/logger'
import { getSocketService } from '../services/SocketService'
import { ScriptManager } from './scripts/ScriptManager'
import { TemplateEngine } from './scripts/TemplateEngine'
import { MetricsHandler } from './socket-watcher/MetricsHandler'
import { CommandDispatcher } from './socket-watcher/CommandDispatcher'
import { KeepAliveManager } from './socket-watcher/KeepAliveManager'
import { MessageRouter } from './socket-watcher/MessageRouter'
import { ConnectionManager } from './socket-watcher/ConnectionManager'
import { HealthMonitor } from './socket-watcher/HealthMonitor'
import { signForVm } from './socket-watcher/AgentMessageSigner'
import { emitAdminResourceEvent } from './AdminBroadcastEventManager'
import { deliverAgentCommandToNode } from './node/NodeDispatcher'

// Import all types, constants, and helpers from the canonical source
import {
  // Re-export types used by external consumers
  type BaseMessage,
  type ErrorMessage,
  type MetricsMessage,
  type ErrorReportMessage,
  type CommandMessage,
  type ResponseMessage,
  type CircuitBreakerStateMessage,
  type KeepAliveMessage,
  type KeepAliveRequestMessage,
  type FirewallEventMessage,
  type ScriptCompletionMessage,
  type RequestPendingScriptsMessage,
  type AgentEventMessage,
  type PendingScriptsResponseMessage,
  type PendingScriptInfo,
  type PackageInfo,
  type ServiceInfo,
  type ProcessInfo,
  type UserInfo,
  type SystemInfo,
  type OsInfo,
  type WindowsUpdate,
  type WindowsUpdatesData,
  type DefenderData,
  type DiskDrive,
  type DiskSpaceData,
  type ResourceOptimizationData,
  type HealthCheckData,
  type DefenderScanData,
  type ResponseData,
  type SafeCommandParams,
  type OutgoingMessage,
  type FormattedCommandType,
  // Exported types used by external consumers
  SafeCommandType,
  UnsafeCommandRequest,
  CommandResponse,
  // Connection & diagnostics types
  type HealthCheckResult,
  type MessageStats,
  type DisconnectionRecord,
  type VmConnection,
  type OutboundMessage,
} from './socket-watcher/types'

// Re-export types for backward compatibility with external consumers
export type {
  SafeCommandType,
  UnsafeCommandRequest,
  CommandResponse,
  BaseMessage,
  ErrorMessage,
  MetricsMessage,
  ErrorReportMessage,
  ResponseMessage,
  CircuitBreakerStateMessage,
  KeepAliveMessage,
  KeepAliveRequestMessage,
  FirewallEventMessage,
  ScriptCompletionMessage,
  RequestPendingScriptsMessage,
  PendingScriptsResponseMessage,
  PendingScriptInfo,
  HealthCheckResult,
  MessageStats,
  DisconnectionRecord,
  VmConnection,
  OutboundMessage,
  ResponseData,
  OutgoingMessage,
  FormattedCommandType,
}


/**
 * A node-hosted VM's connection as seen from the master: there is NO local
 * socket (the real socket lives on the node); the node relays state + freshness.
 */
interface RemoteVmConnection {
  vmId: string
  nodeId: string
  isConnected: boolean
  reconnectAttempts: number
  lastMessageTime: Date
  /** Date.now() of the last telemetry POST that referenced this VM — drives staleness. */
  lastReportAt: number
  droppedFrames: number
  /**
   * Phase 2: commands awaiting a `response` forwarded from the node. Correlation
   * stays on the master (single source of truth); the node just relays the signed
   * envelope out and the guest's `response` back. Preserved across connState
   * updates and rejected when the connection is pruned/expired.
   */
  pendingCommands: Map<string, {
    resolve: (value: CommandResponse) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>
}

export class VirtioSocketWatcherService extends EventEmitter {
  private prisma: typeof prisma
  private vmEventManager?: VmEventManager
  private queueManager?: VMHealthQueueManager
  private connections: Map<string, VmConnection> = new Map()
  private socketDir: string
  private debug: Logger

  // Sub-modules
  private metricsHandler: MetricsHandler
  private commandDispatcher: CommandDispatcher
  private keepAliveManager: KeepAliveManager
  private messageRouter: MessageRouter
  private connectionManager: ConnectionManager
  private healthMonitor: HealthMonitor

  // One-time guard so a missing master secret warns once, not per message.
  private warnedNoAgentSecret = false

  // ── Multi-node Phase 1: node-hosted VM telemetry ──────────────────────────
  // A compute node runs its VMs' QEMU (and their infiniservice sockets) on ITS
  // OWN filesystem, which this master's chokidar watcher never sees. The node's
  // NodeTelemetryRelay forwards those guests' metrics + connection state to the
  // master via POST /cluster/telemetry, which lands here. We keep a parallel Map
  // of REMOTE connections (no local socket) that merges into getConnectionStats()
  // and drives `agent_connections`/`metrics:update` for node-hosted VMs exactly
  // like local ones. See services/node + routes/cluster.ts (telemetry route).
  private remoteConnections: Map<string, RemoteVmConnection> = new Map()
  // Per-node dedup cursor: drop frames already ingested when a node re-sends a
  // batch after a lost ack. Reset when the node's relay epoch changes (restart).
  private remoteSeqCursor: Map<string, { epoch: string, maxSeq: number }> = new Map()
  private remoteSweepTimer: NodeJS.Timeout | null = null

  constructor(prismaClient: typeof prisma) {
    super()
    this.prisma = prismaClient
    this.socketDir = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'sockets')
    this.debug = logger.child({ module: 'infinibay:virtio-socket' })

    // Read configuration from environment
    const keepAliveInterval = (() => {
      const parsed = Number(process.env.VIRTIO_KEEP_ALIVE_INTERVAL_MS)
      return (process.env.VIRTIO_KEEP_ALIVE_INTERVAL_MS !== undefined && !isNaN(parsed)) ? parsed : 120000
    })()
    const maxReconnectAttempts = Number(process.env.VIRTIO_MAX_RECONNECT_ATTEMPTS) || 15
    const reconnectBaseDelay = Number(process.env.VIRTIO_RECONNECT_BASE_DELAY_MS) || 3000
    const maxReconnectDelay = Number(process.env.VIRTIO_MAX_RECONNECT_DELAY_MS) || 120000
    const messageTimeout = Number(process.env.VIRTIO_MESSAGE_TIMEOUT_MS) || 900000
    const pingInterval = Number(process.env.VIRTIO_PING_INTERVAL_MS) || 60000

    // 1. Initialize metrics handler — emitter is `this` (EventEmitter)
    this.metricsHandler = new MetricsHandler({
      debug: this.debug,
      prisma: this.prisma,
      getVmEventManager: () => this.vmEventManager,
      emitter: this,
    })

    // 2. Initialize health monitor — owns periodic staleness/quality checks
    this.healthMonitor = new HealthMonitor(
      { messageTimeout, pingInterval, keepAliveInterval },
      { debug: this.debug }
    )

    // 3. Initialize keep-alive manager — shares the connections Map via reference
    this.keepAliveManager = new KeepAliveManager({
      debug: this.debug,
      connections: this.connections,
      sendMessage: (conn, msg) => this.sendMessage(conn, msg),
      emitter: this,
      keepAliveInterval,
    })

    // 4. Initialize message router — handles incoming socket data parsing and dispatching
    this.messageRouter = new MessageRouter({
      debug: this.debug,
      connections: this.connections,
      metricsHandler: this.metricsHandler,
      keepAliveManager: this.keepAliveManager,
      sendMessage: (conn, msg) => this.sendMessage(conn, msg),
      handleErrorReport: (conn, report) => this.connectionManager.handleErrorReport(conn, report),
      handleCircuitBreakerStateChange: (conn, msg) => this.connectionManager.handleCircuitBreakerStateChange(conn, msg),
      handleFirewallEvent: (vmId, msg) => this.handleFirewallEvent(vmId, msg),
      handleScriptCompletion: (vmId, msg) => this.handleScriptCompletion(vmId, msg),
      handleRequestPendingScripts: (vmId, msg, conn) => this.handleRequestPendingScripts(vmId, msg, (m) => this.sendMessage(conn, m)),
      handleAgentEvent: (vmId, msg) => this.handleAgentEvent(vmId, msg),
    })

    // 5. Initialize connection manager — owns the filesystem watcher and connection lifecycle
    this.connectionManager = new ConnectionManager({
      debug: this.debug,
      prisma: this.prisma,
      connections: this.connections,
      keepAliveManager: this.keepAliveManager,
      healthMonitor: this.healthMonitor,
      metricsHandler: this.metricsHandler,
      handleSocketData: (conn, data) => this.messageRouter.handleSocketData(conn, data),
      processHealthCheckQueue: (conn) => this.processHealthCheckQueue(conn),
      getVmEventManager: () => this.vmEventManager,
      getQueueManager: () => this.queueManager,
      getIpDetectionStats: () => ({ totalVmsWithIPs: 0, recentIPUpdates: 0 }),
      emitter: this,
      socketDir: this.socketDir,
      maxReconnectAttempts,
      reconnectBaseDelay,
      maxReconnectDelay,
      messageTimeout,
      pingInterval,
      keepAliveInterval,
    })

    // 6. Initialize command dispatcher — shares the connections Map via reference
    this.commandDispatcher = new CommandDispatcher({
      debug: this.debug,
      connections: this.connections,
      reconnectFn: (vmId: string, socketPath: string) => this.connectionManager.connectToVm(vmId, socketPath),
      sendMessage: (conn, msg) => this.sendMessage(conn, msg),
      // Phase 2: route commands for node-hosted VMs to the owning node (the master
      // signs; the node relays). Correlation lives on the remote connection's own
      // pendingCommands map, resolved when its `response` frame is ingested.
      getRemoteTarget: (vmId: string) => {
        const rc = this.remoteConnections.get(vmId)
        return rc ? { isConnected: rc.isConnected, pendingCommands: rc.pendingCommands } : undefined
      },
      sendToNode: (vmId: string, message: OutboundMessage) => this.sendSignedToNode(vmId, message),
    })

    // Log timeout configuration for debugging
    this.debug.info(`VirtIO timeout configuration: messageTimeout=${messageTimeout}ms, pingInterval=${pingInterval}ms, keepAliveInterval=${keepAliveInterval}ms, reconnectBaseDelay=${reconnectBaseDelay}ms, maxReconnectDelay=${maxReconnectDelay}ms, maxReconnectAttempts=${maxReconnectAttempts}`)
  }

  // Initialize the service with optional dependencies
  initialize(vmEventManager?: VmEventManager, queueManager?: VMHealthQueueManager): void {
    this.vmEventManager = vmEventManager
    this.queueManager = queueManager
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Service lifecycle — delegated to ConnectionManager
  // ──────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Expire node-hosted VM connections whose node stopped reporting (node crash /
    // network partition). The node can't announce its own death, so this timer is
    // the only thing that flips its VMs to disconnected in the fleet views.
    if (!this.remoteSweepTimer) {
      this.remoteSweepTimer = setInterval(() => this.expireStaleRemote(), 15000)
      if (typeof this.remoteSweepTimer.unref === 'function') this.remoteSweepTimer.unref()
    }
    return this.connectionManager.start()
  }

  async stop(): Promise<void> {
    if (this.remoteSweepTimer) {
      clearInterval(this.remoteSweepTimer)
      this.remoteSweepTimer = null
    }
    return this.connectionManager.stop()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Remote (node-hosted VM) telemetry ingestion — multi-node Phase 1
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Ingest one telemetry batch forwarded by a compute node's NodeTelemetryRelay.
   * `nodeId` is the AUTHENTICATED calling node (resolved from its mTLS cert CN /
   * token in routes/cluster.ts) and every vmId has ALREADY been ownership-gated
   * to that node by the route (G0) — so we trust the vmIds here.
   *
   * Guest messages are fed into the SAME vmId-keyed handlers used for local VMs
   * (metrics → DB + `metrics:update`; agent_event / script_completion /
   * firewall_event), so a node-hosted VM behaves identically to a master-hosted
   * one from the frontend's perspective.
   */
  public async ingestRemoteTelemetry(
    nodeId: string,
    payload: {
      epoch?: string
      snapshot?: boolean
      frames?: Array<{ vmId?: unknown, seq?: unknown, message?: unknown }>
      connections?: Array<{ vmId?: unknown, isConnected?: unknown, reconnectAttempts?: unknown, lastMessageTime?: unknown, droppedFrames?: unknown }>
    }
  ): Promise<{ accepted: number, ackSeq: number }> {
    const now = Date.now()

    // Apply connection state first so a VM referenced by a frame is already
    // registered/fresh (and so `agent_connections` fires before its metrics).
    if (Array.isArray(payload.connections)) {
      this.applyRemoteConnState(nodeId, payload.connections, payload.snapshot === true, now)
    }

    const frames = Array.isArray(payload.frames) ? payload.frames : []
    const epoch = typeof payload.epoch === 'string' ? payload.epoch : ''
    const cursor = this.remoteSeqCursor.get(nodeId)
    // A changed epoch means the node's relay restarted (seq reset to 0) — start over.
    let maxSeq = (cursor && cursor.epoch === epoch) ? cursor.maxSeq : 0

    let accepted = 0
    for (const frame of frames) {
      if (!frame || typeof frame.vmId !== 'string' || frame.message == null || typeof frame.message !== 'object') continue
      const seq = typeof frame.seq === 'number' ? frame.seq : undefined
      if (seq !== undefined && seq <= maxSeq) continue // duplicate — already ingested
      await this.ingestRemoteMessage(frame.vmId, frame.message as BaseMessage, now)
      if (seq !== undefined && seq > maxSeq) maxSeq = seq
      accepted++
    }

    this.remoteSeqCursor.set(nodeId, { epoch, maxSeq })
    return { accepted, ackSeq: maxSeq }
  }

  /** Route one forwarded guest message to the existing vmId-keyed handlers. */
  private async ingestRemoteMessage(vmId: string, message: BaseMessage, now: number): Promise<void> {
    const rc = this.remoteConnections.get(vmId)
    if (rc) {
      rc.lastMessageTime = new Date()
      rc.lastReportAt = now
    }
    try {
      switch (message.type) {
        case 'metrics':
          await this.metricsHandler.handleFirstInfiniserviceMessage(vmId)
          await this.metricsHandler.storeMetrics(vmId, message as MetricsMessage)
          break
        case 'agent_event':
          await this.handleAgentEvent(vmId, message as AgentEventMessage)
          break
        case 'script_completion':
          await this.handleScriptCompletion(vmId, message as ScriptCompletionMessage)
          break
        case 'firewall_event':
          await this.handleFirewallEvent(vmId, message as FirewallEventMessage)
          break
        case 'response':
          // Phase 2: a command result relayed back — resolve the pending command.
          await this.ingestRemoteResponse(vmId, message as ResponseMessage)
          break
        case 'request_pending_scripts':
          // Phase 2: the guest is asking for first-boot/scheduled scripts — answer
          // by relaying a signed pending_scripts_response back through the node.
          await this.handleRequestPendingScripts(
            vmId,
            message as RequestPendingScriptsMessage,
            (m) => {
              this.sendSignedToNode(vmId, m).catch(e =>
                this.debug.error(`Failed to relay pending_scripts_response to node-hosted VM ${vmId}: ${(e as Error).message}`))
            }
          )
          break
        default:
          this.debug.debug(`Ignoring forwarded message type '${message.type}' for remote VM ${vmId}`)
      }
    } catch (error) {
      this.debug.error(`Failed to ingest remote ${message.type} for VM ${vmId}: ${(error as Error).message}`)
    }
  }

  /** Upsert node-hosted VM connection state; emit `agent_connections` on change. */
  private applyRemoteConnState(
    nodeId: string,
    states: Array<{ vmId?: unknown, isConnected?: unknown, reconnectAttempts?: unknown, lastMessageTime?: unknown, droppedFrames?: unknown }>,
    snapshot: boolean,
    now: number
  ): void {
    const seen = new Set<string>()
    for (const s of states) {
      if (!s || typeof s.vmId !== 'string') continue
      seen.add(s.vmId)
      const prev = this.remoteConnections.get(s.vmId)
      const isConnected = s.isConnected === true
      const parsed = typeof s.lastMessageTime === 'string' ? new Date(s.lastMessageTime) : undefined
      const lastMessageTime = parsed && !isNaN(parsed.getTime()) ? parsed : (prev?.lastMessageTime ?? new Date())
      this.remoteConnections.set(s.vmId, {
        vmId: s.vmId,
        nodeId,
        isConnected,
        reconnectAttempts: typeof s.reconnectAttempts === 'number' ? s.reconnectAttempts : (prev?.reconnectAttempts ?? 0),
        lastMessageTime,
        lastReportAt: now,
        droppedFrames: typeof s.droppedFrames === 'number' ? s.droppedFrames : (prev?.droppedFrames ?? 0),
        // Preserve in-flight command correlation across state updates (a NEW Map
        // here would orphan pending commands and hang their callers until timeout).
        pendingCommands: prev?.pendingCommands ?? new Map()
      })
      if (!prev || prev.isConnected !== isConnected) {
        emitAdminResourceEvent('agent_connections', 'update', { vmId: s.vmId, isConnected })
      }
    }

    // On a FULL snapshot, a VM this node previously reported but omits now was
    // destroyed/migrated away — drop it (and announce the disconnect if needed).
    if (snapshot) {
      for (const [vmId, rc] of this.remoteConnections) {
        if (rc.nodeId === nodeId && !seen.has(vmId)) {
          this.remoteConnections.delete(vmId)
          this.rejectRemotePending(rc, 'VM is gone')
          if (rc.isConnected) emitAdminResourceEvent('agent_connections', 'update', { vmId, isConnected: false })
        }
      }
    }
  }

  /** Periodic sweep: a node that stopped POSTing telemetry is treated as gone. */
  private expireStaleRemote(): void {
    const now = Date.now()
    const staleMs = Number(process.env.REMOTE_TELEMETRY_STALE_MS) || 45000
    const removeMs = Number(process.env.REMOTE_TELEMETRY_REMOVE_MS) || 300000
    for (const [vmId, rc] of this.remoteConnections) {
      const age = now - rc.lastReportAt
      if (age > removeMs) {
        this.remoteConnections.delete(vmId)
        this.rejectRemotePending(rc, 'node telemetry expired')
        if (rc.isConnected) emitAdminResourceEvent('agent_connections', 'update', { vmId, isConnected: false })
        continue
      }
      if (rc.isConnected && age > staleMs) {
        rc.isConnected = false
        this.debug.warn(`Remote VM ${vmId} (node ${rc.nodeId}) telemetry stale for ${Math.round(age / 1000)}s — marking disconnected`)
        emitAdminResourceEvent('agent_connections', 'update', { vmId, isConnected: false })
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Remote command relay (Phase 2) — master signs, node writes the opaque bytes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sign a message for a node-hosted VM and relay it to the owning node, which
   * writes the opaque bytes to that VM's local guest socket. The HMAC secret never
   * leaves the master. Throws if unsignable / node unreachable / undeliverable —
   * the CommandDispatcher turns that into a rejected command promise.
   */
  private async sendSignedToNode(vmId: string, message: OutboundMessage): Promise<void> {
    const envelope = signForVm(vmId, message)
    if (!envelope) {
      throw new Error('INFINISERVICE_HMAC_MASTER_SECRET is not set — cannot sign agent commands for node-hosted VMs')
    }
    const rc = this.remoteConnections.get(vmId)
    if (!rc) throw new Error(`No remote connection for VM ${vmId}`)
    const node = await this.prisma.node.findUnique({
      where: { id: rc.nodeId },
      select: { name: true, address: true, agentPort: true }
    })
    if (!node || !node.address) {
      throw new Error(`Node ${rc.nodeId} hosting VM ${vmId} has no reachable address`)
    }
    await deliverAgentCommandToNode({ name: node.name, address: node.address, agentPort: node.agentPort }, vmId, envelope)
  }

  /** Resolve a forwarded command `response` against the remote VM's pending map. */
  private async ingestRemoteResponse(vmId: string, response: ResponseMessage): Promise<void> {
    const rc = this.remoteConnections.get(vmId)
    const pending = rc?.pendingCommands.get(response.id)

    // Mirror MessageRouter: for process commands the payload may arrive as stdout JSON.
    let data = response.data
    if (!data && response.stdout && response.command_type &&
        ['ProcessList', 'ProcessTop', 'ProcessKill'].includes(response.command_type)) {
      try { data = JSON.parse(response.stdout) } catch { /* leave data undefined */ }
    }

    const commandResponse: CommandResponse = {
      id: response.id,
      success: response.success,
      exit_code: response.exit_code,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
      execution_time_ms: response.execution_time_ms,
      command_type: response.command_type,
      data: data || response.data,
      error: response.error
    }

    if (pending && rc) {
      clearTimeout(pending.timeout)
      pending.resolve(commandResponse)
      rc.pendingCommands.delete(response.id)
    } else {
      this.debug.warn(`Received response for unknown/expired remote command ${response.id} from VM ${vmId}`)
    }

    // Auto-check emissions work the same for node-hosted VMs (DB-keyed by vmId).
    await this.metricsHandler.handleAutoCheckResponse(vmId, response, data || null)
  }

  /** Reject and clear all pending commands for a remote VM that went away. */
  private rejectRemotePending(rc: RemoteVmConnection, reason: string): void {
    for (const [id, pending] of rc.pendingCommands) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`Command ${id} aborted: ${reason}`))
    }
    rc.pendingCommands.clear()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Message sending
  // ──────────────────────────────────────────────────────────────────────────

  private sendMessage(connection: VmConnection, message: OutboundMessage): void {
    const sendStartTime = Date.now()

    if (!connection.isConnected) {
      this.debug.warn(`Cannot send message to disconnected VM ${connection.vmId} (quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%)`)
      connection.messageStats.errors++
      return
    }

    // SECURITY: every host→agent message is HMAC-signed. The agent rejects
    // anything unsigned (fail-closed), so we must sign here — the single choke
    // point all outbound traffic funnels through. Without a master secret we
    // cannot authenticate; sending an unsigned message would only be dropped by
    // the agent, so refuse and warn once.
    const envelope = signForVm(connection.vmId, message)
    if (!envelope) {
      if (!this.warnedNoAgentSecret) {
        this.warnedNoAgentSecret = true
        this.debug.error(
          'INFINISERVICE_HMAC_MASTER_SECRET is not set: cannot sign agent messages. ' +
          'All host→agent commands are being withheld (the agent rejects unsigned messages). ' +
          'Configure the master secret to enable command delivery.'
        )
      }
      connection.messageStats.errors++
      return
    }

    try {
      const messageStr = JSON.stringify(envelope) + '\n'
      const messageSize = Buffer.byteLength(messageStr, 'utf8')

      this.debug.debug(`📤 Sending signed message to VM ${connection.vmId}: size=${messageSize} bytes, type=${message.type || 'unknown'}`)
      // Payload preview suppressed: outbound messages can carry secrets
      // (e.g. the domain-join password). Log only the size, never the body.
      this.debug.debug(`Message payload suppressed (${messageSize} bytes)`)

      connection.socket.write(messageStr, (error) => {
        if (error) {
          this.debug.error(`Failed to write message to VM ${connection.vmId}: ${error.message}`)
          connection.transmissionFailureCount++
          connection.messageStats.errors++
        }
      })

      // Update transmission statistics
      connection.messageStats.sent++
      connection.messageStats.totalBytes += messageSize
      connection.lastSuccessfulTransmission = new Date()

      const transmissionTime = Date.now() - sendStartTime
      if (transmissionTime > 100) { // Log slow transmissions
        this.debug.warn(`Slow message transmission to VM ${connection.vmId}: ${transmissionTime}ms for ${messageSize} bytes`)
      }

      this.debug.debug(`✅ Message sent to VM ${connection.vmId} in ${transmissionTime}ms (total sent: ${connection.messageStats.sent})`)
    } catch (error) {
      connection.messageStats.errors++
      connection.transmissionFailureCount++

      // Update connection quality on transmission failure
      connection.connectionQuality = 'poor'
      connection.connectionStabilityScore = Math.max(0, connection.connectionStabilityScore - 15)

      this.debug.error(`Failed to send message to VM ${connection.vmId}: ${error} (failures: ${connection.transmissionFailureCount}, quality: ${connection.connectionQuality})`)
      this.debug.debug(`Transmission failure context: uptime=${Date.now() - connection.connectionStartTime.getTime()}ms, stability=${connection.connectionStabilityScore}%`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Command dispatching — delegated to CommandDispatcher
  // ──────────────────────────────────────────────────────────────────────────

  public async sendSafeCommand(
    vmId: string,
    commandType: SafeCommandType,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendSafeCommand(vmId, commandType, timeout)
  }

  public async sendUnsafeCommand(
    vmId: string,
    rawCommand: string,
    options: Partial<UnsafeCommandRequest> = {},
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendUnsafeCommand(vmId, rawCommand, options, timeout)
  }

  public async sendPackageCommand(
    vmId: string,
    action: 'PackageList' | 'PackageInstall' | 'PackageRemove' | 'PackageUpdate' | 'PackageSearch',
    packageName?: string,
    timeout: number = 45000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendPackageCommand(vmId, action, packageName, timeout)
  }

  public async sendProcessCommand(
    vmId: string,
    action: 'ProcessList' | 'ProcessKill' | 'ProcessTop',
    params?: { pid?: number; force?: boolean; limit?: number; sort_by?: string },
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendProcessCommand(vmId, action, params, timeout)
  }

  public async getUserList(
    vmId: string,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.getUserList(vmId, timeout)
  }

  public async sendMaintenancePowerShellScript(
    vmId: string,
    script: string,
    options: {
      scriptType?: string
      timeoutSeconds?: number
      workingDirectory?: string
      environmentVars?: Record<string, string>
      runAsAdmin?: boolean
    } = {},
    timeout: number = 60000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendMaintenancePowerShellScript(vmId, script, options, timeout)
  }

  public async sendMaintenanceTask(
    vmId: string,
    taskType: string,
    taskName: string,
    parameters?: Record<string, unknown>,
    options: {
      validateBefore?: boolean
      validateAfter?: boolean
    } = {},
    timeout: number = 60000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendMaintenanceTask(vmId, taskType, taskName, parameters, options, timeout)
  }

  public async sendValidateSystemHealth(
    vmId: string,
    checkName?: string,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendValidateSystemHealth(vmId, checkName, timeout)
  }

  public async sendCleanTemporaryFiles(
    vmId: string,
    targets?: string[],
    timeout: number = 45000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendCleanTemporaryFiles(vmId, targets, timeout)
  }

  public async sendUpdateSystemSoftware(
    vmId: string,
    packageName?: string,
    timeout: number = 180000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendUpdateSystemSoftware(vmId, packageName, timeout)
  }

  public async sendRestartServices(
    vmId: string,
    serviceName?: string,
    timeout: number = 60000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendRestartServices(vmId, serviceName, timeout)
  }

  public async sendCheckSystemIntegrity(
    vmId: string,
    timeout: number = 120000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendCheckSystemIntegrity(vmId, timeout)
  }

  /** In-guest OS reboot via the agent (preferred over a cold QMP/ACPI restart). */
  public async sendRebootSystem(
    vmId: string,
    force: boolean = false,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.sendRebootSystem(vmId, force, timeout)
  }

  public async executeCommandWithRetry(
    vmId: string,
    commandBuilder: () => Promise<CommandResponse>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<CommandResponse> {
    return this.commandDispatcher.executeCommandWithRetry(vmId, commandBuilder, maxRetries, retryDelay)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection queries — delegated to ConnectionManager
  // ──────────────────────────────────────────────────────────────────────────

  public getConnectionStats() {
    const local = this.connectionManager.getConnectionStats()
    if (this.remoteConnections.size === 0) return local

    // Shape node-hosted VMs like local connection entries so the same
    // mapToVmConnectionInfo() in the resolver renders them. The node is a passive
    // reader, so keep-alive RTT is unavailable (null/N/A) — an honest degradation.
    const remote: any[] = Array.from(this.remoteConnections.values()).map(rc => ({
      vmId: rc.vmId,
      isConnected: rc.isConnected,
      reconnectAttempts: rc.reconnectAttempts,
      lastMessageTime: rc.lastMessageTime,
      errorCount: 0,
      connectionQuality: rc.isConnected ? 'good' : 'critical',
      remote: true,
      nodeId: rc.nodeId,
      keepAlive: {
        sentCount: 0,
        receivedCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        averageRtt: 0,
        lastSent: undefined,
        lastReceived: undefined,
        lastFailure: undefined,
        successRate: 'N/A'
      }
    }))

    return {
      ...local,
      totalConnections: local.totalConnections + remote.length,
      activeConnections: local.activeConnections + remote.filter(r => r.isConnected).length,
      connections: [...local.connections, ...remote] as any[]
    }
  }

  public getKeepAliveMetrics(vmId: string) {
    return this.keepAliveManager.getKeepAliveMetrics(vmId)
  }

  public getPendingCommands(vmId: string): string[] {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return []
    }
    return Array.from(connection.pendingCommands.keys())
  }

  public cancelCommand(vmId: string, commandId: string): boolean {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return false
    }

    const pendingCommand = connection.pendingCommands.get(commandId)
    if (!pendingCommand) {
      return false
    }

    clearTimeout(pendingCommand.timeout)
    pendingCommand.reject(new Error(`Command ${commandId} cancelled by user`))
    connection.pendingCommands.delete(commandId)
    this.debug.info(`Command ${commandId} cancelled for VM ${vmId}`)
    return true
  }

  public cancelAllCommands(vmId: string): number {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return 0
    }

    const count = connection.pendingCommands.size
    for (const [commandId, pending] of connection.pendingCommands) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`Command ${commandId} cancelled`))
    }
    connection.pendingCommands.clear()
    this.debug.info(`Cancelled ${count} pending commands for VM ${vmId}`)
    return count
  }

  public isVmConnected(vmId: string): boolean {
    return this.connectionManager.isVmConnected(vmId)
  }

  public getServiceStatus(): boolean {
    return this.connectionManager.getServiceStatus()
  }

  public getConnectionDetails(vmId: string) {
    return this.connectionManager.getConnectionDetails(vmId)
  }

  async cleanupVmConnection(vmId: string): Promise<void> {
    return this.connectionManager.cleanupVmConnection(vmId)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Health check queue
  // ──────────────────────────────────────────────────────────────────────────

  private processHealthCheckQueue(connection: VmConnection): void {
    if (!this.queueManager) {
      this.debug.debug(`⚕️ No queue manager available for VM ${connection.vmId}, skipping health check queue processing`)
      return
    }

    this.debug.info(`⚕️ Processing health check queue for VM ${connection.vmId}`)

    // Process any queued health checks for this VM
    setImmediate(async () => {
      try {
        await this.queueManager!.processQueue(connection.vmId)
      } catch (error) {
        this.debug.error(`Failed to process health queue for VM ${connection.vmId}: ${error}`)
      }
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Firewall event handling
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handles firewall events from infiniservice (Windows Firewall monitoring)
   *
   * TODO: This feature requires infiniservice enhancement to monitor Windows Firewall logs
   * via Event Viewer (Security log, Event ID 5157 for blocked connections) or Windows
   * Filtering Platform (WFP) API. Currently, this is a placeholder for future implementation.
   *
   * For now, port conflict detection relies on heuristic analysis in PortConflictChecker.
   */
  private async handleFirewallEvent(vmId: string, message: FirewallEventMessage): Promise<void> {
    try {
      this.debug.info(`🔥 Firewall event received from VM ${vmId}: ${message.event_type} for port ${message.port}/${message.protocol}`)

      // Only store blocked connection events
      if (message.event_type === 'connection_blocked') {
        // Store in BlockedConnection table
        await this.prisma.blockedConnection.create({
          data: {
            machineId: vmId,
            port: message.port,
            protocol: message.protocol.toUpperCase(),
            processName: message.process_name || null,
            processId: message.process_id || null,
            attemptTime: new Date(message.timestamp),
            blockReason: `Windows Firewall blocked connection (rule: ${message.rule_name || 'unknown'})`,
            sourceIp: message.source_ip || null,
            ruleId: null // Will be populated if we can match to a FirewallRule
          }
        })

        this.debug.debug(`📝 Stored blocked connection for VM ${vmId}: port ${message.port}/${message.protocol} by process ${message.process_name || 'unknown'}`)

        // TODO: Emit event for real-time updates when vmEventManager supports firewall events
        // For now, the data is stored in the database and will be picked up by the next
        // recommendation cycle via PortConflictChecker
      }
    } catch (error) {
      // Non-critical error - log but don't throw
      this.debug.error(`Failed to handle firewall event for VM ${vmId}: ${error}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Agent event handling
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Persist a structured agent_event from infiniservice and dispatch it on the
   * realtime bus. ERROR-severity events are also logged so they show up in
   * the host log without needing the events tab open.
   */
  private async handleAgentEvent(vmId: string, message: AgentEventMessage): Promise<void> {
    try {
      const severity = (message.severity || 'info').toUpperCase() as
        'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
      const validSeverities = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])
      const safeSeverity = validSeverities.has(severity) ? severity : 'INFO'

      const occurredAt = message.timestamp ? new Date(message.timestamp) : new Date()
      const occurredAtSafe = isNaN(occurredAt.getTime()) ? new Date() : occurredAt

      // executionId is best-effort: if the agent reports one but it doesn't
      // exist in the DB (e.g. already deleted), persist with null instead of
      // failing the whole insert.
      let executionId: string | null = null
      if (message.executionId) {
        const exists = await this.prisma.scriptExecution.findUnique({
          where: { id: message.executionId },
          select: { id: true },
        })
        executionId = exists?.id ?? null
      }

      const created = await this.prisma.agentEvent.create({
        data: {
          machineId: vmId,
          severity: safeSeverity,
          source: (message.source || 'agent').slice(0, 64),
          message: message.message || '',
          executionId,
          context: (message.context as any) ?? null,
          occurredAt: occurredAtSafe,
        },
      })

      if (safeSeverity === 'ERROR') {
        this.debug.error(`🛰️ agent_event[${message.source}] vm=${vmId}: ${message.message}`)
      } else if (safeSeverity === 'WARN') {
        this.debug.warn(`🛰️ agent_event[${message.source}] vm=${vmId}: ${message.message}`)
      } else {
        this.debug.debug(`🛰️ agent_event[${message.source}] vm=${vmId}: ${message.message}`)
      }

      getEventManager().dispatchEvent('agentEvents', 'create', {
        id: created.id,
        machineId: vmId,
        severity: safeSeverity,
        source: created.source,
        message: created.message,
        executionId: created.executionId,
        occurredAt: created.occurredAt.toISOString(),
      })
    } catch (err) {
      this.debug.error(`Failed to persist agent_event from VM ${vmId}: ${(err as Error).message}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Script handling
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handles script completion messages from first-boot scripts executed via infiniservice.
   * Updates ScriptExecution records and emits WebSocket events.
   */
  private async handleScriptCompletion(vmId: string, message: ScriptCompletionMessage): Promise<void> {
    try {
      this.debug.info(`📜 Script completion received from VM ${vmId}: execution ${message.execution_id}`)

      // Find the ScriptExecution record
      const execution = await this.prisma.scriptExecution.findUnique({
        where: { id: message.execution_id },
        include: { script: true, machine: true }
      })

      if (!execution) {
        this.debug.warn(`Script execution ${message.execution_id} not found`)
        return
      }

      // Validate that the execution belongs to the same VM (security check)
      if (execution.machineId !== vmId) {
        this.debug.warn(`Script execution ${message.execution_id} machineId mismatch: expected ${vmId}, got ${execution.machineId}`)
        return
      }

      const now = new Date()

      // Determine status based on exit code (SUCCESS/FAILED/TIMEOUT)
      let status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' = message.exit_code === 0 ? 'SUCCESS' : 'FAILED'

      // Check if this is a repeating script
      const isRepeating = execution.repeatIntervalMinutes !== null && execution.repeatIntervalMinutes > 0

      // Wrap updates in transaction to avoid partial updates
      await this.prisma.$transaction(async (tx) => {
        const currentExecutionCount = execution.executionCount + 1
        const hasMoreExecutions = execution.maxExecutions === null || currentExecutionCount < execution.maxExecutions

        if (isRepeating && status === 'SUCCESS' && hasMoreExecutions) {
          const nextScheduledFor = new Date(now.getTime() + execution.repeatIntervalMinutes! * 60 * 1000)

          await tx.scriptExecution.update({
            where: { id: message.execution_id },
            data: {
              status: 'PENDING',
              lastExecutedAt: now,
              executionCount: currentExecutionCount,
              exitCode: message.exit_code,
              stdout: message.stdout,
              stderr: message.stderr,
              scheduledFor: nextScheduledFor,
              error: null
            }
          })

          this.debug.info(`Repeating script execution ${message.execution_id} completed (${currentExecutionCount}/${execution.maxExecutions || '∞'}), rescheduled for ${nextScheduledFor.toISOString()}`)
        } else {
          await tx.scriptExecution.update({
            where: { id: message.execution_id },
            data: {
              status,
              completedAt: now,
              exitCode: message.exit_code,
              stdout: message.stdout,
              stderr: message.stderr,
              error: status === 'SUCCESS' ? null : execution.error,
              ...(isRepeating ? {
                lastExecutedAt: now,
                executionCount: currentExecutionCount
              } : {})
            }
          })

          this.debug.info(`Script execution ${message.execution_id} completed with status ${status}`)
        }
      })

      // Emit WebSocket event
      const socketService = getSocketService()
      const targetUsers = [execution.triggeredById, execution.machine.userId].filter(Boolean)

      targetUsers.forEach(userId => {
        socketService.sendToUser(userId!, 'scripts', 'execution_completed', {
          status: 'success',
          data: {
            executionId: execution.id,
            scriptId: execution.scriptId,
            machineId: execution.machineId,
            status,
            exitCode: message.exit_code
          }
        })
      })
    } catch (error) {
      this.debug.error(`Failed to handle script completion: ${error}`)
    }
  }

  /**
   * Shared core for delivering PENDING first-boot/scheduled scripts to a VM:
   * query → filter (maxExecutions / repeatInterval) → claim+prepare each in a
   * transaction → send a `pending_scripts_response`. Both the request-driven
   * (handleRequestPendingScripts) and proactive (pushPendingScriptsToVM) paths
   * share this; they differ ONLY in the scheduledFor bound (passed in) plus their
   * logging and return contract (kept at the call sites).
   *
   * @param now - the host "now" used for filter/transaction/response timestamps.
   * @param scheduledForBound - upper bound for `scheduledFor` eligibility (request
   *   path passes a clock-skew-bounded time; push path passes `now`).
   * @returns number of scripts sent.
   */
  private async dispatchPendingScripts(
    vmId: string,
    send: (message: OutboundMessage) => void,
    now: Date,
    scheduledForBound: Date
  ): Promise<number> {
    // Query pending script executions
    const pendingExecutions = await this.prisma.scriptExecution.findMany({
      where: {
        machineId: vmId,
        status: 'PENDING',
        OR: [
          { scheduledFor: null },
          { scheduledFor: { lte: scheduledForBound } }
        ]
      },
      include: {
        script: true,
        machine: true
      },
      orderBy: [
        { order: 'asc' },
        { createdAt: 'asc' }
      ]
    })

    // Filter executions based on scheduling rules
    const eligibleExecutions = pendingExecutions.filter(execution => {
      if (execution.maxExecutions !== null && execution.executionCount >= execution.maxExecutions) {
        setImmediate(async () => {
          try {
            await this.prisma.scriptExecution.update({
              where: { id: execution.id },
              data: { status: 'SUCCESS', completedAt: now }
            })
            this.debug.info(`Marked execution ${execution.id} as SUCCESS (max executions reached)`)
          } catch (err) {
            this.debug.error(`Failed to mark execution ${execution.id} as SUCCESS: ${err}`)
          }
        })
        return false
      }

      if (execution.repeatIntervalMinutes) {
        if (execution.lastExecutedAt === null) {
          return true
        }

        const intervalMs = execution.repeatIntervalMinutes * 60 * 1000
        const timeSinceLastExecution = now.getTime() - execution.lastExecutedAt.getTime()

        if (timeSinceLastExecution < intervalMs) {
          return false
        }
      }

      return true
    })

    this.debug.info(`Found ${eligibleExecutions.length} pending scripts ready for execution`)

    // Process executions in transaction
    const scriptManager = new ScriptManager(this.prisma)
    const templateEngine = new TemplateEngine()
    const pendingScripts: PendingScriptInfo[] = []

    const result = await this.prisma.$transaction(async (tx) => {
      const successfullyUpdated: string[] = []

      for (const execution of eligibleExecutions) {
        try {
          const updated = await tx.scriptExecution.updateMany({
            where: {
              id: execution.id,
              status: 'PENDING'
            },
            data: {
              status: 'RUNNING',
              startedAt: now
            }
          })

          if (updated.count === 0) {
            this.debug.warn(`Execution ${execution.id} was already claimed by another request`)
            continue
          }

          successfullyUpdated.push(execution.id)

          const scriptWithContent = await scriptManager.getScript(execution.scriptId)

          const format = scriptWithContent.fileName.endsWith('.yaml') ? 'yaml' : 'json'
          const { ScriptParser } = await import('./scripts/ScriptParser')
          const parser = new ScriptParser()
          const parsed = format === 'yaml'
            ? parser.parseYAML(scriptWithContent.content)
            : parser.parseJSON(scriptWithContent.content)

          const interpolatedContent = templateEngine.interpolate(
            parsed.script,
            (execution.inputValues as Record<string, any>) || {}
          )

          pendingScripts.push({
            execution_id: execution.id,
            script_id: execution.scriptId,
            script_name: scriptWithContent.name,
            script_content: interpolatedContent,
            shell: execution.script.shell,
            execution_type: execution.executionType,
            input_values: (execution.inputValues as Record<string, any>) || {},
            timeout_seconds: 600,
            run_as: execution.executedAs
          })

          this.debug.debug(`Script ${scriptWithContent.name} (${execution.id}) prepared for execution`)
        } catch (error) {
          this.debug.error(`Failed to prepare script ${execution.scriptId}: ${error}`)
          await tx.scriptExecution.update({
            where: { id: execution.id },
            data: {
              status: 'FAILED',
              completedAt: now,
              error: `Failed to prepare script: ${error}`
            }
          })
        }
      }

      return { pendingScripts, successfullyUpdated }
    })

    // Send response to VM
    const response: PendingScriptsResponseMessage = {
      type: 'pending_scripts_response',
      timestamp: now.toISOString(),
      scripts: result.pendingScripts
    }

    send(response)
    return result.pendingScripts.length
  }

  /**
   * Handle request for pending script executions from InfiniService
   */
  private async handleRequestPendingScripts(vmId: string, msg: RequestPendingScriptsMessage, send: (message: OutboundMessage) => void): Promise<void> {
    try {
      this.debug.info(`📜 Pending scripts request received from VM ${vmId}`)

      // Use host time (not request_timestamp) to avoid clock skew issues
      const now = new Date()
      const requestTimestamp = new Date(msg.request_timestamp)

      // Bound request_timestamp to reasonable skew (±2 minutes)
      const maxSkewMs = 2 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - requestTimestamp.getTime())
      if (timeDiff > maxSkewMs) {
        this.debug.warn(`Clock skew detected: ${timeDiff}ms. Using host time instead.`)
      }
      const comparisonTime = timeDiff > maxSkewMs ? now : requestTimestamp

      const count = await this.dispatchPendingScripts(vmId, send, now, comparisonTime)
      this.debug.info(`Sent ${count} pending scripts to VM ${vmId}`)
    } catch (error) {
      this.debug.error(`Failed to handle pending scripts request: ${error}`)
    }
  }

  /**
   * Proactively push pending scripts to a specific VM without waiting for a request.
   */
  public async pushPendingScriptsToVM(vmId: string): Promise<{ success: boolean; scriptCount: number; error?: string }> {
    try {
      // 1. Resolve a send channel — a local socket, else a node-hosted VM's relay.
      let send: ((message: OutboundMessage) => void) | null = null
      const connection = this.connections.get(vmId)
      if (connection && connection.isConnected) {
        send = (m) => this.sendMessage(connection, m)
      } else {
        const rc = this.remoteConnections.get(vmId)
        if (rc && rc.isConnected) {
          send = (m) => {
            this.sendSignedToNode(vmId, m).catch(e =>
              this.debug.error(`Failed to relay pending_scripts_response to node-hosted VM ${vmId}: ${(e as Error).message}`))
          }
        }
      }
      if (!send) {
        return { success: false, scriptCount: 0, error: 'VM not connected' }
      }

      this.debug.info(`Pushing pending scripts to VM ${vmId}`)

      // 2. Dispatch. The push path has no request_timestamp / clock-skew
      //    handling, so it uses `now` as the scheduledFor bound.
      const now = new Date()
      const count = await this.dispatchPendingScripts(vmId, send, now, now)
      this.debug.info(`Pushed ${count} pending scripts to VM ${vmId}`)

      // 3. Return Result
      return { success: true, scriptCount: count }
    } catch (error) {
      this.debug.error(`Failed to push pending scripts to VM: ${error}`)
      return { success: false, scriptCount: 0, error: (error as Error).message }
    }
  }
}

// Singleton instance management
let virtioSocketWatcherService: VirtioSocketWatcherService | null = null

export const createVirtioSocketWatcherService = (prismaClient: typeof prisma): VirtioSocketWatcherService => {
  if (!virtioSocketWatcherService) {
    virtioSocketWatcherService = new VirtioSocketWatcherService(prismaClient)
  }
  return virtioSocketWatcherService
}

export const getVirtioSocketWatcherService = (): VirtioSocketWatcherService => {
  if (!virtioSocketWatcherService) {
    throw new Error('VirtioSocketWatcherService not initialized. Call createVirtioSocketWatcherService first.')
  }
  return virtioSocketWatcherService
}
