import { Logger } from 'winston'
import type {
  VmConnection,
  OutboundMessage,
  KeepAliveMessage,
  KeepAliveRequestMessage,
} from './types'
import { updateConnectionStabilityScore } from './HealthMonitor'

// ────────────────────────────────────────────────────────────────────────────────
// Types for injected dependencies
// ────────────────────────────────────────────────────────────────────────────────

export interface KeepAliveManagerDeps {
  debug: Logger
  connections: Map<string, VmConnection>
  /** Callback to send a message over the socket */
  sendMessage: (connection: VmConnection, message: OutboundMessage) => void
  /** Callback to emit events (keepAliveFailure, keepAliveCritical, keepAliveRecovered) */
  emitter: NodeJS.EventEmitter
  /** Keep-alive interval in milliseconds */
  keepAliveInterval: number
}

// ────────────────────────────────────────────────────────────────────────────────
// Return type for getKeepAliveMetrics
// ────────────────────────────────────────────────────────────────────────────────

export interface KeepAliveMetrics {
  sentCount: number
  receivedCount: number
  failureCount: number
  consecutiveFailures: number
  averageRtt: number
  lastSent?: Date
  lastReceived?: Date
  lastFailure?: Date
  rttHistory: number[]
}

// ────────────────────────────────────────────────────────────────────────────────
// KeepAliveManager
// ────────────────────────────────────────────────────────────────────────────────

export class KeepAliveManager {
  private readonly debug: Logger
  private readonly connections: Map<string, VmConnection>
  private readonly sendMessage: (connection: VmConnection, message: OutboundMessage) => void
  private readonly emitter: NodeJS.EventEmitter
  private readonly keepAliveInterval: number

  constructor(deps: KeepAliveManagerDeps) {
    this.debug = deps.debug
    this.connections = deps.connections
    this.sendMessage = deps.sendMessage
    this.emitter = deps.emitter
    this.keepAliveInterval = deps.keepAliveInterval
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start periodic keep-alive monitoring for a VM connection.
   * Sends a keep_alive_request every `keepAliveInterval` ms and checks for
   * missed responses (failure threshold = 3 × interval).
   */
  startKeepAliveMonitoring(connection: VmConnection): void {
    // Check if keep-alive is disabled via environment variable
    if (process.env.VIRTIO_DISABLE_KEEP_ALIVE === 'true') {
      // Clear any existing timer before returning
      if (connection.keepAliveTimer) {
        clearInterval(connection.keepAliveTimer)
        connection.keepAliveTimer = undefined
        this.debug.debug(`Cleared existing keep-alive timer for VM ${connection.vmId}`)
      }
      this.debug.info(`Keep-alive disabled via environment variable for VM ${connection.vmId}`)
      return
    }

    // Clear existing timer
    if (connection.keepAliveTimer) {
      clearInterval(connection.keepAliveTimer)
    }

    this.debug.info(`Starting keep-alive monitoring for VM ${connection.vmId} (interval=${this.keepAliveInterval}ms)`)

    connection.keepAliveTimer = setInterval(() => {
      // Increment or initialize sequence number
      if (connection.keepAliveSequence === undefined || connection.keepAliveSequence === null) {
        connection.keepAliveSequence = 1
      } else {
        connection.keepAliveSequence++
      }

      const sequenceNumber = connection.keepAliveSequence

      // Create keep-alive request message
      const keepAliveRequest: KeepAliveRequestMessage = {
        type: 'keep_alive_request',
        sequence_number: sequenceNumber,
        timestamp: new Date().toISOString()
      }

      // Send the request
      this.sendMessage(connection, keepAliveRequest)
      connection.keepAliveLastSent = new Date()
      connection.keepAliveSentCount++

      this.debug.debug(`💓 Keep-alive request sent to VM ${connection.vmId} (seq: ${sequenceNumber}, total_sent: ${connection.keepAliveSentCount})`)

      // Check if we haven't received a keep-alive response in 3 intervals (360s / 6 minutes)
      const now = Date.now()
      const failureThreshold = this.keepAliveInterval * 3
      const lastReceivedMs = connection.keepAliveLastReceived?.getTime()
      const lastSentMs = connection.keepAliveLastSent?.getTime()

      if ((lastReceivedMs && now - lastReceivedMs > failureThreshold) ||
          (!lastReceivedMs && lastSentMs && now - lastSentMs > failureThreshold)) {
        connection.keepAliveFailureCount++
        connection.keepAliveConsecutiveFailures++
        connection.keepAliveLastFailureTime = new Date()

        if (connection.keepAliveFailureCount >= 3) {
          this.debug.warn(`Keep-alive failures detected for VM ${connection.vmId} (failures: ${connection.keepAliveFailureCount})`)
        }

        // Emit failure event if consecutive failures >= 3
        if (connection.keepAliveConsecutiveFailures >= 3) {
          this.emitter.emit('keepAliveFailure', {
            vmId: connection.vmId,
            failureCount: connection.keepAliveFailureCount,
            consecutiveFailures: connection.keepAliveConsecutiveFailures,
            lastFailureTime: connection.keepAliveLastFailureTime
          })
          this.debug.error(`❌ Keep-alive failure event emitted for VM ${connection.vmId} (consecutive: ${connection.keepAliveConsecutiveFailures}, total: ${connection.keepAliveFailureCount})`)
        }

        // Emit critical event if consecutive failures >= 5
        if (connection.keepAliveConsecutiveFailures >= 5) {
          this.emitter.emit('keepAliveCritical', {
            vmId: connection.vmId,
            failureCount: connection.keepAliveFailureCount
          })
          this.debug.error(`🚨 CRITICAL: Keep-alive failures exceeded threshold for VM ${connection.vmId}`)
        }

        // Update connection stability score
        updateConnectionStabilityScore(connection)
      }
    }, this.keepAliveInterval)
  }

  /**
   * Handle an incoming keep_alive message from InfiniService.
   * Updates RTT metrics, tracks recovery from failures, and sends a
   * keep_alive_response back to the agent.
   */
  async handleKeepAliveMessage(connection: VmConnection, message: KeepAliveMessage): Promise<void> {
    connection.keepAliveLastReceived = new Date()

    // Calculate round-trip time if we have a last sent timestamp
    let rtt: number | undefined
    if (connection.keepAliveLastSent) {
      rtt = connection.keepAliveLastReceived.getTime() - connection.keepAliveLastSent.getTime()

      // Update keep-alive metrics
      connection.keepAliveReceivedCount++
      connection.keepAliveRttHistory.push(rtt)

      // Maintain only last 20 RTT values
      if (connection.keepAliveRttHistory.length > 20) {
        connection.keepAliveRttHistory.shift()
      }

      // Calculate average RTT
      connection.keepAliveAverageRtt = connection.keepAliveRttHistory.reduce((a, b) => a + b, 0) / connection.keepAliveRttHistory.length
    }

    // Check if sequence number matches the last sent request - if so, reset failure count
    if (message.sequence_number === connection.keepAliveSequence) {
      const previousFailures = connection.keepAliveConsecutiveFailures
      connection.keepAliveConsecutiveFailures = 0

      // Emit recovery event if there were previous failures
      if (previousFailures > 0) {
        this.emitter.emit('keepAliveRecovered', { vmId: connection.vmId, rtt })
        this.debug.info(`✅ Keep-alive recovered for VM ${connection.vmId} after ${previousFailures} failures`)
      }
    }

    // Update sequence number
    connection.keepAliveSequence = message.sequence_number

    // Log with enhanced metrics
    const rttText = rtt !== undefined ? `, rtt: ${rtt}ms` : ''
    const avgRttText = connection.keepAliveAverageRtt > 0 ? `, avg_rtt: ${connection.keepAliveAverageRtt.toFixed(0)}ms` : ''
    this.debug.debug(`💓 Keep-alive received from VM ${connection.vmId} (seq: ${message.sequence_number}${rttText}${avgRttText}, sent: ${connection.keepAliveSentCount}, received: ${connection.keepAliveReceivedCount}, failures: ${connection.keepAliveFailureCount})`)

    // Warn about high latency
    if (rtt !== undefined && rtt > 5000) {
      this.debug.warn(`⚠️ High keep-alive latency detected for VM ${connection.vmId}: ${rtt}ms`)
    }

    // Warn about high average latency
    if (connection.keepAliveAverageRtt > 3000) {
      this.debug.warn(`⚠️ Average keep-alive latency is high for VM ${connection.vmId}: ${connection.keepAliveAverageRtt.toFixed(0)}ms`)
    }

    // Send keep-alive response immediately using sendMessage for proper error handling
    const keepAliveResponse = {
      type: 'keep_alive_response' as const,
      sequence_number: message.sequence_number,
      timestamp: new Date().toISOString()
    }

    // Use sendMessage instead of raw socket.write() for proper error handling
    this.sendMessage(connection, keepAliveResponse)
    this.debug.debug(`💓 Keep-alive response sent to VM ${connection.vmId} (seq: ${message.sequence_number})`)
  }

  /**
   * Get keep-alive metrics for a specific VM.
   * Returns null if the VM is not connected.
   */
  getKeepAliveMetrics(vmId: string): KeepAliveMetrics | null {
    const connection = this.connections.get(vmId)
    if (!connection) {
      return null
    }

    return {
      sentCount: connection.keepAliveSentCount,
      receivedCount: connection.keepAliveReceivedCount,
      failureCount: connection.keepAliveFailureCount,
      consecutiveFailures: connection.keepAliveConsecutiveFailures,
      averageRtt: connection.keepAliveAverageRtt,
      lastSent: connection.keepAliveLastSent,
      lastReceived: connection.keepAliveLastReceived,
      lastFailure: connection.keepAliveLastFailureTime,
      rttHistory: connection.keepAliveRttHistory
    }
  }

  /**
   * Stop keep-alive monitoring for a connection (clear the interval timer).
   */
  stopKeepAlive(connection: VmConnection): void {
    if (connection.keepAliveTimer) {
      clearInterval(connection.keepAliveTimer)
      connection.keepAliveTimer = undefined
      this.debug.debug(`Cleared keep-alive timer for VM ${connection.vmId}`)
    }
  }

  /**
   * Initialize keep-alive fields on a new connection object.
   * Call this when creating a new VmConnection before it's stored in the map.
   */
  static initKeepAliveFields(): {
    keepAliveSequence: number
    keepAliveFailureCount: number
    keepAliveSentCount: number
    keepAliveReceivedCount: number
    keepAliveRttHistory: number[]
    keepAliveAverageRtt: number
    keepAliveConsecutiveFailures: number
  } {
    return {
      keepAliveSequence: 0,
      keepAliveFailureCount: 0,
      keepAliveSentCount: 0,
      keepAliveReceivedCount: 0,
      keepAliveRttHistory: [],
      keepAliveAverageRtt: 0,
      keepAliveConsecutiveFailures: 0,
    }
  }
}
