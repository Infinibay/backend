/**
 * HealthMonitor — Periodic staleness / quality assessment for VM connections
 *
 * Runs a recurring check that evaluates whether a connection is stale
 * (too long since last message), updates `connectionQuality` and
 * `connectionStabilityScore` with progressive degradation, and records
 * results in `healthCheckResults`.
 *
 * Keep-alive monitoring, keep-alive message handling, and keep-alive
 * metrics live in `KeepAliveManager`. Health-check-queue processing
 * lives in the orchestrator.
 */

import type { Logger } from 'winston'
import type { VmConnection, HealthCheckResult } from './types'

export interface HealthMonitorConfig {
  messageTimeout: number
  pingInterval: number
  keepAliveInterval: number
}

export interface HealthMonitorDelegate {
  debug: Logger
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
   * The connection stays open on staleness — only the VM closing the socket,
   * the watcher stopping, or the socket file being removed will disconnect it.
   */
  public startHealthMonitoring(connection: VmConnection): void {
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
    }

    this.delegate.debug.info(`🔍 Starting health monitoring for VM ${connection.vmId} (timeout=${this.config.messageTimeout}ms, interval=${this.config.pingInterval}ms)`)

    connection.pingTimer = setInterval(() => {
      const now = Date.now()
      const healthCheckStartTime = Date.now()
      connection.lastHealthCheckTime = new Date()

      const timeSinceLastMessage = now - connection.lastMessageTime.getTime()
      const connectionUptime = now - connection.connectionStartTime.getTime()

      let healthCheckSuccess = true
      let healthLatency: number | undefined
      let healthError: string | undefined

      const stalenessThreshold = this.config.messageTimeout * 1.5
      const graceTimeAfterConnection = 300000
      const inGracePeriod = connectionUptime < graceTimeAfterConnection

      if (timeSinceLastMessage > stalenessThreshold && !inGracePeriod) {
        healthCheckSuccess = false
        healthError = `Message timeout: ${Math.round(timeSinceLastMessage / 1000)}s since last message`

        if (timeSinceLastMessage > stalenessThreshold * 2) {
          connection.connectionQuality = 'critical'
          connection.connectionStabilityScore = Math.max(0, connection.connectionStabilityScore - 15)
        } else if (timeSinceLastMessage > stalenessThreshold * 1.5) {
          connection.connectionQuality = 'poor'
          connection.connectionStabilityScore = Math.max(10, connection.connectionStabilityScore - 8)
        } else {
          connection.connectionQuality = 'good'
          connection.connectionStabilityScore = Math.max(20, connection.connectionStabilityScore - 5)
        }

        this.delegate.debug.warn(`Connection to VM ${connection.vmId} appears stale (${Math.round(timeSinceLastMessage / 1000)}s since last message), quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
        this.delegate.debug.debug(`Health check context: uptime=${connectionUptime}ms, msgs_sent=${connection.messageStats.sent}, msgs_received=${connection.messageStats.received}, errors=${connection.messageStats.errors}`)

        const idleDuration = now - connection.lastMessageTime.getTime()
        const idleThreshold = this.config.keepAliveInterval * 2
        const isCurrentlyIdle = idleDuration > idleThreshold

        if (!connection.wasIdle && isCurrentlyIdle) {
          this.delegate.debug.warn(`⚠️ Connection transitioned from ACTIVE to IDLE after ${(idleDuration / 1000).toFixed(0)}s of inactivity for VM ${connection.vmId}`)
          connection.wasIdle = true
        } else if (connection.wasIdle && !isCurrentlyIdle) {
          this.delegate.debug.info(`✅ Connection transitioned from IDLE to ACTIVE for VM ${connection.vmId}`)
          connection.wasIdle = false
        }

        if (isCurrentlyIdle) {
          this.delegate.debug.warn(`⚠️ Connection to VM ${connection.vmId} has been idle for ${(idleDuration / 1000).toFixed(0)}s - no messages received`)
        }

        this.delegate.debug.debug(`Keeping connection open despite staleness - waiting for VM ${connection.vmId} to send data`)
      } else {
        healthLatency = Date.now() - healthCheckStartTime

        if (timeSinceLastMessage < this.config.pingInterval / 2) {
          connection.connectionQuality = 'excellent'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 2)
        } else if (timeSinceLastMessage < this.config.pingInterval) {
          connection.connectionQuality = 'good'
          connection.connectionStabilityScore = Math.min(100, connection.connectionStabilityScore + 1)
        }

        this.delegate.debug.debug(`Health check passed for VM ${connection.vmId}: last_msg=${Math.round(timeSinceLastMessage / 1000)}s ago, quality=${connection.connectionQuality}, stability=${connection.connectionStabilityScore}%`)
      }

      const healthResult: HealthCheckResult = {
        timestamp: new Date(),
        success: healthCheckSuccess,
        latency: healthLatency,
        error: healthError
      }

      connection.healthCheckResults.push(healthResult)

      if (connection.healthCheckResults.length > 50) {
        connection.healthCheckResults = connection.healthCheckResults.slice(-50)
      }

      const recentResults = connection.healthCheckResults.slice(-10)
      const successRate = recentResults.filter(r => r.success).length / recentResults.length
      const avgLatency = recentResults
        .filter(r => r.latency !== undefined)
        .reduce((sum, r) => sum + (r.latency || 0), 0) / Math.max(1, recentResults.filter(r => r.latency !== undefined).length)

      if (connection.healthCheckResults.length % 10 === 0) {
        this.delegate.debug.info(`📊 Health summary for VM ${connection.vmId}: success_rate=${(successRate * 100).toFixed(1)}%, avg_latency=${avgLatency.toFixed(1)}ms, stability=${connection.connectionStabilityScore}%`)
      }
    }, this.config.pingInterval)
  }

  /**
   * Stop health monitoring by clearing the ping timer on the connection.
   */
  public stopHealthMonitoring(connection: VmConnection): void {
    if (connection.pingTimer) {
      clearInterval(connection.pingTimer)
      connection.pingTimer = undefined
    }
  }
}

/**
 * Calculate and update the connection stability score.
 * Pure function — operates only on the VmConnection passed in.
 * Used by both ConnectionManager (after circuit-breaker transitions) and
 * KeepAliveManager (after keep-alive failures).
 */
export function updateConnectionStabilityScore(connection: VmConnection): void {
  let score = 100

  switch (connection.circuitBreakerState) {
    case 'Open':
      score -= 50
      break
    case 'HalfOpen':
      score -= 25
      break
    case 'Closed':
      break
  }

  score -= connection.keepAliveFailureCount * 5
  score -= connection.transmissionFailureCount * 2

  if (connection.isDegraded) {
    score -= 20
  }

  connection.connectionStabilityScore = Math.max(0, score)
}
