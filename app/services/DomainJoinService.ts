/**
 * DomainJoinService — joins a running VM to an Active Directory / LDAP domain
 * via the in-VM agent (infiniservice JoinDomain command).
 *
 * The domain and (by default) the credentials come from a configured
 * IdentityProvider; the caller may override the join account. Join state is
 * persisted on the VM's MachineConfiguration so the UI can show it.
 *
 * This is the only backend code that issues the JoinDomain virtio command,
 * mirroring how GoldenImageService owns PrepareGoldenImage.
 */

import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { getVirtioSocketWatcherService } from './VirtioSocketWatcherService'
import type { SafeCommandType } from './VirtioSocketWatcherService'
import { VMOperationsService } from './VMOperationsService'
import { decryptSecret } from './identity/IdentityProviderService'
import { getEventManager } from './EventManager'

const JOIN_COMMAND_TIMEOUT_MS = 5 * 60 * 1000 // realm/Add-Computer + package install can be slow

export interface JoinDomainParams {
  machineId: string
  identityProviderId: string
  /** Override join account; defaults to the provider's bindDn. */
  username?: string
  /** Override join password; defaults to the provider's stored bind secret. */
  password?: string
  /** Optional OU/container DN to place the computer object in. */
  ou?: string
  /** Optional explicit computer name for the directory object. */
  computerName?: string
  /** Reboot the guest after a successful join. */
  restartAfter?: boolean
  triggeredBy?: string
}

export interface DomainJoinResult {
  success: boolean
  message?: string
  domain?: string
  error?: string
}

export class DomainJoinService {
  constructor (private readonly prisma: PrismaClient) {}

  async joinMachineToDomain (params: JoinDomainParams): Promise<DomainJoinResult> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: params.machineId },
      include: { configuration: true }
    })
    if (!machine || !machine.configuration) {
      return { success: false, error: 'VM not found' }
    }
    if (!machine.configuration.setupComplete) {
      return { success: false, error: 'VM has not finished initial setup yet' }
    }
    // A PENDING status means this same method already started a join for this VM.
    if (machine.configuration.domainJoinStatus === 'PENDING') {
      return { success: false, error: 'A domain join is already in progress for this VM' }
    }

    // The agent must be reachable, which requires the VM to be running.
    const vmOps = new VMOperationsService(this.prisma)
    try {
      const status = await vmOps.getStatus(params.machineId)
      if (!status?.processAlive) {
        return { success: false, error: 'Start the VM before joining it to a domain' }
      }
    } finally {
      await vmOps.close().catch(() => {})
    }

    const provider = await this.prisma.identityProvider.findUnique({
      where: { id: params.identityProviderId }
    })
    if (!provider) {
      return { success: false, error: 'Identity provider not found' }
    }
    const domain = provider.domain?.trim()
    if (!domain) {
      return { success: false, error: 'Selected identity provider has no domain configured' }
    }

    const username = (params.username?.trim()) || provider.bindDn?.trim()
    if (!username) {
      return { success: false, error: 'No join account: provide a username or configure a Bind DN on the provider' }
    }

    let password = params.password
    if (!password) {
      if (!provider.bindPasswordSecret) {
        return { success: false, error: 'No join password: provide one or store a bind password on the provider' }
      }
      try {
        password = decryptSecret(provider.bindPasswordSecret)
      } catch (err) {
        logger.error(`domain-join: failed to decrypt bind secret for provider ${provider.id}: ${err instanceof Error ? err.message : String(err)}`)
        return { success: false, error: 'Could not read the stored bind password' }
      }
    }

    // Mark PENDING up-front so the UI reflects the in-flight join.
    await this.persistState(params.machineId, {
      domainJoinStatus: 'PENDING',
      domainName: domain,
      domainIdentityProviderId: provider.id,
      domainJoinError: null
    })
    this.emitUpdate(params.machineId)

    const command: SafeCommandType = {
      action: 'JoinDomain',
      domain,
      username,
      password,
      ou: params.ou?.trim() || undefined,
      computer_name: params.computerName?.trim() || undefined,
      restart_after: params.restartAfter ?? false
    }

    try {
      const virtio = getVirtioSocketWatcherService()
      const response = await virtio.sendSafeCommand(params.machineId, command, JOIN_COMMAND_TIMEOUT_MS)
      if (!response.success) {
        const error = response.error || response.stderr || 'Domain join failed'
        await this.persistFinalState(params.machineId, {
          domainJoinStatus: 'FAILED',
          domainJoinError: error
        })
        this.emitUpdate(params.machineId)
        return { success: false, error, domain }
      }

      await this.persistFinalState(params.machineId, {
        domainJoinStatus: 'JOINED',
        domainJoinedAt: new Date(),
        domainJoinError: null
      })
      this.emitUpdate(params.machineId)
      return { success: true, message: `Joined ${domain}`, domain }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.error(`domain-join failed for VM ${params.machineId}: ${error}`)
      await this.persistFinalState(params.machineId, {
        domainJoinStatus: 'FAILED',
        domainJoinError: error
      })
      this.emitUpdate(params.machineId)
      return { success: false, error, domain }
    }
  }

  /**
   * Persist a terminal status (JOINED/FAILED). Unlike the best-effort PENDING
   * write, a lost terminal status is operationally serious, so persistState
   * logs at error level and rethrows; we catch here so the join still returns
   * its real outcome, but the error is loud enough for operators to detect.
   */
  private async persistFinalState (
    machineId: string,
    data: {
      domainJoinStatus?: string
      domainJoinedAt?: Date
      domainJoinError?: string | null
    }
  ): Promise<void> {
    try {
      await this.persistState(machineId, data, true)
    } catch {
      // Already logged at error level inside persistState.
    }
  }

  private async persistState (
    machineId: string,
    data: {
      domainJoinStatus?: string
      domainName?: string
      domainJoinedAt?: Date
      domainJoinError?: string | null
      domainIdentityProviderId?: string
    },
    // Terminal state writes (JOINED/FAILED) must not be silently lost: log at
    // error level and rethrow so the caller/operators can detect the failure.
    terminal = false
  ): Promise<void> {
    try {
      await this.prisma.machineConfiguration.update({
        where: { machineId },
        data
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (terminal) {
        logger.error(`domain-join: FAILED to persist terminal state '${data.domainJoinStatus}' for VM ${machineId}: ${message}`)
        throw err
      }
      logger.warn(`domain-join: could not persist state for VM ${machineId}: ${message}`)
    }
  }

  private emitUpdate (machineId: string): void {
    void (async () => {
      try {
        const updated = await this.prisma.machine.findUnique({
          where: { id: machineId },
          include: { configuration: true, department: true, template: true, user: true }
        })
        if (updated) {
          await getEventManager().dispatchEvent('vms', 'update', updated, updated.userId ?? undefined)
        }
      } catch (err) {
        logger.warn(`domain-join: event dispatch failed for VM ${machineId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
  }
}
