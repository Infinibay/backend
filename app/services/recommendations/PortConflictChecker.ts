import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'
import { RecommendationType, PortUsage, VMNWFilter, FWRule, VmPort } from '@prisma/client'

/**
 * PortConflictChecker - Advanced network security analysis for port conflicts and misconfigurations
 *
 * @description
 * Performs comprehensive analysis of network security by examining port usage, firewall rules,
 * and VM port configurations. Detects security vulnerabilities including uncovered ports,
 * protocol mismatches, and missing configurations that could expose the VM to attacks.
 *
 * @category Security
 *
 * @analysis
 * 1. **Firewall Validation**: Checks if VM has any firewall rules attached
 * 2. **Port Extraction**: Identifies all listening ports excluding system-managed ports
 * 3. **Rule Mapping**: Extracts allowed port ranges from firewall rules
 * 4. **Conflict Detection**: Multi-layered security analysis:
 *    - **Uncovered Ports**: Listening ports without firewall rules
 *    - **Protocol Mismatches**: Ports with rules for different protocols
 *    - **VM Port Conflicts**: Services using ports not declared in VM config
 *    - **Disabled Ports**: Services using ports that are disabled in VM settings
 *
 * 5. **Risk Assessment**: Categorizes issues by security impact
 *
 * @input
 * - context.portUsage: Array of active port connections
 * - context.firewallFilters: VM firewall rules and network filters
 * - context.vmPorts: VM port configuration settings
 *
 * Port usage format:
 * ```typescript
 * {
 *   port: number,
 *   protocol: string,
 *   isListening: boolean,
 *   processName?: string,
 *   executablePath?: string,
 *   processId?: number,
 *   timestamp: Date
 * }
 * ```
 *
 * Firewall rules format:
 * ```typescript
 * {
 *   action: 'accept' | 'reject',
 *   direction: 'in' | 'out' | 'inout',
 *   protocol?: string,
 *   dstPortStart?: string,
 *   dstPortEnd?: string
 * }
 * ```
 *
 * @output
 * RecommendationResult[] with:
 * - type: 'PORT_BLOCKED'
 * - text: Description of security issue
 * - actionText: Specific remediation steps
 * - data: {
 *     port: number,
 *     protocol: string,
 *     processName: string,
 *     conflictType: 'uncovered' | 'protocol_mismatch' | 'vm_port_disabled' | 'vm_port_missing',
 *     priority: 'HIGH' | 'MEDIUM',
 *     category: 'Security' | 'Configuration',
 *     firewallRuleSuggestion?: string
 *   }
 *
 * @security_checks
 * 1. **No Firewall**: VM without any firewall rules (HIGH priority)
 * 2. **Uncovered Ports**: Services running without firewall protection
 * 3. **Protocol Mismatches**: Firewall allows TCP but service uses UDP
 * 4. **VM Port Missing**: Services not declared in VM port configuration
 * 5. **VM Port Disabled**: Services using disabled VM ports
 *
 * @system_port_exclusions
 * Excludes common system ports from analysis:
 * - Well-known ports: 22 (SSH), 53 (DNS), 80 (HTTP), 443 (HTTPS)
 * - Windows services: 135, 139, 445 (RPC, NetBIOS, SMB)
 * - Management: 3389 (RDP), 5985/5986 (WinRM)
 * - Privileged ports (<1024) except 80 and 443
 *
 * @example
 * ```typescript
 * // Input: Service on port 8080/tcp with no firewall rule
 * portUsage: [{ port: 8080, protocol: 'tcp', isListening: true, processName: 'myapp.exe' }]
 * firewallFilters: [{ rules: [{ action: 'accept', direction: 'in', dstPortStart: '80' }] }]
 *
 * // Output:
 * [{
 *   type: 'PORT_BLOCKED',
 *   text: 'Application (myapp.exe) is using port 8080/tcp which is not allowed by firewall rules',
 *   actionText: 'Add a firewall rule to allow port 8080/tcp or stop the application if not needed',
 *   data: {
 *     port: 8080,
 *     protocol: 'tcp',
 *     processName: 'myapp.exe',
 *     conflictType: 'uncovered',
 *     priority: 'HIGH',
 *     category: 'Security',
 *     firewallRuleSuggestion: 'Add rule: allow tcp port 8080 (destination)'
 *   }
 * }]
 * ```
 */
export class PortConflictChecker extends RecommendationChecker {
  getName (): string { return 'PortConflictChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      if (!context.firewallFilters?.length) {
        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: 'No firewall rules attached to this VM',
          actionText: 'Attach appropriate NWFilter or configure department-level firewall policies to secure network access',
          data: {
            conflictType: 'no_firewall',
            priority: 'HIGH',
            category: 'Security',
            recommendation: 'Configure network filters for VM security'
          }
        })
        return results
      }

      if (!context.portUsage?.length) {
        return results
      }

      const listeningPorts = this.extractListeningPorts(context.portUsage)
      if (listeningPorts.length === 0) {
        return results
      }

      const allowedPortRanges = this.extractAllowedPortRanges(context.firewallFilters)
      const conflicts = this.detectPortConflicts(listeningPorts, allowedPortRanges, context.vmPorts)
      results.push(...this.generateConflictRecommendations(conflicts))
    } catch (error) {
      console.warn('Error analyzing port conflicts:', error)
    }

    return results
  }

  private extractListeningPorts (portUsage: PortUsage[]): Array<{
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
  }> {
    const portMap = new Map<string, {
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
      timestamp?: Date
    }>()

    for (const p of portUsage) {
      if (p.isListening && !this.isSystemPort(p.port)) {
        const key = `${p.port}/${p.protocol.toLowerCase()}`
        const existing = portMap.get(key)
        const current = {
          port: p.port,
          protocol: p.protocol.toLowerCase(),
          processName: p.processName || undefined,
          executablePath: p.executablePath || undefined,
          processId: p.processId || undefined,
          timestamp: p.timestamp
        }

        if (!existing ||
            (current.timestamp && existing.timestamp && current.timestamp > existing.timestamp) ||
            (!existing.processName && current.processName)) {
          portMap.set(key, current)
        }
      }
    }

    return Array.from(portMap.values()).map(({ timestamp, ...port }) => port)
  }

  private extractAllowedPortRanges (firewallFilters: (VMNWFilter & { nwFilter: { rules: FWRule[] } })[]): Array<{
    start: number
    end: number
    protocol: string
    allowAllDestPorts?: boolean
  }> {
    const allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }> = []

    for (const filter of firewallFilters) {
      for (const rule of filter.nwFilter.rules) {
        if (rule.action !== 'accept' || (rule.direction !== 'in' && rule.direction !== 'inout')) {
          continue
        }

        const protocol = rule.protocol?.toLowerCase() || 'all'

        if (!rule.dstPortStart && !rule.dstPortEnd && !rule.srcPortStart && !rule.srcPortEnd) {
          allowedRanges.push({
            start: 0,
            end: 65535,
            protocol,
            allowAllDestPorts: true
          })
          continue
        }

        if (rule.dstPortStart) {
          const startPort = Number(rule.dstPortStart)
          const endPort = rule.dstPortEnd ? Number(rule.dstPortEnd) : startPort

          allowedRanges.push({
            start: startPort,
            end: endPort,
            protocol
          })
        }
      }
    }

    return allowedRanges
  }

  private detectPortConflicts (
    listeningPorts: Array<{
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
    }>,
    allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }>,
    vmPorts: VmPort[]
  ): Array<{
    type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
    allowedProtocols?: string[]
    vmPortEnabled?: boolean
    vmPortToEnable?: boolean
  }> {
    const conflicts: Array<{
      type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
      allowedProtocols?: string[]
      vmPortEnabled?: boolean
      vmPortToEnable?: boolean
    }> = []

    for (const listening of listeningPorts) {
      const { port, protocol } = listening

      const vmPort = vmPorts.find(vp =>
        (port >= vp.portStart && port <= vp.portEnd) &&
        vp.protocol.toLowerCase() === protocol
      )

      if (vmPort && !vmPort.enabled) {
        conflicts.push({
          type: 'port_blocked',
          ...listening,
          vmPortEnabled: vmPort.enabled,
          vmPortToEnable: vmPort.toEnable
        })
      } else if (!vmPort) {
        conflicts.push({
          type: 'vm_port_missing',
          ...listening
        })
      }

      if (this.isPortAllowedByRules(port, protocol, allowedRanges)) {
        continue
      }

      const matchingRules = allowedRanges.filter(range =>
        port >= range.start && port <= range.end
      )

      if (matchingRules.length === 0) {
        conflicts.push({
          type: 'uncovered',
          ...listening
        })
      } else {
        const compatibleRules = matchingRules.filter(rule =>
          rule.protocol === 'all' ||
          rule.protocol === protocol
        )

        if (compatibleRules.length === 0) {
          const allowedProtocols = Array.from(new Set(matchingRules.map(r => r.protocol)))
          conflicts.push({
            type: 'protocol_mismatch',
            ...listening,
            allowedProtocols
          })
        }
      }
    }

    return conflicts
  }

  private isPortAllowedByRules (
    port: number,
    protocol: string,
    allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }>
  ): boolean {
    for (const range of allowedRanges) {
      if (range.allowAllDestPorts && (range.protocol === 'all' || range.protocol === protocol)) {
        return true
      }
    }

    return allowedRanges.some(range =>
      port >= range.start &&
      port <= range.end &&
      (range.protocol === 'all' || range.protocol === protocol)
    )
  }

  private generateConflictRecommendations (conflicts: Array<{
    type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
    allowedProtocols?: string[]
    vmPortEnabled?: boolean
    vmPortToEnable?: boolean
  }>): RecommendationResult[] {
    const results: RecommendationResult[] = []

    if (conflicts.length === 0) {
      return results
    }

    const uncoveredPorts = conflicts.filter(c => c.type === 'uncovered')
    const protocolMismatches = conflicts.filter(c => c.type === 'protocol_mismatch')
    const blockedPorts = conflicts.filter(c => c.type === 'port_blocked')
    const missingVmPorts = conflicts.filter(c => c.type === 'vm_port_missing')

    if (uncoveredPorts.length > 0) {
      if (uncoveredPorts.length === 1) {
        const conflict = uncoveredPorts[0]
        const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: `Application${processInfo} is using port ${conflict.port}/${conflict.protocol} which is not allowed by firewall rules`,
          actionText: `Add a firewall rule to allow port ${conflict.port}/${conflict.protocol} or stop the application if not needed`,
          data: {
            port: conflict.port,
            protocol: conflict.protocol,
            processName: conflict.processName || 'Unknown',
            executablePath: conflict.executablePath || 'Unknown',
            processId: conflict.processId || 0,
            conflictType: 'uncovered',
            priority: 'HIGH',
            category: 'Security',
            firewallRuleSuggestion: `Add rule: allow ${conflict.protocol} port ${conflict.port} (destination)`
          }
        })
      } else {
        const portList = uncoveredPorts.map(c => `${c.port}/${c.protocol}`).join(', ')
        const uncoveredPortsList = uncoveredPorts.map(c =>
          `${c.port}/${c.protocol} (${c.processName || 'Unknown'})`
        ).join(', ')

        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: `${uncoveredPorts.length} applications are using ports not covered by firewall rules: ${portList}`,
          actionText: 'Review and update firewall configuration to allow necessary ports or stop unused applications',
          data: {
            conflictCount: uncoveredPorts.length,
            conflictType: 'uncovered',
            uncoveredPortsList,
            priority: 'HIGH',
            category: 'Security',
            firewallRuleSuggestion: 'Review each port and add appropriate firewall rules'
          }
        })
      }
    }

    for (const conflict of blockedPorts) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Application${processInfo} is using port ${conflict.port}/${conflict.protocol} but VM port settings don't allow this service`,
        actionText: `Enable port ${conflict.port}/${conflict.protocol} in VM port configuration or stop the application if not needed`,
        data: {
          port: conflict.port,
          protocol: conflict.protocol,
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'vm_port_disabled',
          vmPortEnabled: conflict.vmPortEnabled,
          vmPortToEnable: conflict.vmPortToEnable,
          priority: 'HIGH',
          category: 'Configuration'
        }
      })
    }

    for (const conflict of missingVmPorts) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Service${processInfo} is using port ${conflict.port}/${conflict.protocol} but it is not declared in VM port settings`,
        actionText: `Declare and enable ${conflict.port}/${conflict.protocol} in VM port configuration or stop the service`,
        data: {
          port: conflict.port,
          protocol: conflict.protocol,
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'vm_port_missing',
          category: 'Configuration',
          priority: 'HIGH'
        }
      })
    }

    for (const conflict of protocolMismatches) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''
      const allowedProtocolsText = conflict.allowedProtocols?.join(', ') || 'unknown'

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Port ${conflict.port} has firewall rules for ${allowedProtocolsText} but application${processInfo} is using ${conflict.protocol}`,
        actionText: `Update firewall rules to allow ${conflict.protocol} protocol or configure application to use ${allowedProtocolsText}`,
        data: {
          port: conflict.port,
          actualProtocol: conflict.protocol,
          allowedProtocols: conflict.allowedProtocols?.join(', ') || '',
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'protocol_mismatch',
          priority: 'MEDIUM',
          category: 'Security',
          firewallRuleSuggestion: `Update rule: allow ${conflict.protocol} port ${conflict.port}`
        }
      })
    }

    return results
  }

  private isSystemPort (port: number): boolean {
    const systemPorts = new Set([
      22, 53, 80, 443, 123, 135, 139, 445, 993, 995, 3389, 5985, 5986
    ])

    return systemPorts.has(port) || (port < 1024 && ![80, 443].includes(port))
  }
}
