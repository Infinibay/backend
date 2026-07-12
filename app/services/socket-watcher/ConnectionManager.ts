import { Logger } from 'winston'
import type {
  VmConnection,
  MessageStats,
  HealthCheckResult,
  DisconnectionRecord,
  ErrorReportMessage,
  CircuitBreakerStateMessage,
} from './types'
import { KeepAliveManager } from './KeepAliveManager'
import type { MetricsHandler } from './MetricsHandler'
import { HealthMonitor, updateConnectionStabilityScore } from './HealthMonitor'
import { emitAdminResourceEvent } from '../AdminBroadcastEventManager'

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as chokidar from 'chokidar'

// ────────────────────────────────────────────────────────────────────────────────
// Types for injected dependencies
// ────────────────────────────────────────────────────────────────────────────────

export interface ConnectionManagerDeps {
  debug: Logger
  prisma: any
  connections: Map<string, VmConnection>
  keepAliveManager: KeepAliveManager
  healthMonitor: HealthMonitor
  metricsHandler: MetricsHandler
  /** Callback to process incoming socket data (delegates to MessageRouter) */
  handleSocketData: (connection: VmConnection, data: Buffer) => void
  /** Callback to process health check queue when VM connects */
  processHealthCheckQueue: (connection: VmConnection) => void
  /** Callback to get the VM event manager (may be undefined) */
  getVmEventManager: () => any
  /** Callback to get the health queue manager (may be undefined) */
  getQueueManager: () => any
  /** Callback to update IP detection stats — used in getConnectionStats */
  getIpDetectionStats: () => { totalVmsWithIPs: number; recentIPUpdates: number }
  /** Emitter for keepAliveFailure / keepAliveCritical / keepAliveRecovered / etc. */
  emitter: NodeJS.EventEmitter
  /** Base directory for sockets */
  socketDir: string
  /** Configuration constants */
  maxReconnectAttempts: number
  reconnectBaseDelay: number
  maxReconnectDelay: number
  messageTimeout: number
  pingInterval: number
  keepAliveInterval: number
}

// ────────────────────────────────────────────────────────────────────────────────
// Return types for public queries
// ────────────────────────────────────────────────────────────────────────────────

export interface ConnectionDetails {
  isConnected: boolean
  socketPath?: string
  lastMessageTime?: Date
  errorCount?: number
}

export interface ConnectionStats {
  totalConnections: number
  activeConnections: number
  connections: Array<{
    vmId: string
    isConnected: boolean
    reconnectAttempts: number
    lastMessageTime: Date
    errorCount: number
    lastErrorType?: string
    pendingCommands: number
    connectionDuration: number
    messageStats: MessageStats
    connectionQuality: string
    connectionStabilityScore: number
    recentHealthChecks: HealthCheckResult[]
    transmissionFailures: number
    lastSuccessfulTransmission?: Date
    disconnectionCount: number
    messageTypeCounts: Record<string, number>
    errorClassificationHistory: ErrorReportMessage[]
    recoverableErrorCount: number
    fatalErrorCount: number
    lastErrorReport?: ErrorReportMessage
    lastRecoveryAttempt?: Date
    keepAliveSequence: number
    keepAliveLastSent?: Date
    keepAliveLastReceived?: Date
    keepAliveFailureCount: number
    keepAliveRoundTripTime?: number
    keepAlive: {
      sentCount: number
      receivedCount: number
      failureCount: number
      consecutiveFailures: number
      averageRtt: number
      lastSent?: Date
      lastReceived?: Date
      lastFailure?: Date
      successRate: string
    }
  }>
  ipDetectionStats: {
    totalVmsWithIPs: number
    recentIPUpdates: number
  }
  qualityDistribution: {
    excellent: number
    good: number
    poor: number
    critical: number
  }
  overallHealth: {
    averageStabilityScore: number
    totalMessages: number
    totalErrors: number
    errorRate: number
  }
  errorClassification: {
    totalRecoverableErrors: number
    totalFatalErrors: number
    errorPatternAnalysis: Record<string, number>
    recoverySuccessRate: number
    averageRetryAttempts: number
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// ConnectionManager
// ────────────────────────────────────────────────────────────────────────────────

export class ConnectionManager {
  private readonly debug: Logger
  private readonly prisma: any
  private readonly connections: Map<string, VmConnection>
  private readonly keepAliveManager: KeepAliveManager
  private readonly healthMonitor: HealthMonitor
  private readonly metricsHandler: MetricsHandler
  private readonly handleSocketData: (connection: VmConnection, data: Buffer) => void
  private readonly processHealthCheckQueue: (connection: VmConnection) => void
  private readonly getVmEventManager: () => any
  private readonly getQueueManager: () => any
  private readonly getIpDetectionStats: () => { totalVmsWithIPs: number; recentIPUpdates: number }
  private readonly emitter: NodeJS.EventEmitter

  private readonly socketDir: string
  private readonly maxReconnectAttempts: number
  private readonly reconnectBaseDelay: number
  private readonly maxReconnectDelay: number
  private readonly messageTimeout: number
  private readonly pingInterval: number

  private watcher?: chokidar.FSWatcher
  private isRunning: boolean = false

  constructor(deps: ConnectionManagerDeps) {
    this.debug = deps.debug
    this.prisma = deps.prisma
    this.connections = deps.connections
    this.keepAliveManager = deps.keepAliveManager
    this.healthMonitor = deps.healthMonitor
    this.metricsHandler = deps.metricsHandler
    this.handleSocketData = deps.handleSocketData
    this.processHealthCheckQueue = deps.processHealthCheckQueue
    this.getVmEventManager = deps.getVmEventManager
    this.getQueueManager = deps.getQueueManager
    this.getIpDetectionStats = deps.getIpDetectionStats
    this.emitter = deps.emitter
    this.socketDir = deps.socketDir
    this.maxReconnectAttempts = deps.maxReconnectAttempts
    this.reconnectBaseDelay = deps.reconnectBaseDelay
    this.maxReconnectDelay = deps.maxReconnectDelay
    this.messageTimeout = deps.messageTimeout
    this.pingInterval = deps.pingInterval
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Service lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /** Check if the watcher service is currently running */
  getServiceStatus(): boolean {
    return this.isRunning
  }

  /** Start watching for socket files */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.debug.info('ConnectionManager watcher is already running')
      return
    }

    this.debug.info(`Starting ConnectionManager, watching directory: ${this.socketDir}`)

    // Ensure socket directory exists
    try {
      await fs.promises.mkdir(this.socketDir, { recursive: true })
    } catch (error) {
      this.debug.error(`Failed to create socket directory: ${error}`)
      throw error
    }

    // Clean up stale sockets from VMs that are no longer running
    await this.cleanupStaleSockets()

    // Set up file watcher
    this.watcher = chokidar.watch(this.socketDir, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })

    this.watcher
      .on('add', this.handleSocketFileAdded.bind(this))
      .on('unlink', this.handleSocketFileRemoved.bind(this))
      .on('error', (error: unknown) => this.debug.error(`Watcher error: ${error}`))

    this.isRunning = true
    this.debug.info('ConnectionManager started successfully')
  }

  /** Stop the service and clean up */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    this.debug.info('Stopping ConnectionManager...')
    this.isRunning = false

    // Close watcher
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = undefined
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      this.closeConnection(connection.vmId, 'cleanup or error')
    }

    this.debug.info('ConnectionManager stopped')
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Filesystem watcher handlers
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle new socket file detected */
  private async handleSocketFileAdded(socketPath: string): Promise<void> {
    const filename = path.basename(socketPath)
    const match = filename.match(/^(.+)\.socket$/)

    if (!match) {
      this.debug.debug(`Ignoring non-socket file: ${filename}`)
      return
    }

    const vmId = match[1]
    this.debug.debug(`New socket file detected for VM ${vmId}: ${socketPath}`)

    // Check if VM exists in database
    try {
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        select: { id: true, name: true, status: true }
      })

      if (!vm) {
        this.debug.debug(`VM ${vmId} not found in database, ignoring socket`)
        return
      }

      // Establish connection
      await this.connectToVm(vmId, socketPath)
    } catch (error) {
      this.debug.error(`Error handling socket file for VM ${vmId}: ${error}`)
    }
  }

  /** Handle socket file removal */
  private handleSocketFileRemoved(socketPath: string): void {
    const filename = path.basename(socketPath)
    const match = filename.match(/^(.+)\.socket$/)

    if (!match) {
      return
    }

    const vmId = match[1]
    this.debug.debug(`Socket file removed for VM ${vmId}`)

    // Close connection if exists
    this.closeConnection(vmId, 'socket file removed')
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stale socket cleanup
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Cleans up stale socket files from VMs that are no longer running.
   * Called at service startup to remove orphaned sockets.
   */
  private async cleanupStaleSockets(): Promise<void> {
    this.debug.info('Cleaning up stale socket files...')

    try {
      const files = await fs.promises.readdir(this.socketDir)
      let cleanedCount = 0
      let keptCount = 0

      for (const file of files) {
        // Only process .socket files
        const match = file.match(/^(.+)\.socket$/)
        if (!match) {
          continue
        }

        const vmId = match[1]
        const socketPath = path.join(this.socketDir, file)

        try {
          // Check if VM exists and is running
          const vm = await this.prisma.machine.findUnique({
            where: { id: vmId },
            select: { id: true, status: true }
          })

          if (!vm || vm.status !== 'running') {
            // Socket is orphaned - VM doesn't exist or isn't running
            try {
              await fs.promises.unlink(socketPath)
              cleanedCount++
              this.debug.debug(`Removed stale socket for VM ${vmId} (status: ${vm?.status ?? 'not found'})`)
            } catch (unlinkError: any) {
              // Silently ignore ENOENT (file disappeared between check and unlink)
              if (unlinkError.code !== 'ENOENT') {
                this.debug.warn(`Failed to remove stale socket ${socketPath}: ${unlinkError.message}`)
              }
            }
          } else {
            keptCount++
            this.debug.debug(`Keeping socket for running VM ${vmId}`)
          }
        } catch (error: any) {
          this.debug.warn(`Error checking VM ${vmId} for stale socket cleanup: ${error.message}`)
        }
      }

      this.debug.info(`Stale socket cleanup complete: ${cleanedCount} removed, ${keptCount} kept`)
    } catch (error: any) {
      // Don't fail startup if cleanup fails - just log and continue
      this.debug.warn(`Failed to clean up stale sockets: ${error.message}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection establishment
  // ──────────────────────────────────────────────────────────────────────────

  /** Connect to a VM's Unix domain socket */
  async connectToVm(vmId: string, socketPath: string): Promise<void> {
    // Close existing connection if any
    if (this.connections.has(vmId)) {
      this.debug.debug(`🔌 Closing existing connection for VM ${vmId}`)
      this.closeConnection(vmId, 'reconnecting')
    }

    const socket = new net.Socket()

    // Configure socket timeouts
    // Note: This is a Unix Domain Socket, not TCP, so keep-alive/noDelay don't apply
    // However, we still need to disable idle timeout to prevent automatic closure
    socket.setTimeout(0) // Disable idle timeout - the watcher keeps connection open indefinitely

    const now = new Date()
    const connection: VmConnection = {
      vmId,
      socket,
      socketPath,
      buffer: '',
      reconnectAttempts: 0,
      lastMessageTime: now,
      isConnected: false,
      errorCount: 0,
      pendingCommands: new Map(),
      // Enhanced connection diagnostics
      connectionStartTime: now,
      healthCheckResults: [],
      messageStats: {
        sent: 0,
        received: 0,
        errors: 0,
        totalBytes: 0,
        averageLatency: 0
      },
      connectionQuality: 'good',
      disconnectionHistory: [],
      transmissionFailureCount: 0,
      connectionStabilityScore: 100,
      messageTypeCounts: Object.create(null) as Record<string, number>,
      // Enhanced error tracking for intelligent retry logic
      errorClassificationHistory: [],
      recoverableErrorCount: 0,
      fatalErrorCount: 0,
      // Circuit Breaker initialization
      circuitBreakerState: 'Closed',
      circuitBreakerFailureCount: 0,
      circuitBreakerLastStateChange: now,
      // Keep-Alive initialization
      ...KeepAliveManager.initKeepAliveFields(),
      // Graceful Degradation initialization
      isDegraded: false,
      // Initialize per-connection reconnect delay from class default
      reconnectBaseDelayMs: this.reconnectBaseDelay,
      // Connection pooling initialization
      socketPaths: [socketPath], // Start with primary socket path, can add alternatives
      currentSocketIndex: 0
    }

    this.debug.info(`🔌 Initiating connection to VM ${vmId} at ${socketPath} (attempt timestamp: ${now.toISOString()})`)
    this.debug.debug(`Connection configuration: timeout=${this.messageTimeout}ms, pingInterval=${this.pingInterval}ms, maxReconnects=${this.maxReconnectAttempts}`)

    this.connections.set(vmId, connection)

    // Set up socket event handlers
    socket.on('connect', () => {
      const connectTime = new Date()
      const connectionDuration = connectTime.getTime() - connection.connectionStartTime.getTime()

      this.debug.info(`✅ Connected to VM ${vmId} (duration: ${connectionDuration}ms)`)
      this.debug.debug(`Connection established: socketPath=${socketPath}, attempts=${connection.reconnectAttempts}, quality=${connection.connectionQuality}`)

      connection.isConnected = true
      connection.reconnectAttempts = 0
      connection.lastMessageTime = connectTime
      // Reset error tracking on successful connection
      connection.errorCount = 0
      connection.lastErrorType = undefined
      connection.transmissionFailureCount = 0

      // Update connection quality based on establishment speed
      if (connectionDuration < 1000) {
        connection.connectionQuality = 'excellent'
      } else if (connectionDuration < 3000) {
        connection.connectionQuality = 'good'
      } else {
        connection.connectionQuality = 'poor'
      }

      // Reset stability score on successful connection
      connection.connectionStabilityScore = 100

      this.debug.info(`Connection quality assessed as '${connection.connectionQuality}' based on ${connectionDuration}ms establishment time`)

      // Connection established successfully
      // Start connection health monitoring (pings, timeouts)
      this.healthMonitor.startHealthMonitoring(connection)

      // Start bidirectional keep-alive monitoring
      this.keepAliveManager.startKeepAliveMonitoring(connection)

      // Process any queued health checks for this VM
      this.processHealthCheckQueue(connection)

      // Push agent connectivity to admins so the Sessions page / agent-connection
      // hooks refetch socketConnectionStats live instead of polling.
      emitAdminResourceEvent('agent_connections', 'update', { vmId, isConnected: true })

      // TODO: Implement handshake authentication here
    })

    socket.on('data', (data: Buffer) => {
      // SECURITY (dos-resource): the data path is guest-controlled. Guard against
      // any error thrown while parsing/accumulating (receive-buffer overflow
      // signal, allocation RangeError, unexpected parse failure) so it can never
      // escape as an uncaught exception and crash the shared backend for every
      // tenant. On failure we fail-closed by tearing the connection down.
      try {
        this.handleSocketData(connection, data)
      } catch (error) {
        this.debug.error(`Error handling socket data for VM ${vmId}: ${error}`)
        this.closeConnection(vmId, 'data handler error')
      }
    })

    socket.on('error', (error: Error) => {
      // Determine error type
      let errorType = 'UNKNOWN'

      if (error.message.includes('EACCES')) {
        errorType = 'EACCES'
      } else if (error.message.includes('ECONNREFUSED')) {
        errorType = 'ECONNREFUSED'
      } else if (error.message.includes('ENOENT')) {
        errorType = 'ENOENT'
      }

      // Enhanced error tracking and classification
      const errorTimestamp = new Date()
      connection.messageStats.errors++

      // Update connection quality based on error frequency
      const errorRate = connection.messageStats.errors / Math.max(connection.messageStats.received + connection.messageStats.sent, 1)
      if (errorRate > 0.1) {
        connection.connectionQuality = 'critical'
        connection.connectionStabilityScore = Math.max(0, connection.connectionStabilityScore - 10)
      } else if (errorRate > 0.05) {
        connection.connectionQuality = 'poor'
        connection.connectionStabilityScore = Math.max(20, connection.connectionStabilityScore - 5)
      }

      // Only log if this is a new error type or first occurrence
      if (connection.lastErrorType !== errorType || connection.errorCount === 0) {
        connection.lastErrorType = errorType
        connection.errorCount = 1

        // Log specific error details based on type with enhanced context
        if (errorType === 'EACCES') {
          this.debug.warn(`❌ Socket permission denied for VM ${vmId}. InfiniService may not be installed or running.`)
          this.debug.debug(`Error context: attempts=${connection.reconnectAttempts}, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}`)
          // Only show diagnostic help on first error
          if (connection.reconnectAttempts === 0) {
            this.debug.info(`💡 To diagnose: virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'`)
          }
        } else if (errorType === 'ECONNREFUSED') {
          this.debug.warn(`Connection refused for VM ${vmId}. InfiniService may not be listening on the socket.`)
          this.debug.debug(`Connection stats: uptime=${Date.now() - connection.connectionStartTime.getTime()}ms, msgs_received=${connection.messageStats.received}`)
        } else if (errorType === 'ENOENT') {
          this.debug.debug(`Socket file not found for VM ${vmId}. VM may be shutting down or InfiniService not started.`)
        } else {
          this.debug.error(`Socket error for VM ${vmId}: ${error.message.toString().slice(0, 100)}`)
          this.debug.debug(`Error details: type=${errorType}, timestamp=${errorTimestamp.toISOString()}, quality=${connection.connectionQuality}`)
        }

        // Log recent error classification history if available
        if (connection.errorClassificationHistory.length > 0) {
          const recentErrorReport = connection.lastErrorReport
          if (recentErrorReport) {
            this.debug.debug(`📋 Last error report from InfiniService: ${recentErrorReport.error_type} (${recentErrorReport.severity}) - retry ${recentErrorReport.retry_attempt}/${recentErrorReport.max_retries}`)
            if (recentErrorReport.recovery_suggestion) {
              this.debug.info(`💡 InfiniService recovery suggestion: ${recentErrorReport.recovery_suggestion}`)
            }
          }

          // Show error pattern summary
          const recentErrors = connection.errorClassificationHistory.slice(-5)
          const errorTypes = recentErrors.map(e => e.error_type).join(', ')
          this.debug.debug(`📊 Recent error patterns: recoverable=${connection.recoverableErrorCount}, fatal=${connection.fatalErrorCount}, types=[${errorTypes}]`)
        }
      } else {
        // Same error type, increment counter but only log periodically
        connection.errorCount++

        // Log every 10th occurrence of the same error with enhanced metrics
        if (connection.errorCount % 10 === 0) {
          const timeSinceStart = Date.now() - connection.connectionStartTime.getTime()
          this.debug.debug(`Still experiencing ${errorType} errors for VM ${vmId} (${connection.errorCount} occurrences over ${timeSinceStart}ms, stability=${connection.connectionStabilityScore}%)`)
        }
      }

      this.handleConnectionError(connection)
    })

    socket.on('timeout', () => {
      this.debug.warn(`⏱️ Socket timeout event for VM ${vmId} (this should not happen with setTimeout(0))`)
      // Don't close the socket automatically - let our health monitoring handle it
    })

    socket.on('close', () => {
      this.debug.debug(`🔌 Socket closed for VM ${vmId}`)
      connection.isConnected = false
      this.handleConnectionClosed(connection)
    })

    // Attempt connection
    try {
      this.debug.debug(`🔌 Attempting to connect to VM ${vmId} at ${socketPath}`)
      socket.connect(socketPath)
    } catch (error) {
      this.debug.error(`Failed to connect to VM ${vmId}: ${error}`)
      this.handleConnectionError(connection)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Error report handling
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle detailed error report from InfiniService */
  async handleErrorReport(connection: VmConnection, errorReport: ErrorReportMessage): Promise<void> {
    connection.lastErrorReport = errorReport
    connection.errorClassificationHistory.push(errorReport)

    // Keep only last 50 error reports
    if (connection.errorClassificationHistory.length > 50) {
      connection.errorClassificationHistory = connection.errorClassificationHistory.slice(-50)
    }

    // Update error counters
    if (errorReport.severity === 'Fatal') {
      connection.fatalErrorCount++
    } else {
      connection.recoverableErrorCount++
    }

    // Log the error report with appropriate level based on severity
    const logLevel = errorReport.severity === 'Fatal' ? 'error' : 'warn'
    this.debug.debug(logLevel, `🔧 Error report from VM ${connection.vmId}: ${errorReport.error_type} (${errorReport.severity}) - retry ${errorReport.retry_attempt}/${errorReport.max_retries}`)

    if (errorReport.recovery_suggestion) {
      this.debug.info(`💡 Recovery suggestion for VM ${connection.vmId}: ${errorReport.recovery_suggestion}`)
    }

    // Make intelligent reconnection decisions based on error type
    if (errorReport.severity === 'Fatal') {
      this.debug.error(`💀 Fatal error reported by VM ${connection.vmId}: ${errorReport.error_type}. Stopping reconnection attempts.`)
      this.closeConnection(connection.vmId, 'fatal_error')
    } else if (errorReport.severity === 'Recoverable') {
      // Adjust reconnection strategy based on error type
      this.adjustReconnectionStrategy(connection, errorReport)
    }

    // Track last recovery attempt time
    connection.lastRecoveryAttempt = new Date()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection pooling management
  // ──────────────────────────────────────────────────────────────────────────

  /** Expand the connection pool with alternative socket paths */
  expandConnectionPool(connection: VmConnection): void {
    // Add alternative socket paths for the VM
    const vmId = connection.vmId
    // SECURITY (path-safety): only ever read a VM's socket from the single
    // root-owned socketDir. The old fallbacks (/tmp, /run) are world-writable, so
    // an unprivileged local process could plant a listening socket there and, once
    // the real socket disappears and reconnection rotates onto the fallback,
    // impersonate this vmId. Inbound agent messages are NOT signed — the socket
    // path IS the identity binding — so a world-writable candidate must never be
    // trusted. Confining candidates to socketDir (which equals the primary path)
    // effectively disables the risky expansion.
    const alternativePaths = [
      path.join(this.socketDir, `${vmId}.socket`)
    ]

    // Add paths that don't already exist in the pool
    for (const p of alternativePaths) {
      if (!connection.socketPaths.includes(p)) {
        connection.socketPaths.push(p)
      }
    }

    this.debug.debug(`📡 Connection pool for VM ${vmId} expanded to ${connection.socketPaths.length} paths`)
  }

  /** Rotate to the next socket path in the pool */
  rotateToNextSocket(connection: VmConnection): string {
    // Rotate to the next socket path in the pool
    connection.currentSocketIndex = (connection.currentSocketIndex + 1) % connection.socketPaths.length
    const nextPath = connection.socketPaths[connection.currentSocketIndex]

    this.debug.debug(`🔄 Rotating to socket path ${connection.currentSocketIndex + 1}/${connection.socketPaths.length} for VM ${connection.vmId}: ${nextPath}`)
    return nextPath
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reconnection strategy
  // ──────────────────────────────────────────────────────────────────────────

  /** Adjust reconnection strategy based on error classification */
  adjustReconnectionStrategy(connection: VmConnection, errorReport: ErrorReportMessage): void {
    // Adjust timeouts and retry counts based on error type
    if (errorReport.error_type === 'ACCESS_DENIED') {
      // Longer delays for permission issues
      connection.reconnectBaseDelayMs = Math.max(connection.reconnectBaseDelayMs, 5000)
      this.debug.info(`🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for ACCESS_DENIED errors on VM ${connection.vmId}`)
    } else if (errorReport.error_type === 'BROKEN_PIPE' || errorReport.error_type === 'IO_BROKEN_PIPE') {
      // Shorter delays for connection issues
      connection.reconnectBaseDelayMs = Math.min(connection.reconnectBaseDelayMs, 2000)
      this.debug.info(`🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for pipe errors on VM ${connection.vmId}`)
    } else if (errorReport.error_type === 'FILE_NOT_FOUND' || errorReport.error_type === 'IO_NOT_FOUND') {
      // Medium delays for device availability issues
      connection.reconnectBaseDelayMs = Math.min(Math.max(connection.reconnectBaseDelayMs, 3000), 8000)
      this.debug.info(`🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for device not found errors on VM ${connection.vmId}`)
    }

    // Update connection quality based on error patterns
    const recentErrors = connection.errorClassificationHistory.slice(-10)
    const recentFatalErrors = recentErrors.filter(e => e.severity === 'Fatal').length
    const recentRecoverableErrors = recentErrors.filter(e => e.severity === 'Recoverable').length

    if (recentFatalErrors >= 3) {
      connection.connectionQuality = 'critical'
    } else if (recentRecoverableErrors >= 5) {
      connection.connectionQuality = 'poor'
    } else if (recentRecoverableErrors >= 2) {
      connection.connectionQuality = 'good'
    } else if (connection.connectionQuality !== 'critical') {
      connection.connectionQuality = 'excellent'
    }

    this.debug.debug(`🔧 Connection quality for VM ${connection.vmId} updated to: ${connection.connectionQuality}`)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection error handling
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle connection error */
  handleConnectionError(connection: VmConnection): void {
    connection.isConnected = false

    // Clear ping timer
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
      connection.pingTimer = undefined
    }

    // Clear keep-alive timer
    this.keepAliveManager.stopKeepAlive(connection)

    // Clear existing reconnect timer
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
      connection.reconnectTimer = undefined
    }

    // Check if we should attempt reconnection
    if (connection.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debug.warn(`Max reconnection attempts (${this.maxReconnectAttempts}) reached for VM ${connection.vmId}, giving up`)
      this.closeConnection(connection.vmId, 'cleanup or error')
      return
    }

    // Calculate exponential backoff delay with smaller multiplier (1.5 instead of 2)
    const delay = Math.min(
      connection.reconnectBaseDelayMs * Math.pow(1.5, connection.reconnectAttempts),
      this.maxReconnectDelay
    )

    connection.reconnectAttempts++
    this.debug.debug(`🔄 Will attempt reconnection ${connection.reconnectAttempts}/${this.maxReconnectAttempts} for VM ${connection.vmId} in ${delay}ms`)

    connection.reconnectTimer = setTimeout(() => {
      // Connection pooling: Try alternative socket paths on consecutive failures
      if (connection.reconnectAttempts > 1 && connection.socketPaths.length === 1) {
        this.expandConnectionPool(connection)
      }

      // Get the current socket path (might be rotated)
      let currentSocketPath = connection.socketPaths[connection.currentSocketIndex]

      // Check if current socket file exists
      fs.access(currentSocketPath, fs.constants.F_OK, (err) => {
        if (err && connection.socketPaths.length > 1) {
          // Current socket failed, try the next one in the pool
          currentSocketPath = this.rotateToNextSocket(connection)
          this.debug.debug(`Socket file not accessible, rotating to alternative: ${currentSocketPath}`)

          // Update the connection's socketPath to the new one
          connection.socketPath = currentSocketPath

          // Try the new socket
          this.debug.debug(`🔄 Attempting reconnection for VM ${connection.vmId} with alternative socket`)
          this.connectToVm(connection.vmId, currentSocketPath)
        } else if (err) {
          this.debug.debug(`Socket file no longer exists for VM ${connection.vmId}, stopping reconnection`)
          this.closeConnection(connection.vmId, 'cleanup or error')
        } else {
          this.debug.debug(`🔄 Attempting reconnection for VM ${connection.vmId}`)
          this.connectToVm(connection.vmId, currentSocketPath)
        }
      })
    }, delay)
  }

  /** Handle connection closed */
  handleConnectionClosed(connection: VmConnection): void {
    // If this was an intentional close, don't reconnect
    if (!this.isRunning) {
      this.closeConnection(connection.vmId, 'cleanup or error')
      return
    }

    // Otherwise, treat as error and attempt reconnection
    this.handleConnectionError(connection)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection close / cleanup
  // ──────────────────────────────────────────────────────────────────────────

  /** Close and clean up a connection with enhanced diagnostics */
  closeConnection(vmId: string, reason: string = 'unknown'): void {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return
    }

    // The agent for this VM is going away — refresh admin connectivity views.
    emitAdminResourceEvent('agent_connections', 'update', { vmId, isConnected: false })

    const disconnectTime = new Date()
    const connectionDuration = disconnectTime.getTime() - connection.connectionStartTime.getTime()
    const wasUnexpected = !['cleanup or error', 'manual cleanup', 'service shutdown'].includes(reason)

    // Record disconnection in history
    const disconnectionRecord: DisconnectionRecord = {
      timestamp: disconnectTime,
      reason,
      duration: connectionDuration,
      wasUnexpected
    }

    connection.disconnectionHistory.push(disconnectionRecord)

    // Keep only last 20 disconnection records
    if (connection.disconnectionHistory.length > 20) {
      connection.disconnectionHistory = connection.disconnectionHistory.slice(-20)
    }

    this.debug.info(`🔌 Closing connection for VM ${vmId} (reason: ${reason}, duration: ${connectionDuration}ms, unexpected: ${wasUnexpected})`)
    this.debug.debug(`Connection summary: sent=${connection.messageStats.sent}, received=${connection.messageStats.received}, errors=${connection.messageStats.errors}, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)

    // Log keep-alive summary
    const successRate = connection.keepAliveSentCount > 0
      ? (connection.keepAliveReceivedCount / connection.keepAliveSentCount * 100).toFixed(1)
      : '0'
    this.debug.debug(`Keep-alive summary: sent=${connection.keepAliveSentCount}, received=${connection.keepAliveReceivedCount}, failures=${connection.keepAliveFailureCount}, avg_rtt=${connection.keepAliveAverageRtt.toFixed(0)}ms, success_rate=${successRate}%`)

    // Only reject pending commands if this is unexpected
    const pendingCount = connection.pendingCommands.size
    if (pendingCount > 0) {
      this.debug.warn(`Found ${pendingCount} pending commands for VM ${vmId}`)

      for (const [commandId, pending] of connection.pendingCommands) {
        clearTimeout(pending.timeout)
        const error = new Error(`Connection to VM ${vmId} closed (${reason}) while command ${commandId} was pending`)
        pending.reject(error)
        this.debug.warn(`Rejected pending command ${commandId} due to connection close for VM ${vmId}`)
      }
      connection.pendingCommands.clear()
    }

    // Clear timers
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }
    this.keepAliveManager.stopKeepAlive(connection)
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
    }

    // Close socket
    if (connection.socket) {
      connection.socket.removeAllListeners()
      connection.socket.destroy()
    }

    // Remove from connections map
    this.connections.delete(vmId)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection statistics
  // ──────────────────────────────────────────────────────────────────────────

  /** Get comprehensive connection statistics with enhanced diagnostics */
  getConnectionStats(): ConnectionStats {
    const now = Date.now()
    const connections = Array.from(this.connections.values()).map(conn => ({
      vmId: conn.vmId,
      isConnected: conn.isConnected,
      reconnectAttempts: conn.reconnectAttempts,
      lastMessageTime: conn.lastMessageTime,
      errorCount: conn.errorCount,
      lastErrorType: conn.lastErrorType,
      pendingCommands: conn.pendingCommands.size,
      // Enhanced diagnostics
      connectionDuration: now - conn.connectionStartTime.getTime(),
      messageStats: conn.messageStats,
      connectionQuality: conn.connectionQuality,
      connectionStabilityScore: conn.connectionStabilityScore,
      recentHealthChecks: conn.healthCheckResults.slice(-5), // Last 5 health checks
      transmissionFailures: conn.transmissionFailureCount,
      lastSuccessfulTransmission: conn.lastSuccessfulTransmission,
      disconnectionCount: conn.disconnectionHistory.length,
      messageTypeCounts: conn.messageTypeCounts,
      // Enhanced error tracking statistics
      errorClassificationHistory: conn.errorClassificationHistory.slice(-10), // Last 10 error reports
      recoverableErrorCount: conn.recoverableErrorCount,
      fatalErrorCount: conn.fatalErrorCount,
      lastErrorReport: conn.lastErrorReport,
      lastRecoveryAttempt: conn.lastRecoveryAttempt,
      // Keep-alive metrics
      keepAliveSequence: conn.keepAliveSequence,
      keepAliveLastSent: conn.keepAliveLastSent,
      keepAliveLastReceived: conn.keepAliveLastReceived,
      keepAliveFailureCount: conn.keepAliveFailureCount,
      keepAliveRoundTripTime: conn.keepAliveLastSent && conn.keepAliveLastReceived
        ? conn.keepAliveLastReceived.getTime() - conn.keepAliveLastSent.getTime()
        : undefined,
      keepAlive: {
        sentCount: conn.keepAliveSentCount,
        receivedCount: conn.keepAliveReceivedCount,
        failureCount: conn.keepAliveFailureCount,
        consecutiveFailures: conn.keepAliveConsecutiveFailures,
        averageRtt: conn.keepAliveAverageRtt,
        lastSent: conn.keepAliveLastSent,
        lastReceived: conn.keepAliveLastReceived,
        lastFailure: conn.keepAliveLastFailureTime,
        successRate: conn.keepAliveSentCount > 0
          ? (conn.keepAliveReceivedCount / conn.keepAliveSentCount * 100).toFixed(2) + '%'
          : 'N/A'
      }
    }))

    // Calculate quality distribution
    const qualityDistribution = {
      excellent: connections.filter(c => c.connectionQuality === 'excellent').length,
      good: connections.filter(c => c.connectionQuality === 'good').length,
      poor: connections.filter(c => c.connectionQuality === 'poor').length,
      critical: connections.filter(c => c.connectionQuality === 'critical').length
    }

    // Calculate overall health metrics
    const totalMessages = connections.reduce((sum, c) => sum + c.messageStats.sent + c.messageStats.received, 0)
    const totalErrors = connections.reduce((sum, c) => sum + c.messageStats.errors, 0)
    const averageStabilityScore = connections.length > 0
      ? connections.reduce((sum, c) => sum + c.connectionStabilityScore, 0) / connections.length
      : 0
    const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0

    // Calculate error classification statistics
    const allConnections = Array.from(this.connections.values())
    const totalRecoverableErrors = allConnections.reduce((sum, conn) => sum + conn.recoverableErrorCount, 0)
    const totalFatalErrors = allConnections.reduce((sum, conn) => sum + conn.fatalErrorCount, 0)

    // Analyze error patterns across all connections
    const errorPatternAnalysis: Record<string, number> = {}
    allConnections.forEach(conn => {
      conn.errorClassificationHistory.forEach(errorReport => {
        errorPatternAnalysis[errorReport.error_type] = (errorPatternAnalysis[errorReport.error_type] || 0) + 1
      })
    })

    // Calculate recovery success rate and average retry attempts
    const allErrorReports = allConnections.flatMap(conn => conn.errorClassificationHistory)
    const successfulRecoveries = allErrorReports.filter(report => report.retry_attempt < report.max_retries).length
    const totalRecoveryAttempts = allErrorReports.length
    const recoverySuccessRate = totalRecoveryAttempts > 0 ? successfulRecoveries / totalRecoveryAttempts : 0

    const averageRetryAttempts = allErrorReports.length > 0
      ? allErrorReports.reduce((sum, report) => sum + report.retry_attempt, 0) / allErrorReports.length
      : 0

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => c.isConnected).length,
      connections,
      ipDetectionStats: this.getIpDetectionStats(),
      qualityDistribution,
      overallHealth: {
        averageStabilityScore,
        totalMessages,
        totalErrors,
        errorRate
      },
      errorClassification: {
        totalRecoverableErrors,
        totalFatalErrors,
        errorPatternAnalysis,
        recoverySuccessRate,
        averageRetryAttempts
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Connection query methods
  // ──────────────────────────────────────────────────────────────────────────

  /** Check if VM has active connection */
  isVmConnected(vmId: string): boolean {
    const connection = this.connections.get(vmId)
    return connection?.isConnected || false
  }

  /**
   * The VM's learned clock offset (guestClock − hostClock, ms), or undefined if
   * no timestamped message has been seen yet. Callers that sign time-sensitive
   * commands (e.g. the golden-image seal) must wait for this to be defined so the
   * envelope is stamped in the guest's clock frame — otherwise a freshly-booted,
   * clock-skewed guest rejects the command on HMAC freshness and silently drops
   * it. See the offset capture in MessageRouter.processMessage.
   */
  getClockOffset(vmId: string): number | undefined {
    return this.connections.get(vmId)?.clockOffsetMs
  }

  /** Get connection details for a VM */
  getConnectionDetails(vmId: string): ConnectionDetails | null {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return null
    }
    return {
      isConnected: connection.isConnected,
      socketPath: connection.socketPath,
      lastMessageTime: connection.lastMessageTime,
      errorCount: connection.errorCount
    }
  }

  /** Clean up connections for a deleted VM */
  async cleanupVmConnection(vmId: string): Promise<void> {
    this.debug.debug(`Cleaning up connection for deleted VM ${vmId}`)
    this.closeConnection(vmId, 'manual cleanup')

    // Also try to remove the socket file if it exists
    const socketPath = path.join(this.socketDir, `${vmId}.socket`)
    try {
      await fs.promises.unlink(socketPath)
      this.debug.debug(`Removed socket file for VM ${vmId}`)
    } catch (error) {
      // Socket file might not exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.debug.warn(`Failed to remove socket file for VM ${vmId}: ${error}`)
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Circuit Breaker handling
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle circuit breaker state changes from the agent */
  async handleCircuitBreakerStateChange(connection: VmConnection, message: CircuitBreakerStateMessage): Promise<void> {
    const oldState = connection.circuitBreakerState
    connection.circuitBreakerState = message.state
    connection.circuitBreakerFailureCount = message.failure_count
    connection.circuitBreakerLastStateChange = new Date()

    this.debug.info(`🔴 Circuit breaker state changed for VM ${connection.vmId}: ${oldState} -> ${message.state} (failures: ${message.failure_count})`)

    // Update connection quality and degradation status based on circuit breaker state
    switch (message.state) {
      case 'Open':
        connection.connectionQuality = 'critical'
        connection.isDegraded = true
        connection.degradationReason = 'Circuit breaker open - too many failures'
        this.debug.warn(`VM ${connection.vmId} entering degraded mode due to circuit breaker opening`)
        break

      case 'HalfOpen':
        connection.connectionQuality = 'poor'
        this.debug.info(`VM ${connection.vmId} circuit breaker testing recovery`)
        break

      case 'Closed':
        if (oldState === 'Open' || oldState === 'HalfOpen') {
          connection.connectionQuality = 'good'
          connection.isDegraded = false
          connection.degradationReason = undefined
          this.debug.info(`VM ${connection.vmId} circuit breaker recovered - normal operation resumed`)
        }
        break
    }

    // Update connection stability score
    updateConnectionStabilityScore(connection)
  }
}
