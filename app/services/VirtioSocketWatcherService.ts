/**
 * VirtioSocketWatcherService - Manages connections to VM InfiniService agents
 *
 * Debug output control:
 * - To see all debug messages: DEBUG=infinibay:virtio-socket:* npm run dev
 * - To see only errors/warnings: DEBUG=infinibay:virtio-socket:error,infinibay:virtio-socket:warn npm run dev
 * - To see info level: DEBUG=infinibay:virtio-socket:info npm run dev
 * - To disable all output: (default, or set DEBUG to other namespaces)
 */
import { PrismaClient } from '@prisma/client'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import { VmEventManager } from './VmEventManager'
import { VMHealthQueueManager } from './VMHealthQueueManager'
import { Debugger } from '../utils/debug'

// Payload logging configuration and helpers
const LOG_PREVIEW_LEN = Number(process.env.INFINIBAY_LOG_PREVIEW_LEN ?? 300)
const SENSITIVE_KEYS = [/(password|token|secret|authorization|bearer)/i]

function redactSensitive (obj: any): any {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) return obj.map(redactSensitive)
    const out: any = {}
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.some(rx => rx.test(k))) out[k] = '**redacted**'
      else out[k] = redactSensitive(v)
    }
    return out
  }
  return obj
}

// Message types from InfiniService
interface BaseMessage {
  type: 'metrics' | 'error' | 'handshake' | 'command' | 'response' | 'error_report' | 'circuit_breaker_state' | 'keep_alive'
  timestamp: string
}

interface ErrorMessage extends BaseMessage {
  type: 'error'
  error: string
  details?: unknown
}

interface MetricsMessage extends BaseMessage {
  type: 'metrics'
  data: {
    system: {
      cpu: {
        usage_percent: number
        cores_usage: number[]
        temperature?: number
      }
      memory: {
        total_kb: number
        used_kb: number
        available_kb: number
        swap_total_kb?: number
        swap_used_kb?: number
      }
      disk: {
        usage_stats: Array<{
          mount_point: string
          total_gb: number
          used_gb: number
          available_gb: number
        }>
        io_stats: {
          read_bytes_per_sec: number
          write_bytes_per_sec: number
          read_ops_per_sec: number
          write_ops_per_sec: number
        }
      }
      network: {
        interfaces: Array<{
          name: string
          bytes_received: number
          bytes_sent: number
          packets_received: number
          packets_sent: number
          ip_addresses?: string[]
          is_up?: boolean
        }>
      }
      uptime_seconds: number
      load_average?: {
        load_1min: number
        load_5min: number
        load_15min: number
      }
    }
    processes?: Array<{
      pid: number
      ppid?: number
      name: string
      exe_path?: string
      cmd_line?: string
      cpu_percent: number
      memory_kb: number
      disk_read_bytes?: number
      disk_write_bytes?: number
      status: string
      start_time?: string
    }>
    applications?: Array<{
      exe_path: string
      name: string
      version?: string
      description?: string
      publisher?: string
      last_access?: string
      last_modified?: string
      access_count: number
      usage_minutes: number
      file_size?: number
      is_active: boolean
    }>
    ports?: Array<{
      port: number
      protocol: string
      state: string
      pid?: number
      process_name?: string
      exe_path?: string
      is_listening: boolean
      connection_count: number
    }>
    windows_services?: Array<{
      name: string
      display_name: string
      description?: string
      start_type: string
      service_type: string
      exe_path?: string
      dependencies?: string[]
      state: string
      pid?: number
      is_default: boolean
    }>
  }
}

interface ErrorReportMessage extends BaseMessage {
  type: 'error_report'
  error_type: string
  severity: 'Temporary' | 'Recoverable' | 'Fatal' | 'Unknown'
  windows_error_code?: number
  retry_attempt: number
  max_retries: number
  recovery_suggestion?: string
  vm_id: string
}

// Command-related message types
interface CommandMessage extends BaseMessage {
  type: 'command'
  id: string
  commandType: SafeCommandType | UnsafeCommandRequest
}

interface ResponseMessage extends BaseMessage {
  type: 'response'
  id: string
  success: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  execution_time_ms?: number
  command_type?: string
  data?: ResponseData
  error?: string
}

// Circuit Breaker and Keep-Alive message types
interface CircuitBreakerStateMessage extends BaseMessage {
  type: 'circuit_breaker_state'
  state: 'Closed' | 'Open' | 'HalfOpen'
  failure_count: number
  last_failure_time?: string
  recovery_eta_seconds?: number
}

interface KeepAliveMessage extends BaseMessage {
  type: 'keep_alive'
  sequence_number: number
}

// Define types for different response data structures
interface PackageInfo {
  name: string
  version?: string
  description?: string
  installed?: boolean
  available?: boolean
}

interface ServiceInfo {
  name: string
  display_name?: string
  status: string
  start_type?: string
}

interface ProcessInfo {
  pid: number
  name: string
  cpu_percent: number
  memory_kb: number
  status?: string
}

interface SystemInfo {
  hostname?: string
  os?: string
  kernel?: string
  arch?: string
  cpu_count?: number
  total_memory?: number
}

interface OsInfo {
  name?: string
  version?: string
  build?: string
  platform?: string
}

// Auto-check response data interfaces
interface WindowsUpdate {
  title: string
  importance: 'Critical' | 'Important' | 'Moderate' | 'Low'
  kb_id?: string
  size?: number
}

interface WindowsUpdatesData {
  pending_updates?: WindowsUpdate[]
  installed_count?: number
  failed_count?: number
}

interface DefenderData {
  real_time_protection?: boolean
  antivirus_enabled?: boolean
  definitions_outdated?: boolean
  last_definition_update?: string
  scan_status?: string
}

interface DiskDrive {
  drive_letter: string
  total_gb: number
  used_gb: number
  available_gb: number
}

interface DiskSpaceData {
  drives?: DiskDrive[]
}

interface ResourceOptimizationData {
  cpu_optimization_available?: boolean
  memory_optimization_available?: boolean
  disk_optimization_available?: boolean
  recommendations?: string[]
}

interface HealthCheckData {
  overall_health?: 'Healthy' | 'Warning' | 'Critical'
  checks?: Array<{
    name: string
    status: string
    details?: unknown
  }>
}

interface DefenderScanData {
  threats_found?: number
  scan_duration?: string
  threats?: Array<{
    name: string
    severity: string
    action: string
  }>
}

// Response data can be different types depending on the command
// For compatibility with GraphQL resolver expectations, ensure arrays are properly typed
type ResponseData = PackageInfo[] | ServiceInfo[] | ProcessInfo[] | SystemInfo | OsInfo |
  WindowsUpdatesData | DefenderData | DiskSpaceData | ResourceOptimizationData |
  HealthCheckData | DefenderScanData | unknown[] | Record<string, unknown>

// Safe command types matching InfiniService
export interface SafeCommandType {
  action: 'ServiceList' | 'ServiceControl' | 'PackageList' | 'PackageInstall' |
  'PackageRemove' | 'PackageUpdate' | 'PackageSearch' | 'ProcessList' |
  'ProcessKill' | 'ProcessTop' | 'SystemInfo' | 'OsInfo' |
  // Auto-check commands
  'CheckWindowsUpdates' | 'GetUpdateHistory' | 'GetPendingUpdates' |
  'CheckWindowsDefender' | 'GetDefenderStatus' | 'RunDefenderQuickScan' | 'GetThreatHistory' |
  'GetInstalledApplicationsWMI' | 'CheckApplicationUpdates' | 'GetApplicationDetails' |
  'CheckDiskSpace' | 'CheckResourceOptimization' | 'RunHealthCheck' | 'RunAllHealthChecks' |
  'DiskCleanup' | 'AutoFixWindowsUpdates' | 'AutoFixDefender' | 'AutoOptimizeDisk' |
  // Maintenance commands
  'ExecutePowerShellScript' | 'RunMaintenanceTask' | 'ValidateSystemHealth' |
  'CleanTemporaryFiles' | 'UpdateSystemSoftware' | 'RestartServices' | 'CheckSystemIntegrity'
  params?: SafeCommandParams
}

// Parameters for safe commands
interface SafeCommandParams {
  // Package operations
  query?: string
  package?: string
  // Process operations
  pid?: number
  force?: boolean
  limit?: number
  sort_by?: string
  // Service operations
  service?: string
  service_name?: string // Alternative service name field
  action?: string
  // Auto-check parameters
  check_name?: string
  days?: number
  app_id?: string
  warning_threshold?: number
  critical_threshold?: number
  evaluation_window_days?: number
  drive?: string
  targets?: string[]
  // Maintenance parameters
  script?: string
  script_type?: string
  task_type?: string
  task_name?: string
  parameters?: Record<string, unknown>
  timeout_seconds?: number
  working_directory?: string
  environment_vars?: Record<string, string>
  run_as_admin?: boolean
  validate_before?: boolean
  validate_after?: boolean
}

export interface UnsafeCommandRequest {
  rawCommand: string
  shell?: string
  timeout?: number
  workingDir?: string
  envVars?: Record<string, string>
}

export interface CommandResponse {
  id?: string // Command ID for tracking
  success: boolean
  exit_code?: number
  stdout?: string
  stderr?: string
  execution_time_ms?: number
  command_type?: string // 'safe' or 'unsafe'
  data?: ResponseData
  error?: string
}

// Health check result structure for detailed tracking
interface HealthCheckResult {
  timestamp: Date
  success: boolean
  latency?: number
  error?: string
}

// Message statistics for connection diagnostics
interface MessageStats {
  sent: number
  received: number
  errors: number
  totalBytes: number
  averageLatency: number
}

// Disconnection history tracking
interface DisconnectionRecord {
  timestamp: Date
  reason: string
  duration: number
  wasUnexpected: boolean
}

// Connection state for each VM with enhanced diagnostics
interface VmConnection {
  vmId: string
  socket: net.Socket
  socketPath: string
  buffer: string
  reconnectAttempts: number
  reconnectTimer?: NodeJS.Timeout
  lastMessageTime: Date
  pingTimer?: NodeJS.Timeout
  isConnected: boolean
  lastErrorType?: string // Track last error type to avoid repetitive logging
  errorCount: number // Track error frequency
  pendingCommands: Map<string, {
    resolve: (value: CommandResponse) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }> // Track pending commands awaiting responses
  // Enhanced connection diagnostics
  connectionStartTime: Date
  lastHealthCheckTime?: Date
  healthCheckResults: HealthCheckResult[]
  messageStats: MessageStats
  connectionQuality: 'excellent' | 'good' | 'poor' | 'critical'
  disconnectionHistory: DisconnectionRecord[]
  transmissionFailureCount: number
  lastSuccessfulTransmission?: Date
  connectionStabilityScore: number // 0-100 score based on connection health
  messageTypeCounts: Record<string, number> // Track message type frequency
  // Enhanced error tracking for intelligent retry logic
  lastErrorReport?: ErrorReportMessage // Last detailed error received from Rust side
  errorClassificationHistory: ErrorReportMessage[] // History of classified errors
  recoverableErrorCount: number // Count of recoverable errors
  fatalErrorCount: number // Count of fatal errors
  lastRecoveryAttempt?: Date // When last recovery was attempted
  // Circuit Breaker fields
  circuitBreakerState: 'Closed' | 'Open' | 'HalfOpen' // Current circuit breaker state
  circuitBreakerFailureCount: number // Failure count for circuit breaker
  circuitBreakerLastStateChange: Date // When state last changed
  // Keep-Alive fields
  keepAliveSequence: number // Track keep-alive message sequence
  keepAliveLastSent?: Date // Last keep-alive sent time
  keepAliveLastReceived?: Date // Last keep-alive response time
  keepAliveFailureCount: number // Count of missed keep-alive responses
  // Graceful Degradation fields
  isDegraded: boolean // Whether connection is in degraded mode
  degradationReason?: string // Why connection was degraded
  // Per-connection reconnect delay (can be adjusted based on error patterns)
  reconnectBaseDelayMs: number // Mutable reconnect delay for this connection
  // Connection pooling for alternative endpoints
  socketPaths: string[] // Alternative socket paths to try
  currentSocketIndex: number // Index of the currently used socket path
}

// Define message structure types for outgoing messages
interface OutgoingMessage {
  type: string
  SafeCommand?: {
    id: string
    command_type: Record<string, unknown>
    params: null
    timeout: number
  }
  UnsafeCommand?: {
    id: string
    raw_command: string
    shell?: string
    timeout: number
    working_dir?: string
    env_vars?: Record<string, string>
  }
  [key: string]: unknown
}

// Define the formatted command type structure
interface FormattedCommandType {
  action: string
  query?: string
  package?: string
  limit?: number | null
  pid?: number
  force?: boolean | null
  sort_by?: string | null
  [key: string]: unknown // Allow additional properties for Record compatibility
}

export class VirtioSocketWatcherService extends EventEmitter {
  private prisma: PrismaClient
  private vmEventManager?: VmEventManager
  private queueManager?: VMHealthQueueManager
  private connections: Map<string, VmConnection> = new Map()
  private watcher?: chokidar.FSWatcher
  private socketDir: string
  private isRunning: boolean = false
  private readonly maxReconnectAttempts = Number(process.env.VIRTIO_MAX_RECONNECT_ATTEMPTS) || 15
  private readonly reconnectBaseDelay = Number(process.env.VIRTIO_RECONNECT_BASE_DELAY_MS) || 3000 // 3 seconds (was 1s)
  private readonly maxReconnectDelay = Number(process.env.VIRTIO_MAX_RECONNECT_DELAY_MS) || 120000
  // Connection monitoring constants
  // Set high to accommodate long-running health checks (up to 5+ minutes)
  private readonly messageTimeout = Number(process.env.VIRTIO_MESSAGE_TIMEOUT_MS) || 900000 // 15 minutes (was 10min)
  private readonly pingInterval = Number(process.env.VIRTIO_PING_INTERVAL_MS) || 300000 // 5 minutes (was 2min)
  private debug: Debugger

  constructor (prisma: PrismaClient) {
    super()
    this.prisma = prisma
    this.socketDir = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'sockets')
    this.debug = new Debugger('infinibay:virtio-socket')

    // Log timeout configuration for debugging
    this.debug.log('info', `VirtIO timeout configuration: messageTimeout=${this.messageTimeout}ms, pingInterval=${this.pingInterval}ms, reconnectBaseDelay=${this.reconnectBaseDelay}ms, maxReconnectDelay=${this.maxReconnectDelay}ms, maxReconnectAttempts=${this.maxReconnectAttempts}`)
  }

  // Initialize the service with optional dependencies
  initialize (vmEventManager?: VmEventManager, queueManager?: VMHealthQueueManager): void {
    this.vmEventManager = vmEventManager
    this.queueManager = queueManager
  }

  // Start watching for socket files
  async start (): Promise<void> {
    if (this.isRunning) {
      this.debug.log('info', 'VirtioSocketWatcherService is already running')
      return
    }

    this.debug.log('info', `Starting VirtioSocketWatcherService, watching directory: ${this.socketDir}`)

    // Ensure socket directory exists
    try {
      await fs.promises.mkdir(this.socketDir, { recursive: true })
    } catch (error) {
      this.debug.log('error', `Failed to create socket directory: ${error}`)
      throw error
    }

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
      .on('error', (error: unknown) => this.debug.log('error', `Watcher error: ${error}`))

    this.isRunning = true
    this.debug.log('info', 'VirtioSocketWatcherService started successfully')
  }

  // Stop the service and clean up
  async stop (): Promise<void> {
    if (!this.isRunning) {
      return
    }

    this.debug.log('info', 'Stopping VirtioSocketWatcherService...')
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

    this.debug.log('info', 'VirtioSocketWatcherService stopped')
  }

  // Handle new socket file detected
  private async handleSocketFileAdded (socketPath: string): Promise<void> {
    const filename = path.basename(socketPath)
    const match = filename.match(/^(.+)\.socket$/)

    if (!match) {
      this.debug.log('debug', `Ignoring non-socket file: ${filename}`)
      return
    }

    const vmId = match[1]
    this.debug.log('debug', `New socket file detected for VM ${vmId}: ${socketPath}`)

    // Check if VM exists in database
    try {
      const vm = await this.prisma.machine.findUnique({
        where: { id: vmId },
        select: { id: true, name: true, status: true }
      })

      if (!vm) {
        this.debug.log('debug', `VM ${vmId} not found in database, ignoring socket`)
        return
      }

      // Establish connection
      await this.connectToVm(vmId, socketPath)
    } catch (error) {
      this.debug.log('error', `Error handling socket file for VM ${vmId}: ${error}`)
    }
  }

  // Handle socket file removal
  private handleSocketFileRemoved (socketPath: string): void {
    const filename = path.basename(socketPath)
    const match = filename.match(/^(.+)\.socket$/)

    if (!match) {
      return
    }

    const vmId = match[1]
    this.debug.log('debug', `Socket file removed for VM ${vmId}`)

    // Close connection if exists
    this.closeConnection(vmId, 'socket file removed')
  }

  // Connect to a VM's Unix domain socket
  private async connectToVm (vmId: string, socketPath: string): Promise<void> {
    // Close existing connection if any
    if (this.connections.has(vmId)) {
      this.debug.log('debug', `🔌 Closing existing connection for VM ${vmId}`)
      this.closeConnection(vmId, 'reconnecting')
    }

    const socket = new net.Socket()
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
      keepAliveSequence: 0,
      keepAliveFailureCount: 0,
      // Graceful Degradation initialization
      isDegraded: false,
      // Initialize per-connection reconnect delay from class default
      reconnectBaseDelayMs: this.reconnectBaseDelay,
      // Connection pooling initialization
      socketPaths: [socketPath], // Start with primary socket path, can add alternatives
      currentSocketIndex: 0
    }

    this.debug.log('info', `🔌 Initiating connection to VM ${vmId} at ${socketPath} (attempt timestamp: ${now.toISOString()})`)
    this.debug.log('debug', `Connection configuration: timeout=${this.messageTimeout}ms, pingInterval=${this.pingInterval}ms, maxReconnects=${this.maxReconnectAttempts}`)

    this.connections.set(vmId, connection)

    // Set up socket event handlers
    socket.on('connect', () => {
      const connectTime = new Date()
      const connectionDuration = connectTime.getTime() - connection.connectionStartTime.getTime()

      this.debug.log('info', `✅ Connected to VM ${vmId} (duration: ${connectionDuration}ms)`)
      this.debug.log('debug', `Connection established: socketPath=${socketPath}, attempts=${connection.reconnectAttempts}, quality=${connection.connectionQuality}`)

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

      this.debug.log('info', `Connection quality assessed as '${connection.connectionQuality}' based on ${connectionDuration}ms establishment time`)

      // Connection established successfully
      // Start connection health monitoring (pings, timeouts)
      this.startHealthMonitoring(connection)

      // Process any queued health checks for this VM
      this.processHealthCheckQueue(connection)

      // TODO: Implement handshake authentication here
    })

    socket.on('data', (data: Buffer) => {
      this.handleSocketData(connection, data)
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
          this.debug.log('warn', `❌ Socket permission denied for VM ${vmId}. InfiniService may not be installed or running.`)
          this.debug.log('debug', `Error context: attempts=${connection.reconnectAttempts}, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}`)
          // Only show diagnostic help on first error
          if (connection.reconnectAttempts === 0) {
            this.debug.log('info', `💡 To diagnose: virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'`)
          }
        } else if (errorType === 'ECONNREFUSED') {
          this.debug.log('warn', `Connection refused for VM ${vmId}. InfiniService may not be listening on the socket.`)
          this.debug.log('debug', `Connection stats: uptime=${Date.now() - connection.connectionStartTime.getTime()}ms, msgs_received=${connection.messageStats.received}`)
        } else if (errorType === 'ENOENT') {
          this.debug.log('debug', `Socket file not found for VM ${vmId}. VM may be shutting down or InfiniService not started.`)
        } else {
          this.debug.log('error', `Socket error for VM ${vmId}: ${error.message.toString().slice(0, 100)}`)
          this.debug.log('debug', `Error details: type=${errorType}, timestamp=${errorTimestamp.toISOString()}, quality=${connection.connectionQuality}`)
        }

        // Log recent error classification history if available
        if (connection.errorClassificationHistory.length > 0) {
          const recentErrorReport = connection.lastErrorReport
          if (recentErrorReport) {
            this.debug.log('debug', `📋 Last error report from InfiniService: ${recentErrorReport.error_type} (${recentErrorReport.severity}) - retry ${recentErrorReport.retry_attempt}/${recentErrorReport.max_retries}`)
            if (recentErrorReport.recovery_suggestion) {
              this.debug.log('info', `💡 InfiniService recovery suggestion: ${recentErrorReport.recovery_suggestion}`)
            }
          }

          // Show error pattern summary
          const recentErrors = connection.errorClassificationHistory.slice(-5)
          const errorTypes = recentErrors.map(e => e.error_type).join(', ')
          this.debug.log('debug', `📊 Recent error patterns: recoverable=${connection.recoverableErrorCount}, fatal=${connection.fatalErrorCount}, types=[${errorTypes}]`)
        }
      } else {
        // Same error type, increment counter but only log periodically
        connection.errorCount++

        // Log every 10th occurrence of the same error with enhanced metrics
        if (connection.errorCount % 10 === 0) {
          const timeSinceStart = Date.now() - connection.connectionStartTime.getTime()
          this.debug.log('debug', `Still experiencing ${errorType} errors for VM ${vmId} (${connection.errorCount} occurrences over ${timeSinceStart}ms, stability=${connection.connectionStabilityScore}%)`)
        }
      }

      this.handleConnectionError(connection)
    })

    socket.on('close', () => {
      this.debug.log('debug', `🔌 Socket closed for VM ${vmId}`)
      connection.isConnected = false
      this.handleConnectionClosed(connection)
    })

    // Attempt connection
    try {
      this.debug.log('debug', `🔌 Attempting to connect to VM ${vmId} at ${socketPath}`)
      socket.connect(socketPath)
    } catch (error) {
      this.debug.log('error', `Failed to connect to VM ${vmId}: ${error}`)
      this.handleConnectionError(connection)
    }
  }

  // Handle incoming data from socket with enhanced diagnostics
  private handleSocketData (connection: VmConnection, data: Buffer): void {
    const receiveTime = new Date()
    const dataSize = data.length

    connection.buffer += data.toString()
    connection.lastMessageTime = receiveTime

    // Update message statistics
    connection.messageStats.received++
    connection.messageStats.totalBytes += dataSize

    this.debug.log('debug', `📥 Received ${dataSize} bytes from VM ${connection.vmId} (buffer size: ${connection.buffer.length}, total received: ${connection.messageStats.received})`)

    // Monitor buffer size for potential issues
    if (connection.buffer.length > 100000) { // 100KB buffer warning
      this.debug.log('warn', `Large buffer detected for VM ${connection.vmId}: ${connection.buffer.length} bytes - possible message parsing issue`)
    }

    // Process complete messages (delimited by newlines)
    let newlineIndex: number
    let messagesProcessed = 0
    while ((newlineIndex = connection.buffer.indexOf('\n')) !== -1) {
      const messageStr = connection.buffer.slice(0, newlineIndex)
      connection.buffer = connection.buffer.slice(newlineIndex + 1)

      if (messageStr.trim()) {
        const messageStartTime = Date.now()
        this.processMessage(connection, messageStr.trim())
        const processingTime = Date.now() - messageStartTime
        messagesProcessed++

        // Update average latency (simple moving average)
        if (connection.messageStats.averageLatency === 0) {
          connection.messageStats.averageLatency = processingTime
        } else {
          connection.messageStats.averageLatency = (connection.messageStats.averageLatency * 0.9) + (processingTime * 0.1)
        }

        if (processingTime > 1000) { // Log slow message processing
          this.debug.log('warn', `Slow message processing for VM ${connection.vmId}: ${processingTime}ms`)
        }
      }
    }

    if (messagesProcessed > 0) {
      this.debug.log('debug', `Processed ${messagesProcessed} messages from VM ${connection.vmId} (avg latency: ${connection.messageStats.averageLatency.toFixed(1)}ms)`)
    }
  }

  // Process a complete message
  private async processMessage (connection: VmConnection, messageStr: string): Promise<void> {
    try {
      const message = JSON.parse(messageStr) as BaseMessage | MetricsMessage | ErrorMessage | ResponseMessage | Record<string, unknown>

      // Handle messages without explicit type field (legacy or command responses)
      if (!('type' in message) && 'id' in message && 'success' in message) {
        (message as unknown as ResponseMessage).type = 'response'
      }

      this.debug.log('debug', `📥 Received ${('type' in message ? message.type : 'unknown')} message from VM ${connection.vmId}`)

      // Add redacted message preview
      const redacted = redactSensitive(message)
      const preview = JSON.stringify(redacted, null, 2).slice(0, LOG_PREVIEW_LEN)
      this.debug.log('debug', `📋 Message preview: ${preview}${preview.length === LOG_PREVIEW_LEN ? '…' : ''}`)

      const msgType = 'type' in message && typeof message.type === 'string' ? message.type : undefined

      // Track message type frequency (bounded to avoid memory growth)
      const typeKey: string = msgType || 'unknown'
      connection.messageTypeCounts[typeKey] = (connection.messageTypeCounts[typeKey] || 0) + 1

      // Keep only most recent 1000 message types to prevent unbounded growth
      const totalMessages = Object.values(connection.messageTypeCounts).reduce((sum, count) => sum + count, 0)
      if (totalMessages > 1000) {
        // Simple cleanup: reduce all counts by half
        for (const key in connection.messageTypeCounts) {
          connection.messageTypeCounts[key] = Math.floor(connection.messageTypeCounts[key] / 2)
          if (connection.messageTypeCounts[key] === 0) {
            delete connection.messageTypeCounts[key]
          }
        }
      }

      switch (msgType) {
      case 'metrics':
        // Store metrics in database
        await this.storeMetrics(connection.vmId, message as MetricsMessage)
        break

      case 'error':
        // Log error from VM
        const errorMsg = message as ErrorMessage
        this.debug.log('error', `Error from VM ${connection.vmId}: ${errorMsg.error} ${errorMsg.details ? JSON.stringify(errorMsg.details) : ''}`)
        break

      case 'error_report':
        // Handle detailed error report from Rust side
        const errorReport = message as ErrorReportMessage
        await this.handleErrorReport(connection, errorReport)
        break

      case 'response':
        // Handle command response
        const response = message as ResponseMessage
        const pendingCommand = connection.pendingCommands.get(response.id)
        if (pendingCommand) {
          clearTimeout(pendingCommand.timeout)

          // Try to parse stdout as JSON data for certain command types
          let data = response.data
          if (!data && response.stdout && response.command_type) {
            try {
              // For process-related commands, try to parse stdout as JSON
              if (['ProcessList', 'ProcessTop', 'ProcessKill'].includes(response.command_type)) {
                data = JSON.parse(response.stdout)
                this.debug.log('debug', `Parsed stdout for ${response.command_type}, got ${Array.isArray(data) ? data.length : 0} items`)
                if (Array.isArray(data) && data.length > 0) {
                  this.debug.log('debug', `First item structure: ${JSON.stringify(data[0], null, 2)}`)
                }
              }
            } catch (parseError) {
              this.debug.log('debug', `Could not parse stdout as JSON for ${response.command_type}: ${parseError}`)
            }
          }

          // Build complete response object
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

          pendingCommand.resolve(commandResponse)
          connection.pendingCommands.delete(response.id)

          // Log with execution time if available
          const execTime = response.execution_time_ms ? ` (${response.execution_time_ms}ms)` : ''
          this.debug.log('debug', `Command ${response.id} completed for VM ${connection.vmId}${execTime}`)

          // Log error details if command failed
          if (!response.success) {
            this.debug.log('warn', `Command ${response.id} failed: ${response.error || response.stderr || 'Unknown error'}`)
          }

          // Check if this is an auto-check related command and emit events if needed
          await this.handleAutoCheckResponse(connection.vmId, response, data || null)
        } else {
          this.debug.log('warn', `Received response for unknown command ${response.id} from VM ${connection.vmId}`)
        }
        break

      case 'circuit_breaker_state':
        // Handle circuit breaker state changes from Rust side
        const circuitBreakerMsg = message as CircuitBreakerStateMessage
        await this.handleCircuitBreakerStateChange(connection, circuitBreakerMsg)
        break

      case 'keep_alive':
        // Handle keep-alive messages from InfiniService
        const keepAliveMsg = message as KeepAliveMessage
        await this.handleKeepAliveMessage(connection, keepAliveMsg)
        break

      default:
        this.debug.log('warn', `Unknown message type from VM ${connection.vmId}: ${typeof message === 'object' && message && 'type' in message ? message.type : 'unknown'}`)
      }
    } catch (error) {
      this.debug.log('error', `Failed to process message from VM ${connection.vmId}: ${error}`)
      this.debug.log('error', `Raw message: ${messageStr}`)
      // Add more details about the parsing error
      if (error instanceof SyntaxError) {
        this.debug.log('error', `JSON parsing error: ${error.message}`)
        this.debug.log('error', `Message length: ${messageStr.length} chars`)
        this.debug.log('error', `First 500 chars: ${messageStr.substring(0, 500)}`)
      }
    }
  }

  // Handle auto-check related command responses and emit appropriate events
  private async handleAutoCheckResponse (vmId: string, response: ResponseMessage, data: ResponseData | null): Promise<void> {
    try {
      if (!response.command_type || !this.vmEventManager) {
        return
      }

      const commandType = response.command_type

      // Check if this is an auto-check related command
      const autoCheckCommands = [
        'CheckWindowsUpdates', 'CheckWindowsDefender', 'CheckDiskSpace',
        'CheckResourceOptimization', 'RunHealthCheck', 'RunAllHealthChecks',
        'AutoFixWindowsUpdates', 'AutoFixDefender', 'AutoOptimizeDisk',
        'DiskCleanup', 'RunDefenderQuickScan'
      ]

      if (!autoCheckCommands.includes(commandType)) {
        return
      }

      this.debug.log('debug', `Processing auto-check response for VM ${vmId}: ${commandType}`)

      // If command failed, this might indicate an issue
      if (!response.success) {
        await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: commandType,
          severity: 'warning',
          description: `Auto-check command ${commandType} failed`,
          details: {
            error: response.error || response.stderr,
            commandId: response.id,
            executionTime: response.execution_time_ms
          }
        })
        return
      }

      // For successful responses, analyze the data to detect issues or remediations
      await this.analyzeAutoCheckData(vmId, commandType, data, response)
    } catch (error) {
      this.debug.log('error', `Error handling auto-check response for VM ${vmId}: ${error}`)
    }
  }

  // Analyze auto-check command data to determine if issues or remediations should be reported
  private async analyzeAutoCheckData (
    vmId: string,
    commandType: string,
    data: ResponseData | null,
    response: ResponseMessage
  ): Promise<void> {
    try {
      if (!this.vmEventManager) {
        return
      }

      // Analyze different types of auto-check responses
      switch (commandType) {
      case 'CheckWindowsUpdates':
        await this.analyzeWindowsUpdatesResponse(vmId, data, response)
        break

      case 'CheckWindowsDefender':
        await this.analyzeDefenderResponse(vmId, data, response)
        break

      case 'CheckDiskSpace':
        await this.analyzeDiskSpaceResponse(vmId, data, response)
        break

      case 'CheckResourceOptimization':
        await this.analyzeResourceOptimizationResponse(vmId, data, response)
        break

      case 'RunAllHealthChecks':
      case 'RunHealthCheck':
        await this.analyzeHealthCheckResponse(vmId, data, response)
        break

      case 'AutoFixWindowsUpdates':
      case 'AutoFixDefender':
      case 'AutoOptimizeDisk':
      case 'DiskCleanup':
        await this.analyzeRemediationResponse(vmId, commandType, data, response)
        break

      case 'RunDefenderQuickScan':
        await this.analyzeDefenderScanResponse(vmId, data, response)
        break

      default:
        this.debug.log('debug', `No specific analysis for command type: ${commandType}`)
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing auto-check data for VM ${vmId}: ${error}`)
    }
  }

  // Analyze Windows Updates response for issues
  private async analyzeWindowsUpdatesResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is WindowsUpdatesData
      const isWindowsUpdatesData = (data: ResponseData | null): data is WindowsUpdatesData => {
        return data !== null &&
          typeof data === 'object' &&
          'pending_updates' in data &&
          Array.isArray((data as WindowsUpdatesData).pending_updates)
      }

      if (!isWindowsUpdatesData(data)) {
        this.debug.log('debug', 'Data is not WindowsUpdatesData format')
        return
      }

      const updateData = data as WindowsUpdatesData

      if (updateData.pending_updates && updateData.pending_updates.length > 0) {
        // Critical updates pending
        const criticalUpdates = updateData.pending_updates.filter((update: WindowsUpdate) =>
          update.importance === 'Critical' || update.importance === 'Important'
        )

        if (criticalUpdates.length > 0) {
          await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
            checkType: 'WindowsUpdates',
            severity: 'critical',
            description: `${criticalUpdates.length} critical Windows updates are pending`,
            details: { criticalUpdates, totalUpdates: updateData.pending_updates.length }
          })

          // Offer automatic remediation
          await this.vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
            checkType: 'WindowsUpdates',
            remediationType: 'AutoFixWindowsUpdates',
            description: 'Automatically install pending Windows updates',
            isAutomatic: true,
            estimatedTime: '15-30 minutes',
            details: { updateCount: criticalUpdates.length }
          })
        }
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing Windows updates response: ${error}`)
    }
  }

  // Analyze Windows Defender response for issues
  private async analyzeDefenderResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is DefenderData
      const isDefenderData = (data: ResponseData | null): data is DefenderData => {
        return data !== null &&
          typeof data === 'object' &&
          ('real_time_protection' in data || 'antivirus_enabled' in data || 'definitions_outdated' in data)
      }

      if (!isDefenderData(data)) {
        this.debug.log('debug', 'Data is not DefenderData format')
        return
      }

      const defenderData = data as DefenderData

      if (defenderData.real_time_protection === false || defenderData.antivirus_enabled === false) {
        await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'WindowsDefender',
          severity: 'critical',
          description: 'Windows Defender real-time protection is disabled',
          details: defenderData
        })

        await this.vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
          checkType: 'WindowsDefender',
          remediationType: 'AutoFixDefender',
          description: 'Enable Windows Defender real-time protection',
          isAutomatic: true,
          estimatedTime: '1-2 minutes',
          details: {}
        })
      }

      if (defenderData.definitions_outdated === true) {
        await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'WindowsDefender',
          severity: 'warning',
          description: 'Windows Defender definitions are outdated',
          details: { last_update: defenderData.last_definition_update }
        })
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing Defender response: ${error}`)
    }
  }

  // Analyze disk space response for issues
  private async analyzeDiskSpaceResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is DiskSpaceData
      const isDiskSpaceData = (data: ResponseData | null): data is DiskSpaceData => {
        return data !== null &&
          typeof data === 'object' &&
          'drives' in data &&
          Array.isArray((data as DiskSpaceData).drives)
      }

      if (!isDiskSpaceData(data)) {
        this.debug.log('debug', 'Data is not DiskSpaceData format')
        return
      }

      const diskData = data as DiskSpaceData

      if (diskData.drives && Array.isArray(diskData.drives)) {
        for (const drive of diskData.drives) {
          const usagePercent = (drive.used_gb / drive.total_gb) * 100

          if (usagePercent > 90) {
            await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
              checkType: 'DiskSpace',
              severity: 'critical',
              description: `Drive ${drive.drive_letter} is ${usagePercent.toFixed(1)}% full`,
              details: drive
            })

            await this.vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
              checkType: 'DiskSpace',
              remediationType: 'DiskCleanup',
              description: `Clean up temporary files on drive ${drive.drive_letter}`,
              isAutomatic: true,
              estimatedTime: '5-10 minutes',
              details: { drive: drive.drive_letter }
            })
          } else if (usagePercent > 80) {
            await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
              checkType: 'DiskSpace',
              severity: 'warning',
              description: `Drive ${drive.drive_letter} is ${usagePercent.toFixed(1)}% full`,
              details: drive
            })
          }
        }
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing disk space response: ${error}`)
    }
  }

  // Analyze resource optimization response
  private async analyzeResourceOptimizationResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is ResourceOptimizationData
      const isResourceOptimizationData = (data: ResponseData | null): data is ResourceOptimizationData => {
        return data !== null &&
          typeof data === 'object' &&
          ('cpu_optimization_available' in data || 'memory_optimization_available' in data || 'disk_optimization_available' in data)
      }

      if (!isResourceOptimizationData(data)) {
        this.debug.log('debug', 'Data is not ResourceOptimizationData format')
        return
      }

      const optimizationData = data as ResourceOptimizationData

      if (optimizationData.cpu_optimization_available || optimizationData.memory_optimization_available) {
        await this.vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
          checkType: 'ResourceOptimization',
          remediationType: 'AutoOptimizeDisk',
          description: 'System resources can be optimized for better performance',
          isAutomatic: false,
          estimatedTime: '10-15 minutes',
          details: optimizationData
        })
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing resource optimization response: ${error}`)
    }
  }

  // Analyze general health check response
  private async analyzeHealthCheckResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is HealthCheckData
      const isHealthCheckData = (data: ResponseData | null): data is HealthCheckData => {
        return data !== null &&
          typeof data === 'object' &&
          ('overall_health' in data || 'checks' in data)
      }

      if (!isHealthCheckData(data)) {
        this.debug.log('debug', 'Data is not HealthCheckData format')
        return
      }

      const healthData = data as HealthCheckData

      if (healthData.overall_health === 'Critical' || healthData.overall_health === 'Warning') {
        await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'HealthCheck',
          severity: healthData.overall_health === 'Critical' ? 'critical' : 'warning',
          description: `System health check detected ${healthData.overall_health.toLowerCase()} issues`,
          details: healthData
        })
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing health check response: ${error}`)
    }
  }

  // Analyze remediation command responses
  private async analyzeRemediationResponse (vmId: string, commandType: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager) return

    try {
      const success = response.success && (!response.exit_code || response.exit_code === 0)

      await this.vmEventManager.handleAutoCheckRemediationCompleted(vmId, {
        checkType: this.getCheckTypeFromRemediationCommand(commandType),
        remediationType: commandType,
        success,
        description: success
          ? `${commandType} completed successfully`
          : `${commandType} failed to complete`,
        executionTime: response.execution_time_ms ? `${response.execution_time_ms}ms` : undefined,
        details: data,
        error: success ? undefined : (response.error || response.stderr || 'Unknown error')
      })
    } catch (error) {
      this.debug.log('error', `Error analyzing remediation response: ${error}`)
    }
  }

  // Analyze Defender scan response
  private async analyzeDefenderScanResponse (vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    if (!this.vmEventManager || !data) return

    try {
      // Type guard to check if data is DefenderScanData
      const isDefenderScanData = (data: ResponseData | null): data is DefenderScanData => {
        return data !== null &&
          typeof data === 'object' &&
          ('threats_found' in data || 'scan_duration' in data || 'threats' in data)
      }

      if (!isDefenderScanData(data)) {
        this.debug.log('debug', 'Data is not DefenderScanData format')
        return
      }

      const scanData = data as DefenderScanData

      if (scanData.threats_found && scanData.threats_found > 0) {
        await this.vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'DefenderScan',
          severity: 'critical',
          description: `Windows Defender scan found ${scanData.threats_found} threats`,
          details: scanData
        })
      }
    } catch (error) {
      this.debug.log('error', `Error analyzing Defender scan response: ${error}`)
    }
  }

  // Helper method to map remediation commands to their check types
  private getCheckTypeFromRemediationCommand (commandType: string): string {
    const mapping: Record<string, string> = {
      AutoFixWindowsUpdates: 'WindowsUpdates',
      AutoFixDefender: 'WindowsDefender',
      AutoOptimizeDisk: 'ResourceOptimization',
      DiskCleanup: 'DiskSpace'
    }
    return mapping[commandType] || commandType
  }

  // Store metrics in database
  private async storeMetrics (vmId: string, message: MetricsMessage): Promise<void> {
    try {
      const { data } = message

      // Log the incoming data structure for debugging
      this.debug.log('debug', `Metrics data structure for VM ${vmId}:`)
      this.debug.log('debug', `- system.cpu: ${JSON.stringify(data.system?.cpu)}`)
      this.debug.log('debug', `- system.memory: ${JSON.stringify(data.system?.memory)}`)
      this.debug.log('debug', `- system.disk: ${JSON.stringify(data.system?.disk)}`)
      this.debug.log('debug', `- system.network: ${JSON.stringify(data.system?.network)}`)
      this.debug.log('debug', `- system.uptime_seconds: ${data.system?.uptime_seconds}`)

      // Validate required fields exist
      if (!data.system) {
        this.debug.log('error', `Missing 'system' field in metrics data for VM ${vmId}`)
        return
      }

      if (!data.system.memory) {
        this.debug.log('error', `Missing 'system.memory' field in metrics data for VM ${vmId}`)
        return
      }

      // Store system metrics
      // InfiniService now correctly sends memory values in KB as the field names indicate
      const systemMetrics = await this.prisma.systemMetrics.create({
        data: {
          machineId: vmId,
          cpuUsagePercent: data.system.cpu.usage_percent,
          cpuCoresUsage: data.system.cpu.cores_usage,
          cpuTemperature: data.system.cpu.temperature,
          totalMemoryKB: BigInt(data.system.memory.total_kb),
          usedMemoryKB: BigInt(data.system.memory.used_kb),
          availableMemoryKB: BigInt(data.system.memory.available_kb),
          swapTotalKB: data.system.memory.swap_total_kb ? BigInt(data.system.memory.swap_total_kb) : null,
          swapUsedKB: data.system.memory.swap_used_kb ? BigInt(data.system.memory.swap_used_kb) : null,
          diskUsageStats: data.system.disk.usage_stats,
          diskIOStats: data.system.disk.io_stats,
          networkStats: data.system.network.interfaces,
          uptime: data.system.uptime_seconds !== undefined && data.system.uptime_seconds !== null
            ? BigInt(data.system.uptime_seconds)
            : BigInt(0),
          loadAverage: data.system.load_average,
          timestamp: new Date(message.timestamp)
        }
      })

      // Extract and update VM IP addresses from network interfaces
      await this.updateVmIpAddresses(vmId, data.system.network.interfaces)

      // Store process snapshots
      if (data.processes && data.processes.length > 0) {
        await this.prisma.processSnapshot.createMany({
          data: data.processes.map(proc => ({
            machineId: vmId,
            processId: proc.pid,
            parentPid: proc.ppid,
            name: proc.name,
            executablePath: proc.exe_path,
            commandLine: proc.cmd_line,
            cpuUsagePercent: proc.cpu_percent,
            memoryUsageKB: BigInt(proc.memory_kb), // Now correctly in KB
            diskReadBytes: proc.disk_read_bytes ? BigInt(proc.disk_read_bytes) : null,
            diskWriteBytes: proc.disk_write_bytes ? BigInt(proc.disk_write_bytes) : null,
            status: proc.status,
            startTime: proc.start_time ? new Date(proc.start_time) : null,
            timestamp: new Date(message.timestamp)
          }))
        })
      }

      // Store/update application usage
      if (data.applications && data.applications.length > 0) {
        for (const app of data.applications) {
          await this.prisma.applicationUsage.upsert({
            where: {
              machineId_executablePath: {
                machineId: vmId,
                executablePath: app.exe_path
              }
            },
            update: {
              applicationName: app.name,
              version: app.version,
              description: app.description,
              publisher: app.publisher,
              lastAccessTime: app.last_access ? new Date(app.last_access) : null,
              lastModifiedTime: app.last_modified ? new Date(app.last_modified) : null,
              accessCount: app.access_count,
              totalUsageMinutes: app.usage_minutes,
              fileSize: app.file_size ? BigInt(app.file_size) : null,
              isActive: app.is_active,
              lastSeen: new Date()
            },
            create: {
              machineId: vmId,
              executablePath: app.exe_path,
              applicationName: app.name,
              version: app.version,
              description: app.description,
              publisher: app.publisher,
              lastAccessTime: app.last_access ? new Date(app.last_access) : null,
              lastModifiedTime: app.last_modified ? new Date(app.last_modified) : null,
              accessCount: app.access_count,
              totalUsageMinutes: app.usage_minutes,
              fileSize: app.file_size ? BigInt(app.file_size) : null,
              isActive: app.is_active
            }
          })
        }
      }

      // Store port usage
      if (data.ports && data.ports.length > 0) {
        // Clear old port data first
        await this.prisma.portUsage.deleteMany({
          where: {
            machineId: vmId,
            timestamp: {
              lt: new Date(Date.now() - 5 * 60 * 1000) // Delete entries older than 5 minutes
            }
          }
        })

        // Insert new port data
        await this.prisma.portUsage.createMany({
          data: data.ports.map(port => ({
            machineId: vmId,
            port: port.port,
            protocol: port.protocol,
            state: port.state,
            processId: port.pid,
            processName: port.process_name,
            executablePath: port.exe_path,
            isListening: port.is_listening,
            connectionCount: port.connection_count,
            timestamp: new Date(message.timestamp)
          }))
        })
      }

      // Store Windows services
      if (data.windows_services && data.windows_services.length > 0) {
        for (const service of data.windows_services) {
          const existingService = await this.prisma.windowsService.findUnique({
            where: {
              machineId_serviceName: {
                machineId: vmId,
                serviceName: service.name
              }
            }
          })

          // Track state changes
          if (existingService && existingService.currentState !== service.state) {
            await this.prisma.serviceStateHistory.create({
              data: {
                serviceId: existingService.id,
                fromState: existingService.currentState,
                toState: service.state,
                reason: 'automatic',
                timestamp: new Date(message.timestamp)
              }
            })
          }

          // Update or create service
          await this.prisma.windowsService.upsert({
            where: {
              machineId_serviceName: {
                machineId: vmId,
                serviceName: service.name
              }
            },
            update: {
              displayName: service.display_name,
              description: service.description,
              startType: service.start_type,
              serviceType: service.service_type,
              executablePath: service.exe_path,
              dependencies: service.dependencies,
              currentState: service.state,
              processId: service.pid,
              lastStateChange: existingService?.currentState !== service.state
                ? new Date(message.timestamp)
                : existingService?.lastStateChange,
              stateChangeCount: existingService?.currentState !== service.state
                ? (existingService?.stateChangeCount || 0) + 1
                : existingService?.stateChangeCount,
              isDefaultService: service.is_default,
              lastSeen: new Date()
            },
            create: {
              machineId: vmId,
              serviceName: service.name,
              displayName: service.display_name,
              description: service.description,
              startType: service.start_type,
              serviceType: service.service_type,
              executablePath: service.exe_path,
              dependencies: service.dependencies,
              currentState: service.state,
              processId: service.pid,
              isDefaultService: service.is_default,
              lastStateChange: new Date(message.timestamp)
            }
          })
        }
      }

      // Emit event for real-time update
      const formattedMetrics = {
        ...systemMetrics,
        cpuCoresUsage: systemMetrics.cpuCoresUsage as number[],
        totalMemoryKB: Number(systemMetrics.totalMemoryKB),
        usedMemoryKB: Number(systemMetrics.usedMemoryKB),
        availableMemoryKB: Number(systemMetrics.availableMemoryKB),
        swapTotalKB: systemMetrics.swapTotalKB ? Number(systemMetrics.swapTotalKB) : undefined,
        swapUsedKB: systemMetrics.swapUsedKB ? Number(systemMetrics.swapUsedKB) : undefined,
        uptime: Number(systemMetrics.uptime)
      }

      // Emit metrics update event that can be handled by other services
      this.emit('metricsUpdated', {
        vmId,
        metrics: formattedMetrics
      })

      this.debug.log('metrics', `Stored metrics for VM ${vmId}`)
    } catch (error) {
      this.debug.log('error', `Failed to store metrics for VM ${vmId}: ${error}`)
      // Log more details about the specific error
      if (error instanceof Error) {
        this.debug.log('error', `Error details: ${error.stack}`)
      }
      // Log the problematic data that caused the error
      this.debug.log('error', `Problematic message data: ${JSON.stringify(message, null, 2)}`)
    }
  }

  // Send message to VM with enhanced transmission tracking
  private sendMessage (connection: VmConnection, message: OutgoingMessage): void {
    const sendStartTime = Date.now()

    if (!connection.isConnected) {
      this.debug.log('warn', `Cannot send message to disconnected VM ${connection.vmId} (quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%)`)
      connection.messageStats.errors++
      return
    }

    try {
      const messageStr = JSON.stringify(message) + '\n'
      const messageSize = Buffer.byteLength(messageStr, 'utf8')

      this.debug.log('debug', `📤 Sending message to VM ${connection.vmId}: size=${messageSize} bytes, type=${message.type || 'unknown'}`)
      this.debug.log('debug', `Message preview: ${messageStr.slice(0, 200)}${messageStr.length > 200 ? '...' : ''}`)

      connection.socket.write(messageStr)

      // Update transmission statistics
      connection.messageStats.sent++
      connection.messageStats.totalBytes += messageSize
      connection.lastSuccessfulTransmission = new Date()

      const transmissionTime = Date.now() - sendStartTime
      if (transmissionTime > 100) { // Log slow transmissions
        this.debug.log('warn', `Slow message transmission to VM ${connection.vmId}: ${transmissionTime}ms for ${messageSize} bytes`)
      }

      this.debug.log('debug', `✅ Message sent to VM ${connection.vmId} in ${transmissionTime}ms (total sent: ${connection.messageStats.sent})`)
    } catch (error) {
      connection.messageStats.errors++
      connection.transmissionFailureCount++

      // Update connection quality on transmission failure
      connection.connectionQuality = 'poor'
      connection.connectionStabilityScore = Math.max(0, connection.connectionStabilityScore - 15)

      this.debug.log('error', `Failed to send message to VM ${connection.vmId}: ${error} (failures: ${connection.transmissionFailureCount}, quality: ${connection.connectionQuality})`)
      this.debug.log('debug', `Transmission failure context: uptime=${Date.now() - connection.connectionStartTime.getTime()}ms, stability=${connection.connectionStabilityScore}%`)
    }
  }

  // Public method to send safe commands to a VM
  public async sendSafeCommand (
    vmId: string,
    commandType: SafeCommandType,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const connection = this.connections.get(vmId)
    if (!connection) {
      throw new Error(`No connection to VM ${vmId}`)
    }

    if (!connection.isConnected) {
      // Try to reconnect once before failing
      this.debug.log('warn', `VM ${vmId} is not connected, attempting reconnection...`)

      // Check if socket file still exists
      const socketPath = connection.socketPath
      if (socketPath && require('fs').existsSync(socketPath)) {
        await this.connectToVm(vmId, socketPath)
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Check again
        const updatedConnection = this.connections.get(vmId)
        if (!updatedConnection || !updatedConnection.isConnected) {
          throw new Error(`VM ${vmId} is not connected and reconnection failed`)
        }
      } else {
        throw new Error(`VM ${vmId} is not connected and socket file not found`)
      }
    }

    const commandId = uuidv4()

    return new Promise<CommandResponse>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        connection.pendingCommands.delete(commandId)
        reject(new Error(`Command timeout after ${timeout}ms`))
      }, timeout)

      // Store pending command
      connection.pendingCommands.set(commandId, {
        resolve,
        reject,
        timeout: timeoutHandle
      })

      // Build the command_type object with proper serde tag format
      // InfiniService expects SafeCommandType with #[serde(tag = "action")]
      let commandTypeFormatted: FormattedCommandType

      switch (commandType.action) {
      case 'PackageSearch':
        commandTypeFormatted = {
          action: 'PackageSearch',
          query: commandType.params?.query || ''
        }
        break
      case 'PackageInstall':
        commandTypeFormatted = {
          action: 'PackageInstall',
          package: commandType.params?.package || ''
        }
        break
      case 'PackageRemove':
        commandTypeFormatted = {
          action: 'PackageRemove',
          package: commandType.params?.package || ''
        }
        break
      case 'PackageUpdate':
        commandTypeFormatted = {
          action: 'PackageUpdate',
          package: commandType.params?.package || ''
        }
        break
      case 'PackageList':
        commandTypeFormatted = { action: 'PackageList' }
        break
      case 'ServiceList':
        commandTypeFormatted = { action: 'ServiceList' }
        break
      case 'SystemInfo':
        commandTypeFormatted = { action: 'SystemInfo' }
        break
      case 'OsInfo':
        commandTypeFormatted = { action: 'OsInfo' }
        break
      case 'ProcessList':
        commandTypeFormatted = {
          action: 'ProcessList',
          limit: commandType.params?.limit || null
        }
        break
      case 'ProcessKill':
        commandTypeFormatted = {
          action: 'ProcessKill',
          pid: commandType.params?.pid,
          force: commandType.params?.force || null
        }
        break
      case 'ProcessTop':
        commandTypeFormatted = {
          action: 'ProcessTop',
          limit: commandType.params?.limit || null,
          sort_by: commandType.params?.sort_by || null
        }
        break
        // Maintenance commands
      case 'ExecutePowerShellScript':
        commandTypeFormatted = {
          action: 'ExecutePowerShellScript',
          script: commandType.params?.script || '',
          script_type: commandType.params?.script_type || 'inline',
          timeout_seconds: commandType.params?.timeout_seconds || undefined,
          working_directory: commandType.params?.working_directory || undefined,
          environment_vars: commandType.params?.environment_vars || undefined,
          run_as_admin: commandType.params?.run_as_admin || false
        }
        break
      case 'RunMaintenanceTask':
        commandTypeFormatted = {
          action: 'RunMaintenanceTask',
          task_type: commandType.params?.task_type || '',
          task_name: commandType.params?.task_name || '',
          parameters: commandType.params?.parameters || undefined,
          validate_before: commandType.params?.validate_before || false,
          validate_after: commandType.params?.validate_after || false
        }
        break
      case 'ValidateSystemHealth':
        commandTypeFormatted = {
          action: 'ValidateSystemHealth',
          check_name: commandType.params?.check_name || undefined
        }
        break
      case 'CleanTemporaryFiles':
        commandTypeFormatted = {
          action: 'CleanTemporaryFiles',
          targets: commandType.params?.targets || undefined
        }
        break
      case 'UpdateSystemSoftware':
        commandTypeFormatted = {
          action: 'UpdateSystemSoftware',
          package: commandType.params?.package || undefined
        }
        break
      case 'RestartServices':
        commandTypeFormatted = {
          action: 'RestartServices',
          service_name: commandType.params?.service_name || undefined
        }
        break
      case 'CheckSystemIntegrity':
        commandTypeFormatted = {
          action: 'CheckSystemIntegrity'
        }
        break
      default:
        commandTypeFormatted = { action: commandType.action }
      }

      // Build the complete message with IncomingMessage structure
      // IncomingMessage has #[serde(tag = "type")] internally-tagged enum
      // With internally-tagged enums, the variant's fields are flattened into the same object
      const message = {
        type: 'SafeCommand',
        id: commandId,
        command_type: commandTypeFormatted,
        params: null, // Not used, params are in command_type
        timeout: Math.floor(timeout / 1000) // Convert to seconds for InfiniService
      }

      this.debug.log('debug', `Sending safe command ${commandId} to VM ${vmId}: ${JSON.stringify(message)}`)
      this.sendMessage(connection, message)
    })
  }

  // Public method to send unsafe (raw) commands to a VM
  public async sendUnsafeCommand (
    vmId: string,
    rawCommand: string,
    options: Partial<UnsafeCommandRequest> = {},
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const connection = this.connections.get(vmId)
    if (!connection) {
      throw new Error(`No connection to VM ${vmId}`)
    }

    if (!connection.isConnected) {
      // Try to reconnect once before failing
      this.debug.log('warn', `VM ${vmId} is not connected, attempting reconnection...`)

      // Check if socket file still exists
      const socketPath = connection.socketPath
      if (socketPath && require('fs').existsSync(socketPath)) {
        await this.connectToVm(vmId, socketPath)
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Check again
        const updatedConnection = this.connections.get(vmId)
        if (!updatedConnection || !updatedConnection.isConnected) {
          throw new Error(`VM ${vmId} is not connected and reconnection failed`)
        }
      } else {
        throw new Error(`VM ${vmId} is not connected and socket file not found`)
      }
    }

    const commandId = uuidv4()

    return new Promise<CommandResponse>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        connection.pendingCommands.delete(commandId)
        reject(new Error(`Command timeout after ${timeout}ms`))
      }, timeout)

      // Store pending command
      connection.pendingCommands.set(commandId, {
        resolve,
        reject,
        timeout: timeoutHandle
      })

      // Send command with proper serde-tagged format
      // With internally-tagged enums, the variant's fields are flattened into the same object
      const message = {
        type: 'UnsafeCommand',
        id: commandId,
        raw_command: rawCommand,
        shell: options.shell,
        timeout: Math.floor(timeout / 1000),
        working_dir: options.workingDir,
        env_vars: options.envVars
      }

      this.debug.log('debug', `Sending unsafe command ${commandId} to VM ${vmId}: ${rawCommand}`)
      this.sendMessage(connection, message)
    })
  }

  // Helper method specifically for package management commands
  public async sendPackageCommand (
    vmId: string,
    action: 'PackageList' | 'PackageInstall' | 'PackageRemove' | 'PackageUpdate' | 'PackageSearch',
    packageName?: string,
    timeout: number = 45000 // 45 second default timeout for package operations
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action,
      params: packageName ? { package: packageName } : undefined
    }

    if (action === 'PackageSearch' && packageName) {
      commandType.params = { query: packageName }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method specifically for process control commands
  public async sendProcessCommand (
    vmId: string,
    action: 'ProcessList' | 'ProcessKill' | 'ProcessTop',
    params?: { pid?: number; force?: boolean; limit?: number; sort_by?: string },
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action,
      params
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Enhanced connection health monitoring with detailed diagnostics
  private startHealthMonitoring (connection: VmConnection): void {
    // Clear existing timer
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }

    this.debug.log('info', `🔍 Starting health monitoring for VM ${connection.vmId} (timeout=${this.messageTimeout}ms, interval=${this.pingInterval}ms)`)

    connection.pingTimer = setInterval(() => {
      const now = Date.now()
      const healthCheckStartTime = Date.now()
      connection.lastHealthCheckTime = new Date()

      // Check if connection is stale
      const timeSinceLastMessage = now - connection.lastMessageTime.getTime()
      const connectionUptime = now - connection.connectionStartTime.getTime()

      // Perform comprehensive health assessment
      let healthCheckSuccess = true
      let healthLatency: number | undefined
      let healthError: string | undefined

      // Increase staleness threshold multiplier from 1x to 1.5x messageTimeout
      const stalenessThreshold = this.messageTimeout * 1.5

      // Add grace period for first health check after connection establishment (5 minutes)
      const graceTimeAfterConnection = 300000
      const inGracePeriod = connectionUptime < graceTimeAfterConnection

      if (timeSinceLastMessage > stalenessThreshold && !inGracePeriod) {
        healthCheckSuccess = false
        healthError = `Message timeout: ${Math.round(timeSinceLastMessage / 1000)}s since last message`

        // Implement progressive quality degradation instead of immediate critical marking
        if (timeSinceLastMessage > stalenessThreshold * 2) {
          connection.connectionQuality = 'critical'
          connection.connectionStabilityScore = Math.max(0, connection.connectionStabilityScore - 15) // Reduced penalty
        } else if (timeSinceLastMessage > stalenessThreshold * 1.5) {
          connection.connectionQuality = 'poor'
          connection.connectionStabilityScore = Math.max(10, connection.connectionStabilityScore - 8) // Reduced penalty
        } else {
          connection.connectionQuality = 'good' // Progressive degradation
          connection.connectionStabilityScore = Math.max(20, connection.connectionStabilityScore - 5) // Minimal penalty
        }

        this.debug.log('warn', `Connection to VM ${connection.vmId} appears stale (${Math.round(timeSinceLastMessage / 1000)}s since last message), quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
        this.debug.log('debug', `Health check context: uptime=${connectionUptime}ms, msgs_sent=${connection.messageStats.sent}, msgs_received=${connection.messageStats.received}, errors=${connection.messageStats.errors}`)

        // Only trigger reconnection for critical state
        if (connection.connectionQuality === 'critical') {
          this.handleConnectionError(connection)
        }
      } else {
        // Connection appears healthy
        healthLatency = Date.now() - healthCheckStartTime

        // Update connection quality based on responsiveness
        if (timeSinceLastMessage < this.pingInterval / 2) {
          connection.connectionQuality = 'excellent'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 2)
        } else if (timeSinceLastMessage < this.pingInterval) {
          connection.connectionQuality = 'good'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 1)
        }

        this.debug.log('debug', `Health check passed for VM ${connection.vmId}: last_msg=${Math.round(timeSinceLastMessage / 1000)}s ago, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
      }

      // Record health check result
      const healthResult: HealthCheckResult = {
        timestamp: new Date(),
        success: healthCheckSuccess,
        latency: healthLatency,
        error: healthError
      }

      connection.healthCheckResults.push(healthResult)

      // Keep only last 50 health check results
      if (connection.healthCheckResults.length > 50) {
        connection.healthCheckResults = connection.healthCheckResults.slice(-50)
      }

      // Log periodic health summary
      const recentResults = connection.healthCheckResults.slice(-10) // Last 10 checks
      const successRate = recentResults.filter(r => r.success).length / recentResults.length
      const avgLatency = recentResults
        .filter(r => r.latency !== undefined)
        .reduce((sum, r) => sum + (r.latency || 0), 0) / Math.max(1, recentResults.filter(r => r.latency !== undefined).length)

      if (connection.healthCheckResults.length % 10 === 0) { // Every 10th check
        this.debug.log('info', `📊 Health summary for VM ${connection.vmId}: success_rate=${(successRate * 100).toFixed(1)}%, avg_latency=${avgLatency.toFixed(1)}ms, stability=${connection.connectionStabilityScore}%`)
      }
    }, this.pingInterval)
  }

  // Handle detailed error report from InfiniService
  private async handleErrorReport (connection: VmConnection, errorReport: ErrorReportMessage): Promise<void> {
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
    this.debug.log(logLevel, `🔧 Error report from VM ${connection.vmId}: ${errorReport.error_type} (${errorReport.severity}) - retry ${errorReport.retry_attempt}/${errorReport.max_retries}`)

    if (errorReport.recovery_suggestion) {
      this.debug.log('info', `💡 Recovery suggestion for VM ${connection.vmId}: ${errorReport.recovery_suggestion}`)
    }

    // Make intelligent reconnection decisions based on error type
    if (errorReport.severity === 'Fatal') {
      this.debug.log('error', `💀 Fatal error reported by VM ${connection.vmId}: ${errorReport.error_type}. Stopping reconnection attempts.`)
      this.closeConnection(connection.vmId, 'fatal_error')
    } else if (errorReport.severity === 'Recoverable') {
      // Adjust reconnection strategy based on error type
      this.adjustReconnectionStrategy(connection, errorReport)
    }

    // Track last recovery attempt time
    connection.lastRecoveryAttempt = new Date()
  }

  // Connection pooling management
  private expandConnectionPool (connection: VmConnection): void {
    // Add alternative socket paths for the VM
    const vmId = connection.vmId
    const alternativePaths = [
      `/opt/infinibay/sockets/${vmId}.sock`,
      `/tmp/infinibay/${vmId}.sock`,
      `/run/infinibay/${vmId}.sock`
    ]

    // Add paths that don't already exist in the pool
    for (const path of alternativePaths) {
      if (!connection.socketPaths.includes(path)) {
        connection.socketPaths.push(path)
      }
    }

    this.debug.log('debug', `📡 Connection pool for VM ${vmId} expanded to ${connection.socketPaths.length} paths`)
  }

  private rotateToNextSocket (connection: VmConnection): string {
    // Rotate to the next socket path in the pool
    connection.currentSocketIndex = (connection.currentSocketIndex + 1) % connection.socketPaths.length
    const nextPath = connection.socketPaths[connection.currentSocketIndex]

    this.debug.log('debug', `🔄 Rotating to socket path ${connection.currentSocketIndex + 1}/${connection.socketPaths.length} for VM ${connection.vmId}: ${nextPath}`)
    return nextPath
  }

  // Adjust reconnection strategy based on error classification
  private adjustReconnectionStrategy (connection: VmConnection, errorReport: ErrorReportMessage): void {
    // Adjust timeouts and retry counts based on error type
    if (errorReport.error_type === 'ACCESS_DENIED') {
      // Longer delays for permission issues
      connection.reconnectBaseDelayMs = Math.max(connection.reconnectBaseDelayMs, 5000)
      this.debug.log('info', `🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for ACCESS_DENIED errors on VM ${connection.vmId}`)
    } else if (errorReport.error_type === 'BROKEN_PIPE' || errorReport.error_type === 'IO_BROKEN_PIPE') {
      // Shorter delays for connection issues
      connection.reconnectBaseDelayMs = Math.min(connection.reconnectBaseDelayMs, 2000)
      this.debug.log('info', `🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for pipe errors on VM ${connection.vmId}`)
    } else if (errorReport.error_type === 'FILE_NOT_FOUND' || errorReport.error_type === 'IO_NOT_FOUND') {
      // Medium delays for device availability issues
      connection.reconnectBaseDelayMs = Math.min(Math.max(connection.reconnectBaseDelayMs, 3000), 8000)
      this.debug.log('info', `🔧 Adjusting reconnection delay to ${connection.reconnectBaseDelayMs}ms for device not found errors on VM ${connection.vmId}`)
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

    this.debug.log('debug', `🔧 Connection quality for VM ${connection.vmId} updated to: ${connection.connectionQuality}`)
  }

  // Handle connection error
  private handleConnectionError (connection: VmConnection): void {
    connection.isConnected = false

    // Clear ping timer
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
      connection.pingTimer = undefined
    }

    // Clear existing reconnect timer
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
      connection.reconnectTimer = undefined
    }

    // Check if we should attempt reconnection
    if (connection.reconnectAttempts >= this.maxReconnectAttempts) {
      this.debug.log('warn', `Max reconnection attempts (${this.maxReconnectAttempts}) reached for VM ${connection.vmId}, giving up`)
      this.closeConnection(connection.vmId, 'cleanup or error')
      return
    }

    // Calculate exponential backoff delay with smaller multiplier (1.5 instead of 2)
    const delay = Math.min(
      connection.reconnectBaseDelayMs * Math.pow(1.5, connection.reconnectAttempts),
      this.maxReconnectDelay
    )

    connection.reconnectAttempts++
    this.debug.log('debug', `🔄 Will attempt reconnection ${connection.reconnectAttempts}/${this.maxReconnectAttempts} for VM ${connection.vmId} in ${delay}ms`)

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
          this.debug.log('debug', `Socket file not accessible, rotating to alternative: ${currentSocketPath}`)

          // Update the connection's socketPath to the new one
          connection.socketPath = currentSocketPath

          // Try the new socket
          this.debug.log('debug', `🔄 Attempting reconnection for VM ${connection.vmId} with alternative socket`)
          this.connectToVm(connection.vmId, currentSocketPath)
        } else if (err) {
          this.debug.log('debug', `Socket file no longer exists for VM ${connection.vmId}, stopping reconnection`)
          this.closeConnection(connection.vmId, 'cleanup or error')
        } else {
          this.debug.log('debug', `🔄 Attempting reconnection for VM ${connection.vmId}`)
          this.connectToVm(connection.vmId, currentSocketPath)
        }
      })
    }, delay)
  }

  // Handle connection closed
  private handleConnectionClosed (connection: VmConnection): void {
    // If this was an intentional close, don't reconnect
    if (!this.isRunning) {
      this.closeConnection(connection.vmId, 'cleanup or error')
      return
    }

    // Otherwise, treat as error and attempt reconnection
    this.handleConnectionError(connection)
  }

  // Close and clean up a connection with enhanced diagnostics
  private closeConnection (vmId: string, reason: string = 'unknown'): void {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return
    }

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

    this.debug.log('info', `🔌 Closing connection for VM ${vmId} (reason: ${reason}, duration: ${connectionDuration}ms, unexpected: ${wasUnexpected})`)
    this.debug.log('debug', `Connection summary: sent=${connection.messageStats.sent}, received=${connection.messageStats.received}, errors=${connection.messageStats.errors}, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)

    // Only reject pending commands if this is unexpected
    const pendingCount = connection.pendingCommands.size
    if (pendingCount > 0) {
      this.debug.log('warn', `Found ${pendingCount} pending commands for VM ${vmId}`)

      for (const [commandId, pending] of connection.pendingCommands) {
        clearTimeout(pending.timeout)
        const error = new Error(`Connection to VM ${vmId} closed (${reason}) while command ${commandId} was pending`)
        pending.reject(error)
        this.debug.log('warn', `Rejected pending command ${commandId} due to connection close for VM ${vmId}`)
      }
      connection.pendingCommands.clear()
    }

    // Clear timers
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }
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

  // Get comprehensive connection statistics with enhanced diagnostics
  getConnectionStats (): {
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
      // Enhanced diagnostics
      connectionDuration: number
      messageStats: MessageStats
      connectionQuality: string
      connectionStabilityScore: number
      recentHealthChecks: HealthCheckResult[]
      transmissionFailures: number
      lastSuccessfulTransmission?: Date
      disconnectionCount: number
      messageTypeCounts: Record<string, number>
      // Enhanced error tracking statistics
      errorClassificationHistory: ErrorReportMessage[]
      recoverableErrorCount: number
      fatalErrorCount: number
      lastErrorReport?: ErrorReportMessage
      lastRecoveryAttempt?: Date
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
    } {
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
      lastRecoveryAttempt: conn.lastRecoveryAttempt
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
      ipDetectionStats: {
        totalVmsWithIPs: 0, // Would be enhanced with actual tracking
        recentIPUpdates: 0 // Would be enhanced with actual tracking
      },
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

  // Get pending commands for a VM
  public getPendingCommands (vmId: string): string[] {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return []
    }
    return Array.from(connection.pendingCommands.keys())
  }

  // Cancel a specific pending command
  public cancelCommand (vmId: string, commandId: string): boolean {
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
    this.debug.log('info', `Command ${commandId} cancelled for VM ${vmId}`)
    return true
  }

  // Cancel all pending commands for a VM
  public cancelAllCommands (vmId: string): number {
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
    this.debug.log('info', `Cancelled ${count} pending commands for VM ${vmId}`)
    return count
  }

  // Execute command with retry logic
  public async executeCommandWithRetry (
    vmId: string,
    commandBuilder: () => Promise<CommandResponse>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<CommandResponse> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.debug.log('debug', `Executing command for VM ${vmId}, attempt ${attempt}/${maxRetries}`)
        const response = await commandBuilder()

        // If command succeeded or failed but got a response, return it
        if (response.success || attempt === maxRetries) {
          return response
        }

        // If command failed but we have retries left, wait and retry
        this.debug.log('warn', `Command failed for VM ${vmId}, retrying in ${retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      } catch (error) {
        lastError = error as Error
        this.debug.log('warn', `Command attempt ${attempt} failed for VM ${vmId}: ${error}`)

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }

    throw lastError || new Error(`Command failed after ${maxRetries} attempts`)
  }

  // Check if VM has active connection
  public isVmConnected (vmId: string): boolean {
    const connection = this.connections.get(vmId)
    return connection?.isConnected || false
  }

  // Check if the service is currently running
  public getServiceStatus (): boolean {
    return this.isRunning
  }

  // Get connection details for a VM
  public getConnectionDetails (vmId: string): { isConnected: boolean; socketPath?: string; lastMessageTime?: Date; errorCount?: number } | null {
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

  // Clean up connections for a deleted VM
  async cleanupVmConnection (vmId: string): Promise<void> {
    this.debug.log('debug', `Cleaning up connection for deleted VM ${vmId}`)
    this.closeConnection(vmId, 'manual cleanup')

    // Also try to remove the socket file if it exists
    const socketPath = path.join(this.socketDir, `${vmId}.socket`)
    try {
      await fs.promises.unlink(socketPath)
      this.debug.log('debug', `Removed socket file for VM ${vmId}`)
    } catch (error) {
      // Socket file might not exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.debug.log('warn', `Failed to remove socket file for VM ${vmId}: ${error}`)
      }
    }
  }

  // Process health check queue when VM connects
  private processHealthCheckQueue (connection: VmConnection): void {
    if (!this.queueManager) {
      this.debug.log('debug', `⚕️ No queue manager available for VM ${connection.vmId}, skipping health check queue processing`)
      return
    }

    this.debug.log('info', `⚕️ Processing health check queue for VM ${connection.vmId}`)

    // Process any queued health checks for this VM
    setImmediate(async () => {
      try {
        await this.queueManager!.processQueue(connection.vmId)
      } catch (error) {
        this.debug.log('error', `Failed to process health queue for VM ${connection.vmId}: ${error}`)
      }
    })
  }

  // Helper method for executing PowerShell scripts
  public async sendMaintenancePowerShellScript (
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
    const commandType: SafeCommandType = {
      action: 'ExecutePowerShellScript',
      params: {
        script,
        script_type: options.scriptType || 'inline',
        timeout_seconds: options.timeoutSeconds,
        working_directory: options.workingDirectory,
        environment_vars: options.environmentVars,
        run_as_admin: options.runAsAdmin || false
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for running maintenance tasks
  public async sendMaintenanceTask (
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
    const commandType: SafeCommandType = {
      action: 'RunMaintenanceTask',
      params: {
        task_type: taskType,
        task_name: taskName,
        parameters,
        validate_before: options.validateBefore || false,
        validate_after: options.validateAfter || false
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for system health validation
  public async sendValidateSystemHealth (
    vmId: string,
    checkName?: string,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'ValidateSystemHealth',
      params: {
        check_name: checkName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for cleaning temporary files
  public async sendCleanTemporaryFiles (
    vmId: string,
    targets?: string[],
    timeout: number = 45000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'CleanTemporaryFiles',
      params: {
        targets
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for updating system software
  public async sendUpdateSystemSoftware (
    vmId: string,
    packageName?: string,
    timeout: number = 180000 // 3 minutes for software updates
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'UpdateSystemSoftware',
      params: {
        package: packageName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for restarting services
  public async sendRestartServices (
    vmId: string,
    serviceName?: string,
    timeout: number = 60000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'RestartServices',
      params: {
        service_name: serviceName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // Helper method for checking system integrity
  public async sendCheckSystemIntegrity (
    vmId: string,
    timeout: number = 120000 // 2 minutes for integrity checks
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'CheckSystemIntegrity'
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /**
   * Extract and update VM IP addresses from network interfaces with enhanced diagnostics
   */
  private async updateVmIpAddresses (vmId: string, interfaces: Array<{
    name: string
    bytes_received: number
    bytes_sent: number
    packets_received: number
    packets_sent: number
    ip_addresses?: string[]
    is_up?: boolean
  }>): Promise<void> {
    try {
      const totalInterfaces = interfaces.length
      const interfacesWithIPs = interfaces.filter(iface =>
        (iface.ip_addresses?.length || 0) > 0
      ).length
      const upInterfaces = interfaces.filter(iface =>
        (iface.is_up ?? true) // Treat undefined as true for backward compatibility
      ).length
      const upInterfacesWithIPs = interfaces.filter(iface =>
        (iface.is_up ?? true) && (iface.ip_addresses?.length || 0) > 0
      ).length

      this.debug.log('info', `Processing IP addresses for VM ${vmId}: ${totalInterfaces} total interfaces, ${interfacesWithIPs} with IPs, ${upInterfaces} UP, ${upInterfacesWithIPs} UP with IPs`)

      // Log individual interface details for diagnostics
      interfaces.forEach(iface => {
        const ipCount = iface.ip_addresses?.length || 0
        const isUp = iface.is_up ?? true
        this.debug.log('debug', `Interface ${iface.name}: is_up=${isUp}, ip_count=${ipCount}, ips=[${iface.ip_addresses?.join(', ') || 'none'}]`)
      })

      if (upInterfacesWithIPs === 0 && totalInterfaces > 0) {
        this.debug.log('warn', `No UP interfaces with IP addresses detected for VM ${vmId} (${totalInterfaces} total interfaces)`)
      }

      let localIP: string | null = null
      let publicIP: string | null = null
      let selectedInterface: string | null = null
      const allDetectedIPs: string[] = []

      // Enhanced IP extraction with prioritization
      for (const iface of interfaces) {
        // Handle undefined ip_addresses gracefully
        const ipAddresses = iface.ip_addresses || []
        const isUp = iface.is_up ?? true // Treat undefined as true for backward compatibility

        if (ipAddresses.length === 0 || !isUp) {
          continue
        }

        for (const ip of ipAddresses) {
          // Validate IP address format
          if (!this.isValidIPAddress(ip)) {
            this.debug.log('debug', `Skipping invalid IP address format: ${this.maskIP(ip)}`)
            continue
          }

          allDetectedIPs.push(ip)

          // Skip loopback and other special addresses
          if (this.isLoopbackAddress(ip)) {
            this.debug.log('debug', `Skipping loopback address: ${ip}`)
            continue
          }

          // Check if it's a private IP (local)
          if (this.isPrivateIP(ip)) {
            if (!localIP || this.shouldPreferIP(ip, localIP)) {
              localIP = ip
              selectedInterface = iface.name
              this.debug.log('debug', `Selected local IP ${this.maskIP(ip)} from interface ${iface.name}`)
            }
          } else {
            // Public IP
            if (!publicIP || this.shouldPreferIP(ip, publicIP)) {
              publicIP = ip
              selectedInterface = iface.name
              this.debug.log('debug', `Selected public IP ${this.maskIP(ip)} from interface ${iface.name}`)
            }
          }
        }
      }

      // Check if IPs have actually changed before updating
      const currentMachine = await this.prisma.machine.findUnique({
        where: { id: vmId },
        select: { localIP: true, publicIP: true }
      })

      if (!currentMachine) {
        this.debug.log('error', `VM ${vmId} not found in database during IP update`)
        return
      }

      const ipChanged = currentMachine.localIP !== localIP || currentMachine.publicIP !== publicIP

      if (!ipChanged) {
        this.debug.log('debug', `No IP changes detected for VM ${vmId}, skipping database update`)
        return
      }

      // Update the machine record with the detected IPs
      await this.prisma.machine.update({
        where: { id: vmId },
        data: {
          localIP,
          publicIP
        }
      }).catch(error => {
        // Handle database constraint errors gracefully
        if (error.code === 'P2025') {
          this.debug.log('warn', `VM ${vmId} no longer exists in database during IP update`)
        } else {
          throw error
        }
      })

      this.debug.log('info', `Updated IP addresses for VM ${vmId}: local=${this.maskIP(localIP)} (was ${this.maskIP(currentMachine.localIP)}), public=${this.maskIP(publicIP)} (was ${this.maskIP(currentMachine.publicIP)}), selected_interface=${selectedInterface}`)
      this.debug.log('info', `All detected IPs for VM ${vmId}: [${allDetectedIPs.map(ip => this.maskIP(ip)).join(', ')}]`)

      // Emit event for real-time updates only when IPs actually change
      if (this.vmEventManager) {
        // Determine if this is first IP detection or change
        const isFirstDetection = !currentMachine.localIP && !currentMachine.publicIP
        const eventType = isFirstDetection ? 'ip_first_detection' : 'ip_change'

        await this.vmEventManager.handleEvent('update', {
          id: vmId,
          oldLocalIP: currentMachine.localIP,
          oldPublicIP: currentMachine.publicIP,
          newLocalIP: localIP,
          newPublicIP: publicIP,
          selectedInterface,
          allDetectedIPs
        }, eventType)
      }
    } catch (error) {
      this.debug.log('error', `Failed to update IP addresses for VM ${vmId}: ${error}`)

      // Add context about which interface caused the error
      if (error instanceof Error) {
        this.debug.log('error', `Error details: ${error.stack}`)
      }

      // Log the interface data for debugging
      this.debug.log('error', `Interface data that caused error: ${JSON.stringify(interfaces, null, 2)}`)
    }
  }

  /**
   * Check if an IP address is private/local
   */
  private isPrivateIP (ip: string): boolean {
    // IPv4 private ranges:
    // 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    // 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
    // 169.254.0.0/16 (169.254.0.0 - 169.254.255.255) - Link-local

    if (ip.includes(':')) {
      // Enhanced IPv6 classification
      return this.isIPv6Private(ip)
    }

    const parts = ip.split('.').map(Number)
    if (parts.length !== 4) return false

    // 10.0.0.0/8
    if (parts[0] === 10) return true

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true

    // 169.254.0.0/16 (Link-local)
    if (parts[0] === 169 && parts[1] === 254) return true

    return false
  }

  /**
   * Validate that an IP address is properly formatted
   */
  private isValidIPAddress (ip: string): boolean {
    // Basic IPv4 validation
    if (!ip.includes(':')) {
      const parts = ip.split('.')
      if (parts.length !== 4) return false

      for (const part of parts) {
        const num = parseInt(part, 10)
        if (isNaN(num) || num < 0 || num > 255) return false
      }
      return true
    } else {
      // Enhanced IPv6 validation
      return this.isValidIPv6(ip)
    }
  }

  /**
   * Determine if one IP should be preferred over another
   * Prioritizes non-link-local addresses and globally routable addresses
   */
  private shouldPreferIP (newIP: string, currentIP: string): boolean {
    // Enhanced IP preference logic supporting IPv6

    // Get IP types for both addresses
    const newType = this.getIPAddressType(newIP)
    const currentType = this.getIPAddressType(currentIP)

    // Define preference order (higher number = more preferred)
    const preferenceOrder: Record<string, number> = {
      'ipv4-link-local': 1, // 169.254.x.x
      'ipv6-link-local': 2, // fe80::/10
      'ipv4-private': 3, // 10.x.x.x, 192.168.x.x, 172.16-31.x.x
      'ipv6-ula': 4, // fc00::/7 (Unique Local Address)
      'ipv4-public': 5, // Public IPv4
      'ipv6-global': 6 // Global unicast IPv6
    }

    const newPreference = preferenceOrder[newType] || 0
    const currentPreference = preferenceOrder[currentType] || 0

    // Prefer higher preference values
    return newPreference > currentPreference
  }

  /**
   * Mask IP addresses for logging to reduce sensitive data exposure
   */
  private maskIP (ip: string | null | undefined): string {
    if (!ip) return 'null'

    // Keep first and last octets, mask middle ones for IPv4
    if (ip.includes('.')) {
      const parts = ip.split('.')
      if (parts.length === 4) {
        return `${parts[0]}.xxx.xxx.${parts[3]}`
      }
    }

    // For IPv6, show only prefix and suffix
    if (ip.includes(':')) {
      const parts = ip.split(':')
      if (parts.length > 2) {
        return `${parts[0]}:xxxx:xxxx:${parts[parts.length - 1]}`
      }
    }

    // For other formats, show only first 3 and last 3 chars
    if (ip.length > 6) {
      return `${ip.substring(0, 3)}...${ip.substring(ip.length - 3)}`
    }

    return 'xxx'
  }

  /**
   * Get diagnostic information about IP detection for troubleshooting
   */
  public getIpDetectionDiagnostics (vmId: string): {
    lastUpdateTime?: Date
    updateCount: number
    lastInterfaces?: any[]
    lastError?: string
  } {
    // This would be enhanced with actual tracking in a production implementation
    // For now, return basic diagnostic structure
    return {
      updateCount: 0,
      lastError: undefined
    }
  }

  // Circuit Breaker Helper Methods
  private async handleCircuitBreakerStateChange (connection: VmConnection, message: CircuitBreakerStateMessage): Promise<void> {
    const oldState = connection.circuitBreakerState
    connection.circuitBreakerState = message.state
    connection.circuitBreakerFailureCount = message.failure_count
    connection.circuitBreakerLastStateChange = new Date()

    this.debug.log('info', `🔴 Circuit breaker state changed for VM ${connection.vmId}: ${oldState} -> ${message.state} (failures: ${message.failure_count})`)

    // Update connection quality and degradation status based on circuit breaker state
    switch (message.state) {
    case 'Open':
      connection.connectionQuality = 'critical'
      connection.isDegraded = true
      connection.degradationReason = 'Circuit breaker open - too many failures'
      this.debug.log('warn', `VM ${connection.vmId} entering degraded mode due to circuit breaker opening`)
      break

    case 'HalfOpen':
      connection.connectionQuality = 'poor'
      this.debug.log('info', `VM ${connection.vmId} circuit breaker testing recovery`)
      break

    case 'Closed':
      if (oldState === 'Open' || oldState === 'HalfOpen') {
        connection.connectionQuality = 'good'
        connection.isDegraded = false
        connection.degradationReason = undefined
        this.debug.log('info', `VM ${connection.vmId} circuit breaker recovered - normal operation resumed`)
      }
      break
    }

    // Update connection stability score
    this.updateConnectionStabilityScore(connection)
  }

  private async handleKeepAliveMessage (connection: VmConnection, message: KeepAliveMessage): Promise<void> {
    connection.keepAliveLastReceived = new Date()
    connection.keepAliveSequence = message.sequence_number

    this.debug.log('debug', `💓 Keep-alive received from VM ${connection.vmId} (seq: ${message.sequence_number})`)

    // Send keep-alive response immediately
    const keepAliveResponse = {
      type: 'keep_alive_response',
      sequence_number: message.sequence_number,
      timestamp: new Date().toISOString()
    }

    try {
      // Send keep-alive response using the raw socket write method
      connection.socket.write(JSON.stringify(keepAliveResponse) + '\n')
      this.debug.log('debug', `💓 Keep-alive response sent to VM ${connection.vmId} (seq: ${message.sequence_number})`)
    } catch (error) {
      this.debug.log('error', `Failed to send keep-alive response to VM ${connection.vmId}: ${error}`)
      connection.keepAliveFailureCount++
    }
  }

  private updateConnectionStabilityScore (connection: VmConnection): void {
    let score = 100

    // Deduct points for circuit breaker state
    switch (connection.circuitBreakerState) {
    case 'Open':
      score -= 50
      break
    case 'HalfOpen':
      score -= 25
      break
    case 'Closed':
      // No deduction
      break
    }

    // Deduct points for keep-alive failures
    score -= connection.keepAliveFailureCount * 5

    // Deduct points for transmission failures
    score -= connection.transmissionFailureCount * 2

    // Deduct points for degraded mode
    if (connection.isDegraded) {
      score -= 20
    }

    // Ensure score doesn't go below 0
    connection.connectionStabilityScore = Math.max(0, score)
  }

  /**
   * Enhanced IPv6 private address classification
   */
  private isIPv6Private (ip: string): boolean {
    // Remove any zone identifier (e.g., %eth0)
    const cleanIP = ip.split('%')[0]

    // Link-local addresses: fe80::/10
    if (cleanIP.toLowerCase().startsWith('fe8') || cleanIP.toLowerCase().startsWith('fe9') ||
      cleanIP.toLowerCase().startsWith('fea') || cleanIP.toLowerCase().startsWith('feb')) {
      return true
    }

    // Unique Local Addresses (ULA): fc00::/7 (fc00:: to fdff::)
    if (cleanIP.toLowerCase().startsWith('fc') || cleanIP.toLowerCase().startsWith('fd')) {
      return true
    }

    // Site-local addresses (deprecated but still used): fec0::/10
    if (cleanIP.toLowerCase().startsWith('fec') || cleanIP.toLowerCase().startsWith('fed') ||
      cleanIP.toLowerCase().startsWith('fee') || cleanIP.toLowerCase().startsWith('fef')) {
      return true
    }

    // Global unicast addresses (2000::/3) are considered public
    // All other IPv6 addresses are considered private by default
    return !cleanIP.toLowerCase().startsWith('2')
  }

  /**
   * Enhanced IPv6 validation
   */
  private isValidIPv6 (ip: string): boolean {
    // Remove any zone identifier (e.g., %eth0)
    const cleanIP = ip.split('%')[0]

    // Basic IPv6 format validation
    // Must contain at least one colon
    if (!cleanIP.includes(':')) return false

    // Can't start or end with more than two colons
    if (cleanIP.startsWith(':::') || cleanIP.endsWith(':::')) return false

    // Can't have more than one double colon sequence
    const doubleColonCount = (cleanIP.match(/::/g) || []).length
    if (doubleColonCount > 1) return false

    // Split by double colon to handle compressed zeros
    const parts = cleanIP.split('::')
    if (parts.length > 2) return false

    // Validate each part
    for (const part of parts) {
      if (part === '') continue // Empty part is OK for compressed notation

      const groups = part.split(':')
      for (const group of groups) {
        if (group === '') continue // Empty group is OK

        // Each group should be 1-4 hex digits
        if (group.length > 4) return false
        if (!/^[0-9a-fA-F]+$/.test(group)) return false
      }

      // Check total number of groups doesn't exceed 8
      if (groups.length > 8) return false
    }

    return true
  }

  /**
   * Check if an IP address is a loopback address
   */
  private isLoopbackAddress (ip: string): boolean {
    // IPv4 loopback: 127.x.x.x
    if (ip.startsWith('127.')) return true

    // IPv6 loopback: ::1
    if (ip === '::1' || ip.toLowerCase() === '0:0:0:0:0:0:0:1') return true

    return false
  }

  /**
   * Get the type classification of an IP address for preference ordering
   */
  private getIPAddressType (ip: string): string {
    if (ip.includes(':')) {
      // IPv6 address
      const cleanIP = ip.split('%')[0].toLowerCase()

      // Link-local: fe80::/10
      if (cleanIP.startsWith('fe8') || cleanIP.startsWith('fe9') ||
        cleanIP.startsWith('fea') || cleanIP.startsWith('feb')) {
        return 'ipv6-link-local'
      }

      // ULA: fc00::/7
      if (cleanIP.startsWith('fc') || cleanIP.startsWith('fd')) {
        return 'ipv6-ula'
      }

      // Global unicast: 2000::/3
      if (cleanIP.startsWith('2')) {
        return 'ipv6-global'
      }

      // Other IPv6 (site-local, etc.) - treat as ULA
      return 'ipv6-ula'
    } else {
      // IPv4 address
      if (ip.startsWith('169.254.')) {
        return 'ipv4-link-local'
      }

      if (this.isPrivateIP(ip)) {
        return 'ipv4-private'
      }

      return 'ipv4-public'
    }
  }
}

// Singleton instance management
let virtioSocketWatcherService: VirtioSocketWatcherService | null = null

export const createVirtioSocketWatcherService = (prisma: PrismaClient): VirtioSocketWatcherService => {
  if (!virtioSocketWatcherService) {
    virtioSocketWatcherService = new VirtioSocketWatcherService(prisma)
  }
  return virtioSocketWatcherService
}

export const getVirtioSocketWatcherService = (): VirtioSocketWatcherService => {
  if (!virtioSocketWatcherService) {
    throw new Error('VirtioSocketWatcherService not initialized. Call createVirtioSocketWatcherService first.')
  }
  return virtioSocketWatcherService
}
