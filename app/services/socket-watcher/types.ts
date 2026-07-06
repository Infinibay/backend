/**
 * VirtioSocketWatcher - Type definitions
 *
 * All interfaces, types, and helper constants used by the VirtioSocketWatcherService
 * and its extracted sub-modules.
 */

// ────────────────────────────────────────────────────────────────────────────────
// Payload logging helpers
// ────────────────────────────────────────────────────────────────────────────────

export const LOG_PREVIEW_LEN = Number(process.env.INFINIBAY_LOG_PREVIEW_LEN ?? 300)

export const SENSITIVE_KEYS = [/(password|token|secret|authorization|bearer)/i]

export function redactSensitive(obj: any): any {
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

// ────────────────────────────────────────────────────────────────────────────────
// Message types from InfiniService
// ────────────────────────────────────────────────────────────────────────────────

export interface BaseMessage {
  type: 'metrics' | 'error' | 'handshake' | 'command' | 'response' | 'error_report' | 'circuit_breaker_state' | 'keep_alive' | 'keep_alive_request' | 'firewall_event' | 'script_completion' | 'request_pending_scripts' | 'agent_event'
  timestamp: string
}

export interface ErrorMessage extends BaseMessage {
  type: 'error'
  error: string
  details?: unknown
}

export interface AgentEventMessage extends BaseMessage {
  type: 'agent_event'
  severity: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  executionId?: string | null
  context?: unknown
}

export interface MetricsMessage extends BaseMessage {
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

export interface ErrorReportMessage extends BaseMessage {
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
export interface CommandMessage extends BaseMessage {
  type: 'command'
  id: string
  commandType: SafeCommandType | UnsafeCommandRequest
}

export interface ResponseMessage extends BaseMessage {
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
export interface CircuitBreakerStateMessage extends BaseMessage {
  type: 'circuit_breaker_state'
  state: 'Closed' | 'Open' | 'HalfOpen'
  failure_count: number
  last_failure_time?: string
  recovery_eta_seconds?: number
}

export interface KeepAliveMessage extends BaseMessage {
  type: 'keep_alive'
  sequence_number: number
}

export interface KeepAliveRequestMessage extends BaseMessage {
  type: 'keep_alive_request'
  sequence_number: number
  timestamp: string
}

export interface FirewallEventMessage extends BaseMessage {
  type: 'firewall_event'
  event_type: 'connection_blocked' | 'connection_allowed'
  port: number
  protocol: string
  process_name?: string
  process_id?: number
  source_ip?: string
  rule_name?: string
  timestamp: string
}

export interface ScriptCompletionMessage extends BaseMessage {
  type: 'script_completion'
  execution_id: string
  exit_code: number
  log_file?: string
  stdout?: string
  stderr?: string
}

export interface RequestPendingScriptsMessage extends BaseMessage {
  type: 'request_pending_scripts'
  vm_id: string
  request_timestamp: string
}

export interface PendingScriptsResponseMessage {
  type: 'pending_scripts_response'
  timestamp: string
  scripts: PendingScriptInfo[]
}

export interface PendingScriptInfo {
  execution_id: string
  script_id: string
  script_name: string
  script_content: string
  shell: string
  execution_type: string
  input_values: Record<string, any>
  timeout_seconds: number
  run_as: string | null
}

// ────────────────────────────────────────────────────────────────────────────────
// Response data types
// ────────────────────────────────────────────────────────────────────────────────

// Define types for different response data structures
export interface PackageInfo {
  name: string
  version?: string
  description?: string
  installed?: boolean
  available?: boolean
}

export interface ServiceInfo {
  name: string
  display_name?: string
  status: string
  start_type?: string
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu_percent: number
  memory_kb: number
  status?: string
}

export interface UserInfo {
  username: string
  full_name?: string
  is_admin: boolean
  is_active: boolean
  last_login?: string
}

export interface SystemInfo {
  hostname?: string
  os?: string
  kernel?: string
  arch?: string
  cpu_count?: number
  total_memory?: number
}

export interface OsInfo {
  name?: string
  version?: string
  build?: string
  platform?: string
}

// Auto-check response data interfaces
export interface WindowsUpdate {
  title: string
  importance: 'Critical' | 'Important' | 'Moderate' | 'Low'
  kb_id?: string
  size?: number
}

export interface WindowsUpdatesData {
  pending_updates?: WindowsUpdate[]
  installed_count?: number
  failed_count?: number
}

export interface DefenderData {
  real_time_protection?: boolean
  antivirus_enabled?: boolean
  definitions_outdated?: boolean
  last_definition_update?: string
  scan_status?: string
}

export interface DiskDrive {
  drive_letter: string
  total_gb: number
  used_gb: number
  available_gb: number
}

export interface DiskSpaceData {
  drives?: DiskDrive[]
}

export interface ResourceOptimizationData {
  cpu_optimization_available?: boolean
  memory_optimization_available?: boolean
  disk_optimization_available?: boolean
  recommendations?: string[]
}

export interface HealthCheckData {
  overall_health?: 'Healthy' | 'Warning' | 'Critical'
  checks?: Array<{
    name: string
    status: string
    details?: unknown
  }>
}

export interface DefenderScanData {
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
export type ResponseData = PackageInfo[] | ServiceInfo[] | ProcessInfo[] | UserInfo[] | SystemInfo | OsInfo |
  WindowsUpdatesData | DefenderData | DiskSpaceData | ResourceOptimizationData |
  HealthCheckData | DefenderScanData | unknown[] | Record<string, unknown>

// ────────────────────────────────────────────────────────────────────────────────
// Command types
// ────────────────────────────────────────────────────────────────────────────────

// Safe command types matching InfiniService
export interface SafeCommandType {
  action: 'ServiceList' | 'ServiceControl' | 'PackageList' | 'PackageInstall' |
  'PackageRemove' | 'PackageUpdate' | 'PackageSearch' | 'ProcessList' |
  'ProcessKill' | 'ProcessTop' | 'SystemInfo' | 'OsInfo' | 'UserList' |
  // Auto-check commands
  'CheckWindowsUpdates' | 'GetUpdateHistory' | 'GetPendingUpdates' |
  'CheckWindowsDefender' | 'GetDefenderStatus' | 'RunDefenderQuickScan' | 'GetThreatHistory' |
  'GetInstalledApplicationsWMI' | 'CheckApplicationUpdates' | 'GetApplicationDetails' |
  'CheckLinuxUpdates' |
  'CheckDiskSpace' | 'CheckResourceOptimization' | 'RunHealthCheck' | 'RunAllHealthChecks' |
  'DiskCleanup' | 'AutoFixWindowsUpdates' | 'AutoFixDefender' | 'AutoOptimizeDisk' |
  // Maintenance commands
  'ExecutePowerShellScript' | 'RunMaintenanceTask' | 'ValidateSystemHealth' |
  'CleanTemporaryFiles' | 'UpdateSystemSoftware' | 'RestartServices' | 'CheckSystemIntegrity' |
  // In-guest OS reboot via the agent (preferred over cold QMP/ACPI restart)
  'RebootSystem' |
  // Golden-image seal — runs per-OS cleanup and triggers sysprep / poweroff
  'PrepareGoldenImage' |
  // Active Directory / LDAP domain join (Windows Add-Computer / Linux realm join)
  'JoinDomain'
  params?: SafeCommandParams
  // Top-level fields for PrepareGoldenImage (flattened, matching the
  // serde(tag="action") shape expected by infiniservice).
  cleanup_level?: 'minimal' | 'standard' | 'deep'
  sanitize_user_data?: boolean
  shutdown_after?: boolean
  // Top-level fields for JoinDomain (flattened to match infiniservice's
  // serde(tag="action") shape).
  domain?: string
  username?: string
  password?: string
  ou?: string
  computer_name?: string
  restart_after?: boolean
}

// Parameters for safe commands
export interface SafeCommandParams {
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
  /** Required for ExecutePowerShellScript (validated by || '') */
  script?: string
  /** Optional, defaults to 'inline' */
  script_type?: string
  task_type?: string
  task_name?: string
  parameters?: Record<string, unknown>
  /** Optional, allows 0 for no timeout. Use ?? to preserve falsy values. */
  timeout_seconds?: number
  /** Optional working directory path */
  working_directory?: string
  /** Optional environment variables map */
  environment_vars?: Record<string, string>
  /** Optional, defaults to false. Use ?? to preserve false values. */
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
  runAs?: string
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

// ────────────────────────────────────────────────────────────────────────────────
// Connection & diagnostics types
// ────────────────────────────────────────────────────────────────────────────────

// Health check result structure for detailed tracking
export interface HealthCheckResult {
  timestamp: Date
  success: boolean
  latency?: number
  error?: string
}

// Message statistics for connection diagnostics
export interface MessageStats {
  sent: number
  received: number
  errors: number
  totalBytes: number
  averageLatency: number
}

// Disconnection history tracking
export interface DisconnectionRecord {
  timestamp: Date
  reason: string
  duration: number
  wasUnexpected: boolean
}

// Connection state for each VM with enhanced diagnostics
export interface VmConnection {
  vmId: string
  socket: import('net').Socket
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
  keepAliveTimer?: NodeJS.Timeout // Timer for keep-alive interval
  keepAliveSentCount: number // Total keep-alive requests sent
  keepAliveReceivedCount: number // Total keep-alive responses received
  keepAliveRttHistory: number[] // History of RTT (last 20 values)
  keepAliveAverageRtt: number // Average RTT in milliseconds
  keepAliveLastFailureTime?: Date // Timestamp of last keep-alive failure
  keepAliveConsecutiveFailures: number // Consecutive failures (different from total)
  // Graceful Degradation fields
  isDegraded: boolean // Whether connection is in degraded mode
  degradationReason?: string // Why connection was degraded
  wasIdle?: boolean // Track ACTIVE→IDLE transitions for logging
  // Per-connection reconnect delay (can be adjusted based on error patterns)
  reconnectBaseDelayMs: number // Mutable reconnect delay for this connection
  // Connection pooling for alternative endpoints
  socketPaths: string[] // Alternative socket paths to try
  currentSocketIndex: number // Index of the currently used socket path
}

// ────────────────────────────────────────────────────────────────────────────────
// Outgoing message types
// ────────────────────────────────────────────────────────────────────────────────

// Define message structure types for outgoing messages
export interface OutgoingMessage {
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

// Union type for all outbound messages including keep-alive
export type OutboundMessage = OutgoingMessage | KeepAliveRequestMessage | { type: 'keep_alive_response'; sequence_number: number; timestamp: string } | PendingScriptsResponseMessage

// Define the formatted command type structure
export interface FormattedCommandType {
  action: string
  query?: string
  package?: string
  limit?: number | null
  pid?: number
  force?: boolean | null
  sort_by?: string | null
  [key: string]: unknown // Allow additional properties for Record compatibility
}
