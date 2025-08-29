import { Resolver, Query, Mutation, Arg, Authorized } from 'type-graphql'
import { ISO, ISOStatus, SystemReadiness, ISOAvailabilityMap } from '../types/ISOType'
import ISOService from '@services/ISOService'
import { UserInputError } from 'apollo-server-express'

@Resolver()
export class ISOResolver {
  private isoService: ISOService

  constructor () {
    this.isoService = ISOService.getInstance()
  }

  @Query(() => [ISO], { description: 'Get all available ISOs' })
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
      console.error('Error fetching available ISOs:', error)
      throw new Error('Failed to fetch available ISOs')
    }
  }

  @Query(() => ISOStatus, { description: 'Check if ISO is available for specific OS' })
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
      console.error('Error checking ISO status:', error)
      throw new Error('Failed to check ISO status')
    }
  }

  @Query(() => SystemReadiness, { description: 'Check overall system readiness' })
  async checkSystemReadiness (): Promise<SystemReadiness> {
    try {
      // Sync ISOs first
      await this.isoService.syncISOsWithFileSystem()

      return await this.isoService.getSystemReadiness()
    } catch (error) {
      console.error('Error checking system readiness:', error)
      throw new Error('Failed to check system readiness')
    }
  }

  @Query(() => [ISOAvailabilityMap], { description: 'Check availability for multiple OS types' })
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
      console.error('Error checking OS availability:', error)
      throw new Error('Failed to check OS availability')
    }
  }

  @Query(() => [ISO], { description: 'Get all ISOs (available and unavailable)' })
  @Authorized(['ADMIN'])
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
      console.error('Error fetching all ISOs:', error)
      throw new Error('Failed to fetch all ISOs')
    }
  }

  @Query(() => [String], { description: 'Get supported OS types' })
  getSupportedOSTypes (): string[] {
    return this.isoService.getSupportedOSTypes()
  }

  @Mutation(() => Boolean, { description: 'Validate ISO file integrity' })
  @Authorized(['ADMIN'])
  async validateISO (
    @Arg('isoId') isoId: string
  ): Promise<boolean> {
    try {
      return await this.isoService.validateISO(isoId)
    } catch (error) {
      console.error('Error validating ISO:', error)
      throw new UserInputError('Failed to validate ISO')
    }
  }

  @Mutation(() => String, { description: 'Calculate ISO checksum' })
  @Authorized(['ADMIN'])
  async calculateISOChecksum (
    @Arg('isoId') isoId: string
  ): Promise<string> {
    try {
      return await this.isoService.calculateChecksum(isoId)
    } catch (error) {
      console.error('Error calculating checksum:', error)
      throw new UserInputError('Failed to calculate checksum')
    }
  }

  @Mutation(() => Boolean, { description: 'Remove ISO file' })
  @Authorized(['ADMIN'])
  async removeISO (
    @Arg('isoId') isoId: string
  ): Promise<boolean> {
    try {
      await this.isoService.removeISO(isoId)
      return true
    } catch (error) {
      console.error('Error removing ISO:', error)
      throw new UserInputError('Failed to remove ISO')
    }
  }

  @Mutation(() => Boolean, { description: 'Sync ISOs with filesystem' })
  @Authorized(['ADMIN'])
  async syncISOs (): Promise<boolean> {
    try {
      await this.isoService.syncISOsWithFileSystem()
      return true
    } catch (error) {
      console.error('Error syncing ISOs:', error)
      throw new Error('Failed to sync ISOs')
    }
  }

  @Mutation(() => ISO, { description: 'Register uploaded ISO' })
  @Authorized(['ADMIN'])
  async registerISO (
    @Arg('filename') filename: string,
    @Arg('os') os: string,
    @Arg('size') size: number,
    @Arg('path') path: string
  ): Promise<ISO> {
    try {
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
      console.error('Error registering ISO:', error)
      throw new UserInputError('Failed to register ISO')
    }
  }
}
