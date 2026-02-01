import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'
import { PortUsage, FirewallRule } from '@prisma/client'
import prisma from '@utils/database'

/**
 * PortConflictChecker - Detects applications blocked by firewall rules
 *
 * @description
 * Identifies applications that are trying to use ports but are being blocked by firewall rules.
 * Uses two detection strategies:
 * 1. Query BlockedConnection table for real blocked connection events
 * 2. Heuristic analysis: compare listening ports against blocking firewall rules
 *
 * @category Security
 *
 * @analysis
 * **Strategy 1: Real Blocked Connections (Future)**
 * - Queries BlockedConnection table for recent blocked attempts (last 24 hours)
 * - Provides accurate data when infiniservice implements Windows Firewall monitoring
 * - Currently placeholder - will be populated when Windows event monitoring is added
 *
 * **Strategy 2: Heuristic Detection (Current)**
 * - Queries VM's FirewallRuleSet for all rules with action=DROP or REJECT
 * - Queries current PortUsage for all listening ports
 * - Matches ports against blocking rules by:
 *   - Protocol: rule.protocol === 'all' OR rule.protocol matches port protocol
 *   - Port range: port falls within rule's dstPortStart/End range
 *   - Direction: rule blocks incoming connections (IN or INOUT)
 * - Generates recommendations for matched ports
 *
 * @input
 * - context.vmId: VM ID to analyze
 * - context.portUsage: Array of PortUsage records (isListening ports)
 * - Machine's FirewallRuleSet and FirewallRule records from database
 *
 * @output
 * RecommendationResult[] with type 'PORT_BLOCKED':
 * - text: User-friendly description of the blocked port and application
 * - actionText: Suggestion to modify firewall rules or reconfigure application
 * - data:
 *   - port: Port number
 *   - protocol: Protocol (TCP/UDP)
 *   - processName: Name of the process listening on the port
 *   - blockReason: Explanation of why it's blocked
 *   - ruleName: Name of the blocking firewall rule (if heuristic)
 *   - ruleAction: Action type (DROP/REJECT)
 *   - ruleId: ID of blocking rule
 *   - attemptCount: Number of blocked attempts (if from BlockedConnection)
 *   - lastAttempt: Timestamp of last attempt (if from BlockedConnection)
 *
 * @example
 * ```typescript
 * // Heuristic detection output:
 * [{
 *   type: 'PORT_BLOCKED',
 *   text: "Application 'mysqld.exe' is listening on port 3306 (TCP), but firewall rule 'Block MySQL' is blocking incoming connections",
 *   actionText: "Modify or remove the blocking firewall rule, or configure the application to use an allowed port",
 *   data: {
 *     port: 3306,
 *     protocol: 'TCP',
 *     processName: 'mysqld.exe',
 *     ruleName: 'Block MySQL',
 *     ruleAction: 'DROP',
 *     ruleId: 'rule-uuid-123'
 *   }
 * }]
 *
 * // Real blocked connection output (future):
 * [{
 *   type: 'PORT_BLOCKED',
 *   text: "Port 3306 (TCP) is being blocked by firewall rules. Process 'mysqld.exe' attempted to use this port.",
 *   actionText: "Review firewall rules to allow this port if the application requires network access",
 *   data: {
 *     port: 3306,
 *     protocol: 'TCP',
 *     processName: 'mysqld.exe',
 *     blockReason: 'Windows Firewall blocked connection (rule: Block MySQL)',
 *     attemptCount: 15,
 *     lastAttempt: '2025-10-16T12:30:00Z'
 *   }
 * }]
 * ```
 *
 * @future
 * When infiniservice implements Windows Firewall monitoring:
 * - Strategy 1 will provide real-time blocked connection data
 * - Windows Event Log (Security, Event ID 5157) or WFP API events
 * - More accurate than heuristic detection
 * - Will include source IPs, exact block timestamps, and attempt counts
 */
export class PortConflictChecker extends RecommendationChecker {
  getName (): string { return 'PortConflictChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      // Strategy 1: Query real blocked connections (future - currently empty)
      const blockedConnectionResults = await this.detectRealBlockedConnections(context.vmId)
      results.push(...blockedConnectionResults)

      // Strategy 2: Heuristic analysis of firewall rules vs listening ports
      const heuristicResults = await this.detectPortConflictsHeuristic(context)
      results.push(...heuristicResults)

      // De-duplicate recommendations by port+protocol
      // Prefer real blocked connection data (Strategy 1) over heuristic data (Strategy 2)
      const deduplicated = this.deduplicateRecommendations(results)

      console.debug(`PortConflictChecker: Found ${deduplicated.length} port conflict recommendations for VM ${context.vmId} (${results.length - deduplicated.length} duplicates removed)`)

      return deduplicated
    } catch (error) {
      console.error(`PortConflictChecker: Error analyzing VM ${context.vmId}:`, error)
      // Return empty array on error to prevent recommendation service failure
      return []
    }
  }

  /**
   * De-duplicates recommendations by port+protocol, preferring real blocked connection data
   *
   * @param recommendations Array of recommendations from both strategies
   * @returns De-duplicated array with most informative recommendations kept
   */
  private deduplicateRecommendations (recommendations: RecommendationResult[]): RecommendationResult[] {
    const dedupeMap = new Map<string, RecommendationResult>()

    for (const rec of recommendations) {
      // Create unique key: port + protocol (+ optionally ruleId for more granularity)
      const port = rec.data?.port
      const protocol = rec.data?.protocol

      if (!port || !protocol) {
        const fallbackKey = `unknown-${Math.random()}`
        dedupeMap.set(fallbackKey, rec)
        continue
      }

      const key = `${port}-${protocol}`

      const existing = dedupeMap.get(key)

      if (!existing) {
        // First occurrence for this port/protocol/rule combination
        dedupeMap.set(key, rec)
      } else {
        // Prefer real blocked connection data (has attemptCount) over heuristic (has ruleName)
        const isRealBlockedConnection = rec.data?.attemptCount !== undefined
        const existingIsRealBlockedConnection = existing.data?.attemptCount !== undefined

        if (isRealBlockedConnection && !existingIsRealBlockedConnection) {
          // Current is real blocked connection, existing is heuristic - replace
          dedupeMap.set(key, rec)
        } else if (!isRealBlockedConnection && existingIsRealBlockedConnection) {
          // Existing is real blocked connection, current is heuristic - keep existing
          // (do nothing)
        } else {
          // Both are same type - keep first occurrence
          // (do nothing)
        }
      }
    }

    return Array.from(dedupeMap.values())
  }

  /**
   * Strategy 1: Query BlockedConnection table for real blocked connection attempts
   * Returns recommendations based on actual blocked connections recorded in the database
   */
  private async detectRealBlockedConnections (vmId: string): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      // Query blocked connections from last 24 hours
      const blockedConnections = await prisma.blockedConnection.findMany({
        where: {
          machineId: vmId,
          attemptTime: {
            gte: twentyFourHoursAgo
          }
        },
        orderBy: {
          attemptTime: 'desc'
        }
      })

      // Group by port/protocol to avoid duplicate recommendations
      const groupedByPort = new Map<string, typeof blockedConnections[0][]>()
      for (const blocked of blockedConnections) {
        const key = `${blocked.port}-${blocked.protocol}`
        if (!groupedByPort.has(key)) {
          groupedByPort.set(key, [])
        }
        const group = groupedByPort.get(key)
        if (group) {
          group.push(blocked)
        }
      }

      // Create recommendations for each unique port/protocol combination
      for (const blocks of groupedByPort.values()) {
        const latestBlock = blocks[0]
        const attemptCount = blocks.length

        results.push({
          type: 'PORT_BLOCKED',
          text: `Port ${latestBlock.port} (${latestBlock.protocol}) is being blocked by firewall rules. Process '${latestBlock.processName || 'Unknown'}' attempted to use this port.`,
          actionText: 'Review firewall rules to allow this port if the application requires network access',
          data: {
            port: latestBlock.port,
            protocol: latestBlock.protocol,
            processName: latestBlock.processName || 'Unknown',
            blockReason: latestBlock.blockReason,
            attemptCount,
            lastAttempt: latestBlock.attemptTime.toISOString(),
            sourceIp: latestBlock.sourceIp || undefined,
            ruleId: latestBlock.ruleId || undefined
          }
        })
      }

      if (results.length > 0) {
        console.debug(`PortConflictChecker: Found ${results.length} real blocked connections for VM ${vmId}`)
      }
    } catch (error) {
      console.error(`PortConflictChecker: Error querying BlockedConnection table for VM ${vmId}:`, error)
    }

    return results
  }

  /**
   * Strategy 2: Heuristic detection by comparing listening ports against blocking firewall rules
   * Analyzes current port usage and matches against firewall rules to detect potential conflicts
   */
  private async detectPortConflictsHeuristic (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      // Get VM's firewall rule set and all blocking rules
      const machine = await prisma.machine.findUnique({
        where: { id: context.vmId },
        include: {
          firewallRuleSet: {
            include: {
              rules: {
                where: {
                  action: {
                    in: ['DROP', 'REJECT']
                  }
                }
              }
            }
          }
        }
      })

      if (!machine?.firewallRuleSet?.rules || machine.firewallRuleSet.rules.length === 0) {
        console.debug(`PortConflictChecker: No blocking firewall rules found for VM ${context.vmId}`)
        return results
      }

      const blockingRules = machine.firewallRuleSet.rules

      // Get listening ports from context
      let listeningPorts = context.portUsage.filter(port => port.isListening)

      // Fallback: Query recent PortUsage from DB if context is empty (e.g., first run)
      if (listeningPorts.length === 0) {
        console.debug(`PortConflictChecker: No listening ports in context for VM ${context.vmId}, querying recent PortUsage from DB`)

        try {
          // Query recent listening ports (last 5 minutes) to avoid heavy reads
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
          const recentPorts = await prisma.portUsage.findMany({
            where: {
              machineId: context.vmId,
              isListening: true,
              timestamp: {
                gte: fiveMinutesAgo
              }
            },
            orderBy: {
              timestamp: 'desc'
            },
            take: 100 // Limit to avoid scanning large datasets
          })

          listeningPorts = recentPorts
          console.debug(`PortConflictChecker: Found ${listeningPorts.length} recent listening ports from DB for VM ${context.vmId}`)
        } catch (dbError) {
          console.error(`PortConflictChecker: Error querying recent PortUsage for VM ${context.vmId}:`, dbError)
          // Continue with empty array - will return no results
        }
      }

      if (listeningPorts.length === 0) {
        console.debug(`PortConflictChecker: No listening ports found for VM ${context.vmId}`)
        return results
      }

      // Match each listening port against blocking rules
      for (const port of listeningPorts) {
        for (const rule of blockingRules) {
          if (this.matchesFirewallRule(port, rule)) {
            results.push({
              type: 'PORT_BLOCKED',
              text: `Application '${port.processName || 'Unknown'}' is listening on port ${port.port} (${port.protocol}), but firewall rule '${rule.name}' is blocking incoming connections`,
              actionText: 'Modify or remove the blocking firewall rule, or configure the application to use an allowed port',
              data: {
                port: port.port,
                protocol: port.protocol,
                processName: port.processName || 'Unknown',
                ruleName: rule.name,
                ruleAction: rule.action,
                ruleId: rule.id,
                ruleDescription: rule.description || undefined,
                executablePath: port.executablePath || undefined
              }
            })

            // Only report the first matching rule for each port to avoid duplicates
            break
          }
        }
      }

      if (results.length > 0) {
        console.debug(`PortConflictChecker: Found ${results.length} heuristic port conflicts for VM ${context.vmId}`)
      }
    } catch (error) {
      console.error(`PortConflictChecker: Error in heuristic detection for VM ${context.vmId}:`, error)
    }

    return results
  }

  /**
   * Checks if a port matches a firewall rule's criteria
   *
   * SCOPE: This method only detects INBOUND connection conflicts (direction IN or INOUT).
   * Listening ports (isListening=true) are compared against inbound-blocking rules.
   *
   * OUTBOUND conflicts are NOT detected by this heuristic method because:
   * - PortUsage.isListening only tracks servers, not outbound connections
   * - Outbound connection attempts require real-time monitoring via BlockedConnection
   * - When infiniservice implements Windows Firewall event monitoring, Strategy 1
   *   (detectRealBlockedConnections) will capture both inbound and outbound blocks
   *
   * @param port PortUsage record to check (must have isListening=true)
   * @param rule FirewallRule to match against
   * @returns true if the port matches the rule's blocking criteria for inbound traffic
   */
  private matchesFirewallRule (port: PortUsage, rule: FirewallRule): boolean {
    // Check protocol match
    const ruleProtocol = rule.protocol?.toLowerCase() || 'all'
    const portProtocol = port.protocol?.toLowerCase() || ''

    const protocolMatches = ruleProtocol === 'all' || ruleProtocol === portProtocol

    if (!protocolMatches) {
      return false
    }

    // Check port range match
    // If dstPortStart/End are null, treat as wildcard (matches all ports)
    const dstPortStart = rule.dstPortStart
    const dstPortEnd = rule.dstPortEnd
    const portNumber = port.port

    const portInRange = (dstPortStart === null || portNumber >= dstPortStart) &&
                       (dstPortEnd === null || portNumber <= dstPortEnd)

    if (!portInRange) {
      return false
    }

    // Check direction - only IN or INOUT blocks incoming connections
    // OUT-only rules are ignored by this heuristic (see method documentation)
    const direction = rule.direction || 'INOUT'
    const blocksIncoming = direction === 'IN' || direction === 'INOUT'

    if (!blocksIncoming) {
      return false
    }

    return true
  }
}
