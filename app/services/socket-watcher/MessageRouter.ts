import { Logger } from 'winston'
import type {
  VmConnection,
  OutboundMessage,
  BaseMessage,
  MetricsMessage,
  ErrorMessage,
  ErrorReportMessage,
  ResponseMessage,
  CircuitBreakerStateMessage,
  KeepAliveMessage,
  FirewallEventMessage,
  ScriptCompletionMessage,
  RequestPendingScriptsMessage,
  AgentEventMessage,
  CommandResponse,
} from './types'

import {
  LOG_PREVIEW_LEN,
  redactSensitive,
} from './types'
import type { MetricsHandler } from './MetricsHandler'
import type { KeepAliveManager } from './KeepAliveManager'

// ────────────────────────────────────────────────────────────────────────────────
// Receive-buffer safety limits
// ────────────────────────────────────────────────────────────────────────────────
//
// SECURITY (dos-resource): the agent side of the virtio-serial socket is fully
// guest-controlled (a tenant is root inside their own VM and can write arbitrary
// bytes to the port), and inbound frames are NOT authenticated. Without a hard
// cap, a guest that streams bytes with no newline grows connection.buffer without
// bound until the shared backend is OOM-killed, or the `+=` append throws a
// RangeError ('Invalid string length') and crashes the process for every tenant.
// We cap the accumulated buffer and drop oversized single messages instead.
// Configurable via env, with safe fallbacks so boot never fails.
const MAX_BUFFER_BYTES = Number(process.env.VIRTIO_MAX_BUFFER_BYTES) || 8 * 1024 * 1024   // 8 MB total receive buffer
const MAX_MESSAGE_BYTES = Number(process.env.VIRTIO_MAX_MESSAGE_BYTES) || 4 * 1024 * 1024 // 4 MB per newline-delimited message

// ────────────────────────────────────────────────────────────────────────────────
// Types for injected dependencies
// ────────────────────────────────────────────────────────────────────────────────

export interface MessageRouterDeps {
  debug: Logger
  connections: Map<string, VmConnection>
  metricsHandler: MetricsHandler
  keepAliveManager: KeepAliveManager

  /** Send a message back to the VM over the socket */
  sendMessage: (connection: VmConnection, message: OutboundMessage) => void

  /** Handle detailed error reports (may trigger reconnection/close) */
  handleErrorReport: (connection: VmConnection, errorReport: ErrorReportMessage) => Promise<void>

  /** Handle circuit breaker state changes from the agent */
  handleCircuitBreakerStateChange: (connection: VmConnection, message: CircuitBreakerStateMessage) => Promise<void>

  /** Handle firewall events (stores blocked connections in DB) */
  handleFirewallEvent: (vmId: string, message: FirewallEventMessage) => Promise<void>

  /** Handle script completion notifications */
  handleScriptCompletion: (vmId: string, message: ScriptCompletionMessage) => Promise<void>

  /** Handle request for pending script executions */
  handleRequestPendingScripts: (vmId: string, msg: RequestPendingScriptsMessage, connection: VmConnection) => Promise<void>

  /** Handle structured agent_event log/error forwarded by infiniservice */
  handleAgentEvent: (vmId: string, message: AgentEventMessage) => Promise<void>
}

// ────────────────────────────────────────────────────────────────────────────────
// MessageRouter
// ────────────────────────────────────────────────────────────────────────────────

export class MessageRouter {
  private readonly debug: Logger
  private readonly connections: Map<string, VmConnection>
  private readonly metricsHandler: MetricsHandler
  private readonly keepAliveManager: KeepAliveManager
  private readonly sendMessage: (connection: VmConnection, message: OutboundMessage) => void
  private readonly handleErrorReport: (connection: VmConnection, errorReport: ErrorReportMessage) => Promise<void>
  private readonly handleCircuitBreakerStateChange: (connection: VmConnection, message: CircuitBreakerStateMessage) => Promise<void>
  private readonly handleFirewallEvent: (vmId: string, message: FirewallEventMessage) => Promise<void>
  private readonly handleScriptCompletion: (vmId: string, message: ScriptCompletionMessage) => Promise<void>
  private readonly handleRequestPendingScripts: (vmId: string, msg: RequestPendingScriptsMessage, connection: VmConnection) => Promise<void>
  private readonly handleAgentEvent: (vmId: string, message: AgentEventMessage) => Promise<void>

  constructor(deps: MessageRouterDeps) {
    this.debug = deps.debug
    this.connections = deps.connections
    this.metricsHandler = deps.metricsHandler
    this.keepAliveManager = deps.keepAliveManager
    this.sendMessage = deps.sendMessage
    this.handleErrorReport = deps.handleErrorReport
    this.handleCircuitBreakerStateChange = deps.handleCircuitBreakerStateChange
    this.handleFirewallEvent = deps.handleFirewallEvent
    this.handleScriptCompletion = deps.handleScriptCompletion
    this.handleRequestPendingScripts = deps.handleRequestPendingScripts
    this.handleAgentEvent = deps.handleAgentEvent
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handle incoming raw data from a VM socket.
   * Buffers the data and extracts complete newline-delimited messages,
   * then dispatches each message to processMessage().
   */
  handleSocketData(connection: VmConnection, data: Buffer): void {
    const receiveTime = new Date()
    const dataSize = data.length

    const chunk = data.toString()

    // SECURITY (dos-resource): enforce a hard cap on the accumulated receive
    // buffer BEFORE appending. A guest-controlled stream with no newline would
    // otherwise grow connection.buffer without bound (OOM) or overflow V8's max
    // string length (synchronous RangeError). On breach we drop the buffer and
    // throw so the socket 'data' handler tears the connection down (fail-closed).
    if (connection.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
      connection.messageStats.errors++
      this.debug.error(`Receive buffer overflow for VM ${connection.vmId} (${connection.buffer.length + chunk.length} > ${MAX_BUFFER_BYTES} bytes) — closing connection`)
      connection.buffer = ''
      throw new Error(`Receive buffer overflow for VM ${connection.vmId}`)
    }

    connection.buffer += chunk
    this.debug.debug(`📥 Received raw data (${dataSize} bytes) from VM ${connection.vmId}`)
    connection.lastMessageTime = receiveTime

    // Update message statistics
    connection.messageStats.received++
    connection.messageStats.totalBytes += dataSize

    this.debug.debug(`📥 Received ${dataSize} bytes from VM ${connection.vmId} (buffer size: ${connection.buffer.length}, total received: ${connection.messageStats.received})`)

    // Monitor buffer size for potential issues
    if (connection.buffer.length > 100000) { // 100KB buffer warning
      this.debug.warn(`Large buffer detected for VM ${connection.vmId}: ${connection.buffer.length} bytes - possible message parsing issue`)
    }

    // Process complete messages (delimited by newlines)
    let newlineIndex: number
    let messagesProcessed = 0
    while ((newlineIndex = connection.buffer.indexOf('\n')) !== -1) {
      const messageStr = connection.buffer.slice(0, newlineIndex)
      connection.buffer = connection.buffer.slice(newlineIndex + 1)

      // SECURITY (dos-resource): drop a single oversized message rather than
      // feeding an unbounded attacker-controlled blob to the JSON parser and the
      // downstream DB writers. Keeps the connection alive for well-formed traffic.
      if (messageStr.length > MAX_MESSAGE_BYTES) {
        connection.messageStats.errors++
        this.debug.warn(`Dropping oversized message (${messageStr.length} bytes) from VM ${connection.vmId}`)
        continue
      }

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
          this.debug.warn(`Slow message processing for VM ${connection.vmId}: ${processingTime}ms`)
        }
      }
    }

    if (messagesProcessed > 0) {
      this.debug.debug(`Processed ${messagesProcessed} messages from VM ${connection.vmId} (avg latency: ${connection.messageStats.averageLatency.toFixed(1)}ms)`)
    }
  }

  /**
   * Process a single complete JSON message from a VM.
   * Parses the JSON, detects the message type, and dispatches to the
   * appropriate handler.
   */
  async processMessage(connection: VmConnection, messageStr: string): Promise<void> {
    try {
      const message = JSON.parse(messageStr) as BaseMessage | MetricsMessage | ErrorMessage | ResponseMessage | Record<string, unknown>

      // Handle messages without explicit type field (legacy or command responses)
      if (!('type' in message) && 'id' in message && 'success' in message) {
        (message as unknown as ResponseMessage).type = 'response'
      }

      this.debug.debug(`📥 Received ${('type' in message ? message.type : 'unknown')} message from VM ${connection.vmId}`)

      // Add redacted message preview
      const redacted = redactSensitive(message)
      const preview = JSON.stringify(redacted, null, 2).slice(0, LOG_PREVIEW_LEN)
      this.debug.debug(`📋 Message preview: ${preview}${preview.length === LOG_PREVIEW_LEN ? '…' : ''}`)

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
          // Check if this is the first message from infiniservice (VM just completed setup)
          await this.metricsHandler.handleFirstInfiniserviceMessage(connection.vmId)

          // Store metrics in database
          await this.metricsHandler.storeMetrics(connection.vmId, message as MetricsMessage)
          break

        case 'error':
          const errorMsg = message as ErrorMessage
          this.debug.error(`Error from VM ${connection.vmId}: ${errorMsg.error} ${errorMsg.details ? JSON.stringify(errorMsg.details) : ''}`)
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
                  this.debug.debug(`Parsed stdout for ${response.command_type}, got ${Array.isArray(data) ? data.length : 0} items`)
                  if (Array.isArray(data) && data.length > 0) {
                    this.debug.debug(`First item structure: ${JSON.stringify(data[0], null, 2)}`)
                  }
                }
              } catch (parseError) {
                this.debug.debug(`Could not parse stdout as JSON for ${response.command_type}: ${parseError}`)
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
            this.debug.debug(`Command ${response.id} completed for VM ${connection.vmId}${execTime}`)

            // Log error details if command failed
            if (!response.success) {
              this.debug.warn(`Command ${response.id} failed: ${response.error || response.stderr || 'Unknown error'}`)
            }

            // Check if this is an auto-check related command and emit events if needed
            await this.metricsHandler.handleAutoCheckResponse(connection.vmId, response, data || null)
          } else {
            this.debug.warn(`Received response for unknown command ${response.id} from VM ${connection.vmId}`)
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
          await this.keepAliveManager.handleKeepAliveMessage(connection, keepAliveMsg)
          break

        case 'firewall_event':
          // Handle firewall events from InfiniService (Windows Firewall monitoring)
          const firewallEventMsg = message as FirewallEventMessage
          await this.handleFirewallEvent(connection.vmId, firewallEventMsg)
          break

        case 'script_completion':
          // Handle script completion messages from first-boot scripts
          const scriptCompletionMsg = message as ScriptCompletionMessage
          await this.handleScriptCompletion(connection.vmId, scriptCompletionMsg)
          break

        case 'request_pending_scripts':
          // Handle request for pending script executions from InfiniService
          const requestMsg = message as RequestPendingScriptsMessage
          await this.handleRequestPendingScripts(connection.vmId, requestMsg, connection)
          break

        case 'agent_event':
          // Structured log/error forwarded by infiniservice — persist + dispatch.
          const agentEventMsg = message as AgentEventMessage
          await this.handleAgentEvent(connection.vmId, agentEventMsg)
          break

        default:
          this.debug.warn(`Unknown message type from VM ${connection.vmId}: ${typeof message === 'object' && message && 'type' in message ? message.type : 'unknown'}`)
          this.debug.warn(`Full message: ${messageStr}`) // Log full message for unknown types
      }
    } catch (error) {
      this.debug.error(`Failed to process message from VM ${connection.vmId}: ${error}`)
      this.debug.error(`Raw message: ${messageStr}`)
      // Add more details about the parsing error
      if (error instanceof SyntaxError) {
        this.debug.error(`JSON parsing error: ${(error as SyntaxError).message}`)
        this.debug.error(`Message length: ${messageStr.length} chars`)
        this.debug.error(`First 500 chars: ${messageStr.substring(0, 500)}`)
      }
    }
  }
}
