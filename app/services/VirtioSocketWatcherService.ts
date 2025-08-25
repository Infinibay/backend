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
  details?: any
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
  data?: any
  error?: string
}

// Safe command types matching InfiniService
export interface SafeCommandType {
  action: 'ServiceList' | 'ServiceControl' | 'PackageList' | 'PackageInstall' | 
          'PackageRemove' | 'PackageUpdate' | 'PackageSearch' | 'ProcessList' | 
          'ProcessKill' | 'ProcessTop' | 'SystemInfo' | 'OsInfo'
  params?: any
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
  data?: any
  error?: string
}

type IncomingMessage = MetricsMessage | ErrorMessage | ResponseMessage

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
      this.closeConnection(connection.vmId)
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
    this.closeConnection(vmId)
  }

  // Connect to a VM's Unix domain socket
  private async connectToVm (vmId: string, socketPath: string): Promise<void> {
    // Close existing connection if any
    if (this.connections.has(vmId)) {
      this.debug.log('debug', `🔌 Closing existing connection for VM ${vmId}`)
      this.closeConnection(vmId)
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
      const message = JSON.parse(messageStr) as any

      // Handle messages without explicit type field (legacy or command responses)
      if (!message.type && message.id && 'success' in message) {
        message.type = 'response'
      }

      this.debug.log('debug', `Received ${message.type || 'unknown'} message from VM ${connection.vmId}`)

      // Add detailed logging to debug message structure
      this.debug.log('debug', `Full message structure: ${JSON.stringify(message, null, 2).slice(0, 500)}`)

      switch (message.type) {
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
        } else {
          this.debug.log('warn', `Received response for unknown command ${response.id} from VM ${connection.vmId}`)
        }
        break

      default:
        this.debug.log('warn', `Unknown message type from VM ${connection.vmId}: ${(message as any).type}`)
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
  private sendMessage (connection: VmConnection, message: any): void {
    if (!connection.isConnected) {
      this.debug.log('warn', `Cannot send message to disconnected VM ${connection.vmId}`)
      return
    }

    try {
      const messageStr = JSON.stringify(message) + '\n'
      connection.socket.write(messageStr)
    } catch (error) {
      this.debug.log('error', `Failed to send message to VM ${connection.vmId}: ${error}`)
    }
  }

  // Public method to send safe commands to a VM
  public async sendSafeCommand(
    vmId: string,
    commandType: SafeCommandType,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const connection = this.connections.get(vmId)
    if (!connection) {
      throw new Error(`No connection to VM ${vmId}`)
    }

    if (!connection.isConnected) {
      throw new Error(`VM ${vmId} is not connected`)
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

      // Send command
      const message = {
        type: 'SafeCommand',
        id: commandId,
        command_type: commandType,
        params: commandType.params,
        timeout: Math.floor(timeout / 1000) // Convert to seconds for InfiniService
      }

      this.debug.log('debug', `Sending safe command ${commandId} to VM ${vmId}: ${JSON.stringify(commandType)}`)
      this.sendMessage(connection, message)
    })
  }

  // Public method to send unsafe (raw) commands to a VM
  public async sendUnsafeCommand(
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
      throw new Error(`VM ${vmId} is not connected`)
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

      // Send command
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
  public async sendPackageCommand(
    vmId: string,
    action: 'PackageList' | 'PackageInstall' | 'PackageRemove' | 'PackageUpdate' | 'PackageSearch',
    packageName?: string,
    timeout: number = 60000 // Higher timeout for package operations
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
  public async sendProcessCommand(
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
      this.closeConnection(connection.vmId)
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
          this.closeConnection(connection.vmId)
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
      this.closeConnection(connection.vmId)
      return
    }

    // Otherwise, treat as error and attempt reconnection
    this.handleConnectionError(connection)
  }

  // Close and clean up a connection
  private closeConnection (vmId: string): void {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return
    }

    this.debug.log('debug', `🔌 Closing connection for VM ${vmId}`)

    // Reject all pending commands with detailed error
    for (const [commandId, pending] of connection.pendingCommands) {
      clearTimeout(pending.timeout)
      const error = new Error(`Connection to VM ${vmId} closed while command ${commandId} was pending`)
      pending.reject(error)
      this.debug.log('warn', `Rejected pending command ${commandId} due to connection close for VM ${vmId}`)
    }
    connection.pendingCommands.clear()
    this.debug.log('debug', `Cleared ${connection.pendingCommands.size} pending commands for VM ${vmId}`)

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
  public getPendingCommands(vmId: string): string[] {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return []
    }
    return Array.from(connection.pendingCommands.keys())
  }

  // Cancel a specific pending command
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
    this.debug.log('info', `Command ${commandId} cancelled for VM ${vmId}`)
    return true
  }

  // Cancel all pending commands for a VM
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
    this.debug.log('info', `Cancelled ${count} pending commands for VM ${vmId}`)
    return count
  }

  // Execute command with retry logic
  public async executeCommandWithRetry(
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
  public isVmConnected(vmId: string): boolean {
    const connection = this.connections.get(vmId)
    return connection?.isConnected || false
  }

  // Get connection details for a VM
  public getConnectionDetails(vmId: string): any {
    return this.connections.get(vmId)
  }

  // Clean up connections for a deleted VM
  async cleanupVmConnection (vmId: string): Promise<void> {
    this.debug.log('debug', `Cleaning up connection for deleted VM ${vmId}`)
    this.closeConnection(vmId)

    // Also try to remove the socket file if it exists
    const socketPath = path.join(this.socketDir, `${vmId}.socket`)
    try {
      await fs.promises.unlink(socketPath)
      this.debug.log('debug', `Removed socket file for VM ${vmId}`)
    } catch (error) {
      // Socket file might not exist, which is fine
      if ((error as any).code !== 'ENOENT') {
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
