/**
 * DirectPackageManager - Service for managing packages directly on VMs using native package managers
 *
 * This service communicates with InfiniService via VirtioSocketWatcherService to execute
 * package management commands using the native package manager of each OS:
 * - Windows: winget
 * - Ubuntu/Debian: apt
 * - RHEL/CentOS: dnf/yum
 *
 * Unlike ApplicationService, this doesn't use the database 'applications' table,
 * but executes commands directly on the VM and returns real-time results.
 */

import { PrismaClient } from '@prisma/client'
import { VirtioSocketWatcherService, CommandResponse } from './VirtioSocketWatcherService'
import { Debugger } from '../utils/debug'

// InfiniService response types
interface InfiniServicePackage {
  // PascalCase fields from InfiniService
  Name?: string
  Version?: string
  Id?: string
  Description?: string
  Installed?: boolean
  Publisher?: string
  Source?: string
  // Lowercase fields for backward compatibility
  name?: string
  version?: string
  id?: string
  description?: string
  installed?: boolean
  publisher?: string
  source?: string
  vendor?: string
  repository?: string
}

interface InfiniServicePackageData {
  packages?: InfiniServicePackage[]
}

interface InfiniServiceResponse {
  success: boolean
  data?: InfiniServicePackageData
  stdout?: string
  stderr?: string
  exit_code?: number
  error?: string
  message?: string
}

// Internal service types - not exposed via GraphQL
export interface InternalPackageInfo {
  name: string
  version: string
  description?: string
  installed: boolean
  publisher?: string
  source?: string
}

export interface InternalPackageManagementResult {
  success: boolean
  message: string
  packages?: InternalPackageInfo[]
  stdout?: string
  stderr?: string
  error?: string
}

export enum PackageAction {
  INSTALL = 'INSTALL',
  REMOVE = 'REMOVE',
  UPDATE = 'UPDATE'
}

export class DirectPackageManager {
  private prisma: PrismaClient
  private virtioService: VirtioSocketWatcherService
  private debug: Debugger

  constructor (prisma: PrismaClient, virtioService: VirtioSocketWatcherService) {
    this.prisma = prisma
    this.virtioService = virtioService
    this.debug = new Debugger('infinibay:package-manager')
  }

  /**
   * List installed packages on a VM
   */
  async listPackages (machineId: string): Promise<InternalPackageInfo[]> {
    try {
      // Verify machine exists and get its info
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, os: true, status: true }
      })

      if (!machine) {
        throw new Error(`Machine ${machineId} not found`)
      }

      if (machine.status !== 'running') {
        throw new Error(`Machine ${machine.name} is not running`)
      }

      this.debug.log('info', `Listing packages for VM ${machineId} (${machine.name})`)

      // Implement retry logic with exponential backoff
      const maxRetries = 3
      let lastError: Error | null = null
      let response: InfiniServiceResponse | null = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Check if VM is connected before attempting command
          if (!this.virtioService.isVmConnected(machineId)) {
            this.debug.log('warn', `VM ${machineId} is not connected, waiting for connection...`)
            // Wait a bit for connection to establish
            await new Promise(resolve => setTimeout(resolve, 2000))

            // Check again after wait
            if (!this.virtioService.isVmConnected(machineId)) {
              throw new Error('VM is not connected. Please ensure the VM agent is running.')
            }
          }

          // Increase timeout for each retry: 15s, 30s, 45s
          const timeout = 15000 * attempt

          this.debug.log('info', `Package list attempt ${attempt}/${maxRetries} with timeout ${timeout}ms`)

          // Send package list command to InfiniService
          const cmdResponse = await this.virtioService.sendPackageCommand(
            machineId,
            'PackageList',
            undefined,
            timeout
          )
          // Convert CommandResponse to InfiniServiceResponse format
          response = {
            success: cmdResponse.success,
            data: cmdResponse.data as InfiniServicePackageData,
            stdout: cmdResponse.stdout,
            stderr: cmdResponse.stderr,
            exit_code: cmdResponse.exit_code,
            error: cmdResponse.error
          }

          if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to list packages')
          }

          // Success - break out of retry loop
          lastError = null
          break
        } catch (error) {
          lastError = error as Error
          this.debug.log('warn', `Package list attempt ${attempt} failed: ${error}`)

          // Check if it's a connection error or timeout
          const errorStr = String(error)
          const isConnectionError = errorStr.includes('closed') || errorStr.includes('not connected') || errorStr.includes('No connection')
          const isTimeoutError = errorStr.includes('timeout')

          // Don't retry if it's not a retryable error or if this was the last attempt
          if (attempt === maxRetries || (!isTimeoutError && !isConnectionError)) {
            break
          }

          // Wait before retry (exponential backoff)
          const waitTime = isConnectionError ? 3000 * attempt : 1000 * attempt
          this.debug.log('info', `Waiting ${waitTime}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }

      if (lastError) {
        throw lastError
      }

      if (!response || !response.success) {
        throw new Error('Failed to list packages after all retries')
      }

      // Parse response data into PackageInfo array
      const packages = this.parsePackageList(response.data, machine.os)

      this.debug.log('info', `Found ${packages.length} packages on VM ${machineId}`)
      return packages
    } catch (error) {
      this.debug.log('error', `Failed to list packages for VM ${machineId}: ${error}`)
      throw error
    }
  }

  /**
   * Install a package on a VM
   */
  async installPackage (machineId: string, packageName: string): Promise<InternalPackageManagementResult> {
    try {
      // Verify machine exists
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, os: true, status: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Machine ${machineId} not found`,
          error: 'Machine not found'
        }
      }

      if (machine.status !== 'running') {
        return {
          success: false,
          message: `Machine ${machine.name} is not running`,
          error: 'Machine not running'
        }
      }

      this.debug.log('info', `Installing package ${packageName} on VM ${machineId} (${machine.name})`)

      // Send install command to InfiniService
      const response = await this.virtioService.sendPackageCommand(
        machineId,
        'PackageInstall',
        packageName,
        120000 // 2 minute timeout for installation
      )

      return {
        success: response.success,
        message: response.success
          ? `Package ${packageName} installed successfully`
          : `Failed to install package ${packageName}`,
        stdout: response.stdout,
        stderr: response.stderr,
        error: response.error
      }
    } catch (error) {
      this.debug.log('error', `Failed to install package ${packageName} on VM ${machineId}: ${error}`)
      return {
        success: false,
        message: `Failed to install package: ${error}`,
        error: String(error)
      }
    }
  }

  /**
   * Remove a package from a VM
   */
  async removePackage (machineId: string, packageName: string): Promise<InternalPackageManagementResult> {
    try {
      // Verify machine exists
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, os: true, status: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Machine ${machineId} not found`,
          error: 'Machine not found'
        }
      }

      if (machine.status !== 'running') {
        return {
          success: false,
          message: `Machine ${machine.name} is not running`,
          error: 'Machine not running'
        }
      }

      this.debug.log('info', `Removing package ${packageName} from VM ${machineId} (${machine.name})`)

      // Send remove command to InfiniService
      const response = await this.virtioService.sendPackageCommand(
        machineId,
        'PackageRemove',
        packageName,
        60000 // 1 minute timeout
      )

      return {
        success: response.success,
        message: response.success
          ? `Package ${packageName} removed successfully`
          : `Failed to remove package ${packageName}`,
        stdout: response.stdout,
        stderr: response.stderr,
        error: response.error
      }
    } catch (error) {
      this.debug.log('error', `Failed to remove package ${packageName} from VM ${machineId}: ${error}`)
      return {
        success: false,
        message: `Failed to remove package: ${error}`,
        error: String(error)
      }
    }
  }

  /**
   * Update a package on a VM
   */
  async updatePackage (machineId: string, packageName: string): Promise<InternalPackageManagementResult> {
    try {
      // Verify machine exists
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, os: true, status: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Machine ${machineId} not found`,
          error: 'Machine not found'
        }
      }

      if (machine.status !== 'running') {
        return {
          success: false,
          message: `Machine ${machine.name} is not running`,
          error: 'Machine not running'
        }
      }

      this.debug.log('info', `Updating package ${packageName} on VM ${machineId} (${machine.name})`)

      // Send update command to InfiniService
      const response = await this.virtioService.sendPackageCommand(
        machineId,
        'PackageUpdate',
        packageName,
        120000 // 2 minute timeout for update
      )

      return {
        success: response.success,
        message: response.success
          ? `Package ${packageName} updated successfully`
          : `Failed to update package ${packageName}`,
        stdout: response.stdout,
        stderr: response.stderr,
        error: response.error
      }
    } catch (error) {
      this.debug.log('error', `Failed to update package ${packageName} on VM ${machineId}: ${error}`)
      return {
        success: false,
        message: `Failed to update package: ${error}`,
        error: String(error)
      }
    }
  }

  /**
   * Search for available packages on a VM
   */
  async searchPackages (machineId: string, query: string): Promise<InternalPackageInfo[]> {
    try {
      // Verify machine exists
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true, os: true, status: true }
      })

      if (!machine) {
        throw new Error(`Machine ${machineId} not found`)
      }

      if (machine.status !== 'running') {
        throw new Error(`Machine ${machine.name} is not running`)
      }

      this.debug.log('info', `Searching packages for query "${query}" on VM ${machineId}`)

      // Implement retry logic with exponential backoff
      const maxRetries = 3
      let lastError: Error | null = null
      let response: InfiniServiceResponse | null = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Check if VM is connected before attempting command
          if (!this.virtioService.isVmConnected(machineId)) {
            this.debug.log('warn', `VM ${machineId} is not connected, waiting for connection...`)
            // Wait a bit for connection to establish
            await new Promise(resolve => setTimeout(resolve, 2000))

            // Check again after wait
            if (!this.virtioService.isVmConnected(machineId)) {
              throw new Error('VM is not connected. Please ensure the VM agent is running.')
            }
          }

          // Increase timeout for each retry: 15s, 30s, 45s
          const timeout = 15000 * attempt

          this.debug.log('info', `Package search attempt ${attempt}/${maxRetries} with timeout ${timeout}ms`)

          // Send search command to InfiniService
          const cmdResponse = await this.virtioService.sendPackageCommand(
            machineId,
            'PackageSearch',
            query,
            timeout
          )
          // Convert CommandResponse to InfiniServiceResponse format
          response = {
            success: cmdResponse.success,
            data: cmdResponse.data as InfiniServicePackageData,
            stdout: cmdResponse.stdout,
            stderr: cmdResponse.stderr,
            exit_code: cmdResponse.exit_code,
            error: cmdResponse.error
          }

          if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to search packages')
          }

          // Success - break out of retry loop
          lastError = null
          break
        } catch (error) {
          lastError = error as Error
          this.debug.log('warn', `Package search attempt ${attempt} failed: ${error}`)

          // Check if it's a connection error or timeout
          const errorStr = String(error)
          const isConnectionError = errorStr.includes('closed') || errorStr.includes('not connected') || errorStr.includes('No connection')
          const isTimeoutError = errorStr.includes('timeout')

          // Don't retry if it's not a retryable error or if this was the last attempt
          if (attempt === maxRetries || (!isTimeoutError && !isConnectionError)) {
            break
          }

          // Wait before retry (exponential backoff)
          const waitTime = isConnectionError ? 3000 * attempt : 1000 * attempt
          this.debug.log('info', `Waiting ${waitTime}ms before retry...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }

      if (lastError) {
        throw lastError
      }

      if (!response || !response.success) {
        throw new Error('Failed to search packages after all retries')
      }

      // Parse response data into PackageInfo array
      const packages = this.parsePackageList(response.data, machine.os)

      this.debug.log('info', `Found ${packages.length} packages matching "${query}" on VM ${machineId}`)
      return packages
    } catch (error) {
      this.debug.log('error', `Failed to search packages on VM ${machineId}: ${error}`)
      throw error
    }
  }

  /**
   * Manage a package with a specific action
   */
  async managePackage (
    machineId: string,
    packageName: string,
    action: PackageAction
  ): Promise<InternalPackageManagementResult> {
    switch (action) {
    case PackageAction.INSTALL:
      return this.installPackage(machineId, packageName)
    case PackageAction.REMOVE:
      return this.removePackage(machineId, packageName)
    case PackageAction.UPDATE:
      return this.updatePackage(machineId, packageName)
    default:
      return {
        success: false,
        message: `Unknown action: ${action}`,
        error: 'Invalid action'
      }
    }
  }

  /**
   * Parse package list from InfiniService response
   * The response format varies by OS and package manager
   */
  private parsePackageList (data: InfiniServicePackageData | undefined, _os: string | null): InternalPackageInfo[] {
    if (!data || !data.packages) {
      return []
    }

    // InfiniService returns data with PascalCase field names (Name, Version, Id, etc.)
    // We need to map them to our internal format
    const packages: InternalPackageInfo[] = []

    for (const pkg of data.packages) {
      // Handle both lowercase (old format) and PascalCase (new InfiniService format)
      packages.push({
        name: pkg.Name || pkg.name || '',
        version: pkg.Version || pkg.version || '',
        description: pkg.Description || pkg.description || pkg.Source || pkg.source,
        installed: pkg.Installed !== undefined ? pkg.Installed : (pkg.installed !== undefined ? pkg.installed : false),
        publisher: pkg.Publisher || pkg.publisher || pkg.vendor,
        source: pkg.Source || pkg.source || pkg.repository
      })
    }

    return packages
  }
}

// Export singleton getter
let directPackageManager: DirectPackageManager | null = null

export const getDirectPackageManager = (
  prisma: PrismaClient,
  virtioService: VirtioSocketWatcherService
): DirectPackageManager => {
  if (!directPackageManager) {
    directPackageManager = new DirectPackageManager(prisma, virtioService)
  }
  return directPackageManager
}
