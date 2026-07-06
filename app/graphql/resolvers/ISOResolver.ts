import logger from '@main/logger'
import { Resolver, Query, Mutation, Arg, Ctx } from 'type-graphql'
import { ISO, ISOStatus, SystemReadiness, ISOAvailabilityMap, IsoDownloadStatus } from '../types/ISOType'
import ISOService from '@services/ISOService'
import IsoDownloadService from '@services/IsoDownloadService'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { Can } from '@main/permissions'

@Resolver()
export class ISOResolver {
  private isoService: ISOService

  constructor () {
    this.isoService = ISOService.getInstance()
  }

  @Query(() => [String], { description: 'OS ids that can be auto-downloaded (Linux net/desktop images)' })
  @Can('iso:view')
  async autoDownloadableOSes (): Promise<string[]> {
    return IsoDownloadService.downloadableOsIds()
  }

  @Mutation(() => Boolean, { description: 'Start auto-downloading the latest official ISO for an OS. Poll isoDownloadStatus (or listen to iso:download:* over Socket.IO) for progress.' })
  @Can('iso:create')
  async startOSIsoDownload (
    @Arg('os') os: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    // Fire-and-forget: throws synchronously only for "cannot start" cases
    // (unknown/undownloadable OS, already running).
    return IsoDownloadService.getInstance().start(os, context.prisma, context.user?.id)
  }

  @Query(() => IsoDownloadStatus, { description: 'Live status of an auto-download (poll this for progress; socket-independent).' })
  @Can('iso:view')
  async isoDownloadStatus (
    @Arg('os') os: string
  ): Promise<IsoDownloadStatus> {
    const s = IsoDownloadService.getInstance().getStatus(os)
    return s
      ? { os: s.os, state: s.state, receivedBytes: s.receivedBytes, totalBytes: s.totalBytes, error: s.error ?? null }
      : { os: os.toLowerCase(), state: 'idle', receivedBytes: 0, totalBytes: 0, error: null }
  }

  @Mutation(() => Boolean, { description: 'Cancel an in-progress ISO auto-download. Returns true if one was aborted.' })
  @Can('iso:create')
  async cancelOSIsoDownload (
    @Arg('os') os: string
  ): Promise<boolean> {
    return IsoDownloadService.getInstance().cancel(os)
  }

  @Query(() => [ISO], { description: 'Get all available ISOs' })
  @Can('iso:view')
  async availableISOs (): Promise<ISO[]> {
    try {
      // First sync with filesystem
      await this.isoService.syncISOsWithFileSystem()

      const isos = await this.isoService.getAvailableISOs()

      // Convert BigInt to string for GraphQL and handle nulls
      return isos.map(iso => ({
        ...iso,
        size: iso.size.toString(),
        version: iso.version || undefined,
        checksum: iso.checksum || undefined,
        downloadUrl: iso.downloadUrl || undefined,
        lastVerified: iso.lastVerified || undefined
      }))
    } catch (error) {
      logger.error('Error fetching available ISOs:', error)
      throw new Error('Failed to fetch available ISOs')
    }
  }

  @Query(() => ISOStatus, { description: 'Check if ISO is available for specific OS' })
  @Can('iso:view')
  async checkISOStatus (
    @Arg('os') os: string
  ): Promise<ISOStatus> {
    try {
      const status = await this.isoService.checkISOForOS(os)

      if (status.iso) {
        return {
          os: status.os,
          available: status.available,
          iso: {
            ...status.iso,
            size: status.iso.size.toString(),
            version: status.iso.version || undefined,
            checksum: status.iso.checksum || undefined,
            downloadUrl: status.iso.downloadUrl || undefined,
            lastVerified: status.iso.lastVerified || undefined
          }
        }
      }

      return {
        os: status.os,
        available: status.available,
        iso: undefined
      }
    } catch (error) {
      logger.error('Error checking ISO status:', error)
      throw new Error('Failed to check ISO status')
    }
  }

  @Query(() => SystemReadiness, { description: 'Check overall system readiness' })
  @Can('iso:view')
  async checkSystemReadiness (): Promise<SystemReadiness> {
    try {
      // Sync ISOs first
      await this.isoService.syncISOsWithFileSystem()

      return await this.isoService.getSystemReadiness()
    } catch (error) {
      logger.error('Error checking system readiness:', error)
      throw new Error('Failed to check system readiness')
    }
  }

  @Query(() => [ISOAvailabilityMap], { description: 'Check availability for multiple OS types' })
  @Can('iso:view')
  async checkMultipleOSAvailability (
    @Arg('osList', () => [String]) osList: string[]
  ): Promise<ISOAvailabilityMap[]> {
    try {
      const availabilityMap = await this.isoService.checkMultipleOSAvailability(osList)

      const result: ISOAvailabilityMap[] = []
      availabilityMap.forEach((available, os) => {
        result.push({ os, available })
      })

      return result
    } catch (error) {
      logger.error('Error checking OS availability:', error)
      throw new Error('Failed to check OS availability')
    }
  }

  @Query(() => [ISO], { description: 'Get all ISOs (available and unavailable)' })
  @Can('iso:view')
  async allISOs (): Promise<ISO[]> {
    try {
      await this.isoService.syncISOsWithFileSystem()

      const { available, unavailable } = await this.isoService.getISOsByAvailability()
      const all = [...available, ...unavailable]

      return all.map(iso => ({
        ...iso,
        size: iso.size.toString(),
        version: iso.version || undefined,
        checksum: iso.checksum || undefined,
        downloadUrl: iso.downloadUrl || undefined,
        lastVerified: iso.lastVerified || undefined
      }))
    } catch (error) {
      logger.error('Error fetching all ISOs:', error)
      throw new Error('Failed to fetch all ISOs')
    }
  }

  @Query(() => [String], { description: 'Get supported OS types' })
  @Can('iso:view')
  getSupportedOSTypes (): string[] {
    return this.isoService.getSupportedOSTypes()
  }

  @Mutation(() => Boolean, { description: 'Validate ISO file integrity' })
  @Can('iso:execute')
  async validateISO (
    @Arg('isoId') isoId: string
  ): Promise<boolean> {
    try {
      return await this.isoService.validateISO(isoId)
    } catch (error) {
      logger.error('Error validating ISO:', error)
      throw new UserInputError('Failed to validate ISO')
    }
  }

  @Mutation(() => String, { description: 'Calculate ISO checksum' })
  @Can('iso:execute')
  async calculateISOChecksum (
    @Arg('isoId') isoId: string
  ): Promise<string> {
    try {
      return await this.isoService.calculateChecksum(isoId)
    } catch (error) {
      logger.error('Error calculating checksum:', error)
      throw new UserInputError('Failed to calculate checksum')
    }
  }

  @Mutation(() => Boolean, { description: 'Remove ISO file' })
  @Can('iso:delete')
  async removeISO (
    @Arg('isoId') isoId: string
  ): Promise<boolean> {
    try {
      await this.isoService.removeISO(isoId)
      return true
    } catch (error) {
      logger.error('Error removing ISO:', error)
      throw new UserInputError('Failed to remove ISO')
    }
  }

  @Mutation(() => Boolean, { description: 'Sync ISOs with filesystem' })
  @Can('iso:execute')
  async syncISOs (): Promise<boolean> {
    try {
      await this.isoService.syncISOsWithFileSystem()
      return true
    } catch (error) {
      logger.error('Error syncing ISOs:', error)
      throw new Error('Failed to sync ISOs')
    }
  }

  @Mutation(() => ISO, { description: 'Register uploaded ISO' })
  @Can('iso:create')
  async registerISO (
    @Arg('filename') filename: string,
    @Arg('os') os: string,
    @Arg('size') size: number,
    @Arg('path') path: string
  ): Promise<ISO> {
    // Validate metadata before persisting. Kept outside the try/catch so these
    // specific messages surface instead of being masked by the generic failure.
    const supportedOS = this.isoService.getSupportedOSTypes()
    if (!supportedOS.includes(os.toUpperCase())) {
      throw new UserInputError(`Unsupported OS: ${os}`)
    }
    if (!Number.isInteger(size) || size < 0) {
      throw new UserInputError('size must be a non-negative integer')
    }

    try {
      // `path` is deliberately not trusted here: ISOService derives the real,
      // confined on-disk location from the filename (see ISOService.registerISO).
      const iso = await this.isoService.registerISO(filename, os, size, path)

      return {
        ...iso,
        size: iso.size.toString(),
        version: iso.version || undefined,
        checksum: iso.checksum || undefined,
        downloadUrl: iso.downloadUrl || undefined,
        lastVerified: iso.lastVerified || undefined
      }
    } catch (error) {
      logger.error('Error registering ISO:', error)
      throw new UserInputError('Failed to register ISO')
    }
  }
}
