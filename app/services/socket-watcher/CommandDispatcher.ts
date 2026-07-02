import { Logger } from 'winston'
/**
 * CommandDispatcher — Handles command construction, sending, and retry logic
 *
 * Extracted from VirtioSocketWatcherService. This module owns:
 * - Low-level socket message transmission (sendMessage)
 * - Safe command formatting with serde-tagged structure (sendSafeCommand)
 * - Unsafe/raw command sending (sendUnsafeCommand)
 * - Convenience wrappers (package, process, user, maintenance commands)
 * - Retry logic (executeCommandWithRetry)
 *
 * Dependencies are injected via constructor. The connections Map is passed
 * from the orchestrator so this module can look up VM connections.
 */

import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type {
  VmConnection,
  OutboundMessage,
  FormattedCommandType,
  SafeCommandType,
  UnsafeCommandRequest,
  CommandResponse,
} from './types'
import { redactSensitive } from './types'

// ────────────────────────────────────────────────────────────────────────────────
// Types for injected dependencies
// ────────────────────────────────────────────────────────────────────────────────

/** Callback the dispatcher uses to reconnect a VM when a command finds it disconnected */
export type ReconnectFn = (vmId: string, socketPath: string) => Promise<void>

/** Callback to send a message over a VM socket */
export type SendMessageFn = (connection: VmConnection, message: OutboundMessage) => void

export interface CommandDispatcherDeps {
  debug: Logger
  /** The orchestrator's connections Map — shared reference */
  connections: Map<string, VmConnection>
  /** Function to trigger reconnection when a command finds VM disconnected */
  reconnectFn: ReconnectFn
  /** Function to write messages to a VM socket (owned by orchestrator) */
  sendMessage: SendMessageFn
}

// ────────────────────────────────────────────────────────────────────────────────
// CommandDispatcher
// ────────────────────────────────────────────────────────────────────────────────

export class CommandDispatcher {
  private readonly debug: Logger
  private readonly connections: Map<string, VmConnection>
  private readonly reconnectFn: ReconnectFn
  private readonly sendMessage: SendMessageFn

  constructor(deps: CommandDispatcherDeps) {
    this.debug = deps.debug
    this.connections = deps.connections
    this.reconnectFn = deps.reconnectFn
    this.sendMessage = deps.sendMessage
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Safe command sending
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Send a safe command to a VM
   *
   * @remarks
   * Optional fields with `undefined` values are omitted during JSON serialization,
   * which correctly maps to Rust's `Option::None`. Use nullish coalescing (??)
   * for optional fields to preserve falsy values (0, false, '')..
   */
  async sendSafeCommand(
    vmId: string,
    commandType: SafeCommandType,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    let connection = this.connections.get(vmId)
    if (!connection) {
      throw new Error(`No connection to VM ${vmId}`)
    }

    if (!connection.isConnected) {
      // Try to reconnect once before failing
      this.debug.warn(`VM ${vmId} is not connected, attempting reconnection...`)

      // Check if socket file still exists
      const socketPath = connection.socketPath
      if (socketPath && fs.existsSync(socketPath)) {
        await this.reconnectFn(vmId, socketPath)
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Check again
        const updatedConnection = this.connections.get(vmId)
        if (!updatedConnection || !updatedConnection.isConnected) {
          throw new Error(`VM ${vmId} is not connected and reconnection failed`)
        }
        // reconnectFn/connectToVm REPLACES the VmConnection in the map with a new
        // instance and destroys the old socket. Retarget the live handle so the
        // pending command and sendMessage below don't hit the stale (destroyed)
        // object — which would silently drop the write and hang until timeout.
        connection = updatedConnection
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
      const commandTypeFormatted = this.formatCommandType(commandType)

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

      // Redact before logging: JoinDomain (and future commands) carry secrets
      // like the domain bind password, which must never hit the log.
      this.debug.debug(`Sending safe command ${commandId} to VM ${vmId}: ${JSON.stringify(redactSensitive(message))}`)
      this.sendMessage(connection, message)
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Unsafe command sending
  // ──────────────────────────────────────────────────────────────────────────

  async sendUnsafeCommand(
    vmId: string,
    rawCommand: string,
    options: Partial<UnsafeCommandRequest> = {},
    timeout: number = 30000
  ): Promise<CommandResponse> {
    let connection = this.connections.get(vmId)
    if (!connection) {
      throw new Error(`No connection to VM ${vmId}`)
    }

    if (!connection.isConnected) {
      // Try to reconnect once before failing
      this.debug.warn(`VM ${vmId} is not connected, attempting reconnection...`)

      // Check if socket file still exists
      const socketPath = connection.socketPath
      if (socketPath && fs.existsSync(socketPath)) {
        await this.reconnectFn(vmId, socketPath)
        // Wait a moment for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Check again
        const updatedConnection = this.connections.get(vmId)
        if (!updatedConnection || !updatedConnection.isConnected) {
          throw new Error(`VM ${vmId} is not connected and reconnection failed`)
        }
        // reconnectFn/connectToVm REPLACES the VmConnection in the map with a new
        // instance and destroys the old socket. Retarget the live handle so the
        // pending command and sendMessage below don't hit the stale (destroyed)
        // object — which would silently drop the write and hang until timeout.
        connection = updatedConnection
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
        env_vars: options.envVars,
        run_as: options.runAs
      }

      this.debug.debug(`Sending unsafe command ${commandId} to VM ${vmId}: ${rawCommand}`)
      this.sendMessage(connection, message)
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Convenience wrappers
  // ──────────────────────────────────────────────────────────────────────────

  /** Helper method specifically for package management commands */
  async sendPackageCommand(
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

  /** Helper method specifically for process control commands */
  async sendProcessCommand(
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

  /** Helper method to get user list from VM */
  async getUserList(
    vmId: string,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'UserList'
    }
    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for executing PowerShell scripts */
  async sendMaintenancePowerShellScript(
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
    const commandType: SafeCommandType = {
      action: 'ExecutePowerShellScript',
      params: {
        script,
        script_type: options.scriptType || 'inline',
        timeout_seconds: options.timeoutSeconds,
        working_directory: options.workingDirectory,
        environment_vars: options.environmentVars,
        run_as_admin: options.runAsAdmin || false
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for running maintenance tasks */
  async sendMaintenanceTask(
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
    const commandType: SafeCommandType = {
      action: 'RunMaintenanceTask',
      params: {
        task_type: taskType,
        task_name: taskName,
        parameters,
        validate_before: options.validateBefore || false,
        validate_after: options.validateAfter || false
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for system health validation */
  async sendValidateSystemHealth(
    vmId: string,
    checkName?: string,
    timeout: number = 30000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'ValidateSystemHealth',
      params: {
        check_name: checkName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for cleaning temporary files */
  async sendCleanTemporaryFiles(
    vmId: string,
    targets?: string[],
    timeout: number = 45000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'CleanTemporaryFiles',
      params: {
        targets
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for updating system software */
  async sendUpdateSystemSoftware(
    vmId: string,
    packageName?: string,
    timeout: number = 180000 // 3 minutes for software updates
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'UpdateSystemSoftware',
      params: {
        package: packageName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for restarting services */
  async sendRestartServices(
    vmId: string,
    serviceName?: string,
    timeout: number = 60000
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'RestartServices',
      params: {
        service_name: serviceName
      }
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  /** Helper method for checking system integrity */
  async sendCheckSystemIntegrity(
    vmId: string,
    timeout: number = 120000 // 2 minutes for integrity checks
  ): Promise<CommandResponse> {
    const commandType: SafeCommandType = {
      action: 'CheckSystemIntegrity'
    }

    return this.sendSafeCommand(vmId, commandType, timeout)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Retry logic
  // ──────────────────────────────────────────────────────────────────────────

  async executeCommandWithRetry(
    vmId: string,
    commandBuilder: () => Promise<CommandResponse>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<CommandResponse> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.debug.debug(`Executing command for VM ${vmId}, attempt ${attempt}/${maxRetries}`)
        const response = await commandBuilder()

        // If command succeeded or failed but got a response, return it
        if (response.success || attempt === maxRetries) {
          return response
        }

        // If command failed but we have retries left, wait and retry
        this.debug.warn(`Command failed for VM ${vmId}, retrying in ${retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      } catch (error) {
        lastError = error as Error
        this.debug.warn(`Command attempt ${attempt} failed for VM ${vmId}: ${error}`)

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }

    throw lastError || new Error(`Command failed after ${maxRetries} attempts`)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Format the command type with proper serde tag format.
   * InfiniService expects SafeCommandType with #[serde(tag = "action")].
   */
  private formatCommandType(commandType: SafeCommandType): FormattedCommandType {
    switch (commandType.action) {
      case 'PackageSearch':
        return {
          action: 'PackageSearch',
          query: commandType.params?.query || ''
        }
      case 'PackageInstall':
        return {
          action: 'PackageInstall',
          package: commandType.params?.package || ''
        }
      case 'PackageRemove':
        return {
          action: 'PackageRemove',
          package: commandType.params?.package || ''
        }
      case 'PackageUpdate':
        return {
          action: 'PackageUpdate',
          package: commandType.params?.package || ''
        }
      case 'PackageList':
        return { action: 'PackageList' }
      case 'ServiceList':
        return { action: 'ServiceList' }
      case 'ServiceControl': {
        // infiniservice deserializes ServiceControl as a nested
        // `params: ServiceControlParams { service, operation }` (NOT flattened,
        // and NOT the resolver's `service_name`/`action` field names). Without
        // this case the request hit the `default` branch, which returns only
        // `{ action }` and silently dropped the params — every controlVMService
        // call no-op'd on the guest. Remap here (accepting either field-name
        // spelling) so a validated request actually reaches the agent.
        const p = (commandType.params ?? {}) as Record<string, unknown>
        const service = (p.service ?? p.service_name ?? '') as string
        const operation = (p.operation ?? p.action ?? '') as string
        if (typeof service !== 'string' || service.trim() === '') {
          throw new Error('ServiceControl requires a non-empty service name')
        }
        if (typeof operation !== 'string' || operation.trim() === '') {
          throw new Error('ServiceControl requires an operation')
        }
        return {
          action: 'ServiceControl',
          params: { service, operation }
        }
      }
      case 'SystemInfo':
        return { action: 'SystemInfo' }
      case 'OsInfo':
        return { action: 'OsInfo' }
      case 'ProcessList':
        return {
          action: 'ProcessList',
          limit: commandType.params?.limit || null
        }
      case 'ProcessKill':
        return {
          action: 'ProcessKill',
          pid: commandType.params?.pid,
          force: commandType.params?.force || null
        }
      case 'ProcessTop':
        return {
          action: 'ProcessTop',
          limit: commandType.params?.limit || null,
          sort_by: commandType.params?.sort_by || null
        }
      // Maintenance commands
      case 'ExecutePowerShellScript':
        // Validate required script parameter
        if (!commandType.params?.script || typeof commandType.params.script !== 'string' || commandType.params.script.trim() === '') {
          throw new Error('ExecutePowerShellScript requires a non-empty script parameter')
        }
        return {
          action: 'ExecutePowerShellScript',
          script: commandType.params.script,
          script_type: commandType.params.script_type || 'inline',  // Keep || for required string with default
          timeout_seconds: commandType.params.timeout_seconds ?? undefined,  // Use ?? to preserve 0
          working_directory: commandType.params.working_directory ?? undefined,  // Use ?? to preserve ''
          environment_vars: commandType.params.environment_vars ?? undefined,  // Use ?? to preserve {}
          run_as_admin: commandType.params.run_as_admin ?? false  // Use ?? for consistency
        }
      case 'RunMaintenanceTask':
        return {
          action: 'RunMaintenanceTask',
          task_type: commandType.params?.task_type || '',
          task_name: commandType.params?.task_name || '',
          parameters: commandType.params?.parameters || undefined,
          validate_before: commandType.params?.validate_before || false,
          validate_after: commandType.params?.validate_after || false
        }
      case 'ValidateSystemHealth':
        return {
          action: 'ValidateSystemHealth',
          check_name: commandType.params?.check_name || undefined
        }
      case 'CleanTemporaryFiles':
        return {
          action: 'CleanTemporaryFiles',
          targets: commandType.params?.targets || undefined
        }
      case 'UpdateSystemSoftware':
        return {
          action: 'UpdateSystemSoftware',
          package: commandType.params?.package || undefined
        }
      case 'RestartServices':
        return {
          action: 'RestartServices',
          service_name: commandType.params?.service_name || undefined
        }
      case 'CheckSystemIntegrity':
        return {
          action: 'CheckSystemIntegrity'
        }
      case 'UserList':
        return { action: 'UserList' }
      case 'JoinDomain':
        // Flattened fields matching infiniservice's serde(tag="action").
        // Required fields are validated by the caller (DomainJoinService).
        return {
          action: 'JoinDomain',
          domain: commandType.domain,
          username: commandType.username,
          password: commandType.password,
          ou: commandType.ou ?? undefined,
          computer_name: commandType.computer_name ?? undefined,
          restart_after: commandType.restart_after ?? false
        }
      default:
        return { action: commandType.action }
    }
  }
}
