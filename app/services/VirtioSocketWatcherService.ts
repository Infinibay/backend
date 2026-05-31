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
      handleRequestPendingScripts: (vmId, msg, conn) => this.handleRequestPendingScripts(vmId, msg, conn),
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
    return this.connectionManager.start()
  }

  async stop(): Promise<void> {
    return this.connectionManager.stop()
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

    try {
      const messageStr = JSON.stringify(message) + '\n'
      const messageSize = Buffer.byteLength(messageStr, 'utf8')

      this.debug.debug(`📤 Sending message to VM ${connection.vmId}: size=${messageSize} bytes, type=${message.type || 'unknown'}`)
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
    return this.connectionManager.getConnectionStats()
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
   * Handle request for pending script executions from InfiniService
   */
  private async handleRequestPendingScripts(vmId: string, msg: RequestPendingScriptsMessage, connection: VmConnection): Promise<void> {
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

      // Query pending script executions
      const pendingExecutions = await this.prisma.scriptExecution.findMany({
        where: {
          machineId: vmId,
          status: 'PENDING',
          OR: [
            { scheduledFor: null },
            { scheduledFor: { lte: comparisonTime } }
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

      this.sendMessage(connection, response)
      this.debug.info(`Sent ${result.pendingScripts.length} pending scripts to VM ${vmId}`)
    } catch (error) {
      this.debug.error(`Failed to handle pending scripts request: ${error}`)
    }
  }

  /**
   * Proactively push pending scripts to a specific VM without waiting for a request.
   */
  public async pushPendingScriptsToVM(vmId: string): Promise<{ success: boolean; scriptCount: number; error?: string }> {
    try {
      // 1. Connection Validation
      const connection = this.connections.get(vmId)
      if (!connection) {
        return { success: false, scriptCount: 0, error: 'VM not connected' }
      }

      if (!connection.isConnected) {
        return { success: false, scriptCount: 0, error: 'VM not connected' }
      }

      this.debug.info(`Pushing pending scripts to VM ${vmId}`)

      // 2. Query Pending Executions
      const now = new Date()
      const pendingExecutions = await this.prisma.scriptExecution.findMany({
        where: {
          machineId: vmId,
          status: 'PENDING',
          OR: [
            { scheduledFor: null },
            { scheduledFor: { lte: now } }
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

      // 3. Filter Eligible Executions
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

      // 4. Prepare Scripts in Transaction
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

      // 5. Send Response Message
      const response: PendingScriptsResponseMessage = {
        type: 'pending_scripts_response',
        timestamp: now.toISOString(),
        scripts: result.pendingScripts
      }

      this.sendMessage(connection, response)
      this.debug.info(`Pushed ${result.pendingScripts.length} pending scripts to VM ${vmId}`)

      // 6. Return Result
      return { success: true, scriptCount: result.pendingScripts.length }
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
