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
import { Debugger } from '../utils/debug'

// Message types from InfiniService
interface BaseMessage {
  type: 'metrics' | 'error' | 'handshake' | 'command' | 'response'
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
  'DiskCleanup' | 'AutoFixWindowsUpdates' | 'AutoFixDefender' | 'AutoOptimizeDisk'
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

// Connection state for each VM
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
  private connections: Map<string, VmConnection> = new Map()
  private watcher?: chokidar.FSWatcher
  private socketDir: string
  private isRunning: boolean = false
  private readonly maxReconnectAttempts = 10
  private readonly reconnectBaseDelay = 1000 // Base delay in ms
  private readonly pingInterval = 30000 // Send ping every 30 seconds
  private readonly messageTimeout = 60000 // Consider connection dead after 60 seconds
  private debug: Debugger

  constructor (prisma: PrismaClient) {
    super()
    this.prisma = prisma
    this.socketDir = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'sockets')
    this.debug = new Debugger('infinibay:virtio-socket')
  }

  // Initialize the service with optional dependencies
  initialize (vmEventManager?: VmEventManager): void {
    this.vmEventManager = vmEventManager
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
    const connection: VmConnection = {
      vmId,
      socket,
      socketPath,
      buffer: '',
      reconnectAttempts: 0,
      lastMessageTime: new Date(),
      isConnected: false,
      errorCount: 0,
      pendingCommands: new Map()
    }

    this.connections.set(vmId, connection)

    // Set up socket event handlers
    socket.on('connect', () => {
      this.debug.log('info', `✅ Connected to VM ${vmId}`)
      connection.isConnected = true
      connection.reconnectAttempts = 0
      connection.lastMessageTime = new Date()
      // Reset error tracking on successful connection
      connection.errorCount = 0
      connection.lastErrorType = undefined

      // Connection established successfully
      // Start health monitoring
      this.startHealthMonitoring(connection)

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

      // Only log if this is a new error type or first occurrence
      if (connection.lastErrorType !== errorType || connection.errorCount === 0) {
        connection.lastErrorType = errorType
        connection.errorCount = 1

        // Log specific error details based on type
        if (errorType === 'EACCES') {
          this.debug.log('warn', `❌ Socket permission denied for VM ${vmId}. InfiniService may not be installed or running.`)
          // Only show diagnostic help on first error
          if (connection.reconnectAttempts === 0) {
            this.debug.log('info', `💡 To diagnose: virsh qemu-agent-command ${vmId} '{"execute":"guest-exec","arguments":{"path":"systemctl","arg":["status","infiniservice"]}}'`)
          }
        } else if (errorType === 'ECONNREFUSED') {
          this.debug.log('warn', `Connection refused for VM ${vmId}. InfiniService may not be listening on the socket.`)
        } else if (errorType === 'ENOENT') {
          this.debug.log('debug', `Socket file not found for VM ${vmId}. VM may be shutting down or InfiniService not started.`)
        } else {
          this.debug.log('error', `Socket error for VM ${vmId}: ${error.message.toString().slice(0, 100)}`)
        }
      } else {
        // Same error type, increment counter but only log periodically
        connection.errorCount++

        // Log every 10th occurrence of the same error
        if (connection.errorCount % 10 === 0) {
          this.debug.log('debug', `Still experiencing ${errorType} errors for VM ${vmId} (${connection.errorCount} occurrences)`)
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

  // Handle incoming data from socket
  private handleSocketData (connection: VmConnection, data: Buffer): void {
    connection.buffer += data.toString()
    connection.lastMessageTime = new Date()

    // Process complete messages (delimited by newlines)
    let newlineIndex: number
    while ((newlineIndex = connection.buffer.indexOf('\n')) !== -1) {
      const messageStr = connection.buffer.slice(0, newlineIndex)
      connection.buffer = connection.buffer.slice(newlineIndex + 1)

      if (messageStr.trim()) {
        this.processMessage(connection, messageStr.trim())
      }
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

      // Add detailed logging to debug message structure
      this.debug.log('debug', `📋 Full message: ${JSON.stringify(message, null, 2).slice(0, 1000)}`)

      const msgType = 'type' in message ? message.type : undefined
      console.log(`Processing ${messageStr}`)
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
  private async handleAutoCheckResponse(vmId: string, response: ResponseMessage, data: ResponseData | null): Promise<void> {
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
  private async analyzeAutoCheckData(
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
  private async analyzeWindowsUpdatesResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeDefenderResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeDiskSpaceResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeResourceOptimizationResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeHealthCheckResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeRemediationResponse(vmId: string, commandType: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private async analyzeDefenderScanResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
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
  private getCheckTypeFromRemediationCommand(commandType: string): string {
    const mapping: Record<string, string> = {
      'AutoFixWindowsUpdates': 'WindowsUpdates',
      'AutoFixDefender': 'WindowsDefender', 
      'AutoOptimizeDisk': 'ResourceOptimization',
      'DiskCleanup': 'DiskSpace'
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

  // Send message to VM
  private sendMessage (connection: VmConnection, message: OutgoingMessage): void {
    if (!connection.isConnected) {
      this.debug.log('warn', `Cannot send message to disconnected VM ${connection.vmId}`)
      return
    }

    try {
      const messageStr = JSON.stringify(message) + '\n'
      this.debug.log('debug', `📤 Sending message to VM ${connection.vmId}: ${messageStr.trim()}`)
      console.log(`Sending ${messageStr}`)
      connection.socket.write(messageStr)
    } catch (error) {
      this.debug.log('error', `Failed to send message to VM ${connection.vmId}: ${error}`)
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

  // Monitor connection health (no active pinging, just monitoring)
  private startHealthMonitoring (connection: VmConnection): void {
    // Clear existing timer
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }

    connection.pingTimer = setInterval(() => {
      // Check if connection is stale
      const timeSinceLastMessage = Date.now() - connection.lastMessageTime.getTime()
      if (timeSinceLastMessage > this.messageTimeout) {
        this.debug.log('warn', `Connection to VM ${connection.vmId} appears stale (${Math.round(timeSinceLastMessage / 1000)}s since last message), reconnecting...`)
        this.handleConnectionError(connection)
      }
    }, this.pingInterval)
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

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, connection.reconnectAttempts),
      30000 // Max 30 seconds
    )

    connection.reconnectAttempts++
    this.debug.log('debug', `🔄 Will attempt reconnection ${connection.reconnectAttempts}/${this.maxReconnectAttempts} for VM ${connection.vmId} in ${delay}ms`)

    connection.reconnectTimer = setTimeout(() => {
      // Check if socket file still exists
      fs.access(connection.socketPath, fs.constants.F_OK, (err) => {
        if (err) {
          this.debug.log('debug', `Socket file no longer exists for VM ${connection.vmId}, stopping reconnection`)
          this.closeConnection(connection.vmId, 'cleanup or error')
        } else {
          this.debug.log('debug', `🔄 Attempting reconnection for VM ${connection.vmId}`)
          this.connectToVm(connection.vmId, connection.socketPath)
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

  // Close and clean up a connection
  private closeConnection (vmId: string, reason: string = 'unknown'): void {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return
    }

    this.debug.log('debug', `🔌 Closing connection for VM ${vmId} (reason: ${reason})`)

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

  // Get connection statistics
  getConnectionStats (): {
    totalConnections: number
    activeConnections: number
    connections: Array<{
      vmId: string
      isConnected: boolean
      reconnectAttempts: number
      lastMessageTime: Date
    }>
    } {
    const connections = Array.from(this.connections.values()).map(conn => ({
      vmId: conn.vmId,
      isConnected: conn.isConnected,
      reconnectAttempts: conn.reconnectAttempts,
      lastMessageTime: conn.lastMessageTime
    }))

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => c.isConnected).length,
      connections
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
  public getServiceStatus(): boolean {
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
