/**
 * HealthMonitor - Extracted from VirtioSocketWatcherService
 *
 * Handles health monitoring, keep-alive management, and connection stability scoring
 * for VM connections.
 */

import type { VmConnection, KeepAliveMessage, KeepAliveRequestMessage, HealthCheckResult } from './types'

/**
 * Configuration for the HealthMonitor
 */
export interface HealthMonitorConfig {
  messageTimeout: number
  pingInterval: number
  keepAliveInterval: number
}

/**
 * Delegate interface for callbacks the HealthMonitor needs from the main service
 */
export interface HealthMonitorDelegate {
  debug: {
    log: (level: string, message: string) => void
  }
  emit: (event: string, data: unknown) => void
  sendMessage: (connection: VmConnection, message: unknown) => void
  getConnection: (vmId: string) => VmConnection | undefined
  getQueueManager: () => { processQueue: (vmId: string) => Promise<void> } | undefined
}

export class HealthMonitor {
  private config: HealthMonitorConfig
  private delegate: HealthMonitorDelegate

  constructor(config: HealthMonitorConfig, delegate: HealthMonitorDelegate) {
    this.config = config
    this.delegate = delegate
  }

  /**
   * Start periodic health monitoring for a VM connection.
   * Checks staleness, updates connection quality, and records health check results.
   */
  // Note: Bidirectional keep-alive monitoring is set up separately via startKeepAliveMonitoring()
  public startHealthMonitoring(connection: VmConnection): void {
    // Clear existing timer
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }

    this.delegate.debug.log('info', `🔍 Starting health monitoring for VM ${connection.vmId} (timeout=${this.config.messageTimeout}ms, interval=${this.config.pingInterval}ms)`)

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
      const stalenessThreshold = this.config.messageTimeout * 1.5

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

        this.delegate.debug.log('warn', `Connection to VM ${connection.vmId} appears stale (${Math.round(timeSinceLastMessage / 1000)}s since last message), quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
        this.delegate.debug.log('debug', `Health check context: uptime=${connectionUptime}ms, msgs_sent=${connection.messageStats.sent}, msgs_received=${connection.messageStats.received}, errors=${connection.messageStats.errors}`)

        // Log idle duration if exceeds twice the keep-alive interval (240 seconds / 4 minutes)
        const idleDuration = now - connection.lastMessageTime.getTime()
        const idleThreshold = this.config.keepAliveInterval * 2
        const isCurrentlyIdle = idleDuration > idleThreshold

        // Track ACTIVE→IDLE and IDLE→ACTIVE transitions
        if (!connection.wasIdle && isCurrentlyIdle) {
          this.delegate.debug.log('warn', `⚠️ Connection transitioned from ACTIVE to IDLE after ${(idleDuration / 1000).toFixed(0)}s of inactivity for VM ${connection.vmId}`)
          connection.wasIdle = true
        } else if (connection.wasIdle && !isCurrentlyIdle) {
          this.delegate.debug.log('info', `✅ Connection transitioned from IDLE to ACTIVE for VM ${connection.vmId}`)
          connection.wasIdle = false
        }

        if (isCurrentlyIdle) {
          this.delegate.debug.log('warn', `⚠️ Connection to VM ${connection.vmId} has been idle for ${(idleDuration / 1000).toFixed(0)}s - no messages received`)
        }

        // IMPORTANT: DO NOT close the connection automatically due to timeout
        // The watcher should keep the connection open indefinitely, waiting for the VM
        // The connection will only close when:
        // 1. The VM explicitly closes the socket (socket 'close' event)
        // 2. The watcher service is stopped
        // 3. The socket file is removed
        this.delegate.debug.log('debug', `Keeping connection open despite staleness - waiting for VM ${connection.vmId} to send data`)

        // DO NOT call handleConnectionError here - let the connection stay open
      } else {
        // Connection appears healthy
        healthLatency = Date.now() - healthCheckStartTime

        // Update connection quality based on responsiveness
        if (timeSinceLastMessage < this.config.pingInterval / 2) {
          connection.connectionQuality = 'excellent'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 2)
        } else if (timeSinceLastMessage < this.config.pingInterval) {
          connection.connectionQuality = 'good'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 1)
        }

        this.delegate.debug.log('debug', `Health check passed for VM ${connection.vmId}: last_msg=${Math.round(timeSinceLastMessage / 1000)}s ago, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
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
        this.delegate.debug.log('info', `📊 Health summary for VM ${connection.vmId}: success_rate=${(successRate * 100).toFixed(1)}%, avg_latency=${avgLatency.toFixed(1)}ms, stability=${connection.connectionStabilityScore}%`)
      }
    }, this.config.pingInterval)
  }

  /**
   * Start bidirectional keep-alive monitoring for a VM connection.
   * Sends periodic keep-alive requests and tracks response failures.
   */
  public startKeepAliveMonitoring(connection: VmConnection): void {
    // Check if keep-alive is disabled via environment variable
    if (process.env.VIRTIO_DISABLE_KEEP_ALIVE === 'true') {
      // Clear any existing timer before returning
      if (connection.keepAliveTimer) {
        clearInterval(connection.keepAliveTimer)
        connection.keepAliveTimer = undefined
        this.delegate.debug.log('debug', `Cleared existing keep-alive timer for VM ${connection.vmId}`)
      }
      this.delegate.debug.log('info', `Keep-alive disabled via environment variable for VM ${connection.vmId}`)
      return
    }

    // Clear existing timer
    if (connection.keepAliveTimer) {
      clearInterval(connection.keepAliveTimer)
    }

    this.delegate.debug.log('info', `Starting keep-alive monitoring for VM ${connection.vmId} (interval=${this.config.keepAliveInterval}ms)`)

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
      this.delegate.sendMessage(connection, keepAliveRequest)
      connection.keepAliveLastSent = new Date()
      connection.keepAliveSentCount++

      this.delegate.debug.log('debug', `💓 Keep-alive request sent to VM ${connection.vmId} (seq: ${sequenceNumber}, total_sent: ${connection.keepAliveSentCount})`)

      // Check if we haven't received a keep-alive response in 3 intervals (360s / 6 minutes)
      const now = Date.now()
      const failureThreshold = this.config.keepAliveInterval * 3
      const lastReceivedMs = connection.keepAliveLastReceived?.getTime()
      const lastSentMs = connection.keepAliveLastSent?.getTime()

      if ((lastReceivedMs && now - lastReceivedMs > failureThreshold) ||
          (!lastReceivedMs && lastSentMs && now - lastSentMs > failureThreshold)) {
        connection.keepAliveFailureCount++
        connection.keepAliveConsecutiveFailures++
        connection.keepAliveLastFailureTime = new Date()

        if (connection.keepAliveFailureCount >= 3) {
          this.delegate.debug.log('warn', `Keep-alive failures detected for VM ${connection.vmId} (failures: ${connection.keepAliveFailureCount})`)
        }

        // Emit failure event if consecutive failures >= 3
        if (connection.keepAliveConsecutiveFailures >= 3) {
          this.delegate.emit('keepAliveFailure', {
            vmId: connection.vmId,
            failureCount: connection.keepAliveFailureCount,
            consecutiveFailures: connection.keepAliveConsecutiveFailures,
            lastFailureTime: connection.keepAliveLastFailureTime
          })
          this.delegate.debug.log('error', `❌ Keep-alive failure event emitted for VM ${connection.vmId} (consecutive: ${connection.keepAliveConsecutiveFailures}, total: ${connection.keepAliveFailureCount})`)
        }

        // Emit critical event if consecutive failures >= 5
        if (connection.keepAliveConsecutiveFailures >= 5) {
          this.delegate.emit('keepAliveCritical', {
            vmId: connection.vmId,
            failureCount: connection.keepAliveFailureCount
          })
          this.delegate.debug.log('error', `🚨 CRITICAL: Keep-alive failures exceeded threshold for VM ${connection.vmId}`)
        }

        // Update connection stability score
        updateConnectionStabilityScore(connection)
      }
    }, this.config.keepAliveInterval)
  }

  /**
   * Handle an incoming keep-alive message from a VM.
   * Calculates RTT, updates metrics, and sends response.
   */
  public async handleKeepAliveMessage(connection: VmConnection, message: KeepAliveMessage): Promise<void> {
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
        this.delegate.emit('keepAliveRecovered', { vmId: connection.vmId, rtt })
        this.delegate.debug.log('info', `✅ Keep-alive recovered for VM ${connection.vmId} after ${previousFailures} failures`)
      }
    }

    // Update sequence number
    connection.keepAliveSequence = message.sequence_number

    // Log with enhanced metrics
    const rttText = rtt !== undefined ? `, rtt: ${rtt}ms` : ''
    const avgRttText = connection.keepAliveAverageRtt > 0 ? `, avg_rtt: ${connection.keepAliveAverageRtt.toFixed(0)}ms` : ''
    this.delegate.debug.log('debug', `💓 Keep-alive received from VM ${connection.vmId} (seq: ${message.sequence_number}${rttText}${avgRttText}, sent: ${connection.keepAliveSentCount}, received: ${connection.keepAliveReceivedCount}, failures: ${connection.keepAliveFailureCount})`)

    // Warn about high latency
    if (rtt !== undefined && rtt > 5000) {
      this.delegate.debug.log('warn', `⚠️ High keep-alive latency detected for VM ${connection.vmId}: ${rtt}ms`)
    }

    // Warn about high average latency
    if (connection.keepAliveAverageRtt > 3000) {
      this.delegate.debug.log('warn', `⚠️ Average keep-alive latency is high for VM ${connection.vmId}: ${connection.keepAliveAverageRtt.toFixed(0)}ms`)
    }

    // Send keep-alive response immediately using sendMessage for proper error handling
    const keepAliveResponse = {
      type: 'keep_alive_response' as const,
      sequence_number: message.sequence_number,
      timestamp: new Date().toISOString()
    }

    // Use sendMessage instead of raw socket.write() for proper error handling
    this.delegate.sendMessage(connection, keepAliveResponse)
    this.delegate.debug.log('debug', `💓 Keep-alive response sent to VM ${connection.vmId} (seq: ${message.sequence_number})`)
  }

  /**
   * Process health check queue when VM connects.
   * Delegates to VMHealthQueueManager if available.
   */
  public processHealthCheckQueue(connection: VmConnection): void {
    const queueManager = this.delegate.getQueueManager()
    if (!queueManager) {
      this.delegate.debug.log('debug', `⚕️ No queue manager available for VM ${connection.vmId}, skipping health check queue processing`)
      return
    }

    this.delegate.debug.log('info', `⚕️ Processing health check queue for VM ${connection.vmId}`)

    // Process any queued health checks for this VM
    setImmediate(async () => {
      try {
        await queueManager.processQueue(connection.vmId)
      } catch (error) {
        this.delegate.debug.log('error', `Failed to process health queue for VM ${connection.vmId}: ${error}`)
      }
    })
  }

  /**
   * Get keep-alive metrics for a specific VM.
   */
  public getKeepAliveMetrics(vmId: string): {
    sentCount: number
    receivedCount: number
    failureCount: number
    consecutiveFailures: number
    averageRtt: number
    lastSent?: Date
    lastReceived?: Date
    lastFailure?: Date
    rttHistory: number[]
  } | null {
    const connection = this.delegate.getConnection(vmId)
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
}

/**
 * Update the connection stability score based on circuit breaker state,
 * keep-alive failures, transmission failures, and degraded mode.
 * Exported as a standalone function since it operates purely on VmConnection.
 */
export function updateConnectionStabilityScore(connection: VmConnection): void {
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
