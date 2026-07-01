import logger from '@main/logger'
import { PrismaClient, ISO } from '@prisma/client'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import { ISOEventManager } from './EventManagers/ISOEventManager'

const prisma = new PrismaClient()

export interface ISOStatus {
  os: string;
  available: boolean;
  iso?: ISO;
}

export class ISOService {
  private static instance: ISOService
  private eventManager: ISOEventManager
  private isoBasePath: string

  private constructor () {
    this.eventManager = ISOEventManager.getInstance()
    this.isoBasePath = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'iso')
  }

  public static getInstance (): ISOService {
    if (!ISOService.instance) {
      ISOService.instance = new ISOService()
    }
    return ISOService.instance
  }

  /**
   * Scan the ISO directory and sync with database
   */
  public async syncISOsWithFileSystem (): Promise<void> {
    try {
      // Ensure ISO directory exists
      await fs.mkdir(this.isoBasePath, { recursive: true })

      // Get all ISO files from filesystem
      const files = await fs.readdir(this.isoBasePath)
      const isoFiles = files.filter(file => file.endsWith('.iso'))

      for (const filename of isoFiles) {
        const filePath = path.join(this.isoBasePath, filename)
        const stats = await fs.stat(filePath)

        // Extract OS type from filename (e.g., windows10.iso -> WINDOWS10)
        const osType = this.extractOSType(filename)

        if (osType) {
          // Upsert atomically — multiple callers may race on the same filename
          // (e.g. syncISOsWithFileSystem + getAvailableISOs hitting checkSystemReadiness),
          // and a findUnique→create pattern would trip the unique constraint.
          const size = BigInt(stats.size)
          const result = await prisma.iSO.upsert({
            where: { filename },
            create: {
              filename,
              os: osType,
              size,
              path: filePath,
              isAvailable: true,
              lastVerified: new Date()
            },
            update: {
              lastVerified: new Date(),
              isAvailable: true,
              size
            }
          })
          // Emit registered event only when the row was newly inserted.
          // On a fresh insert createdAt === updatedAt; on update, updatedAt advances.
          if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            this.eventManager.emitISORegistered(result)
          }
        }
      }

      // Mark ISOs as unavailable if file doesn't exist
      const dbISOs = await prisma.iSO.findMany()
      for (const iso of dbISOs) {
        try {
          await fs.access(iso.path)
        } catch {
          await prisma.iSO.update({
            where: { id: iso.id },
            data: { isAvailable: false }
          })
        }
      }
    } catch (error) {
      logger.error('Error syncing ISOs with filesystem:', error)
      throw error
    }
  }

  /**
   * Get all available ISOs
   */
  public async getAvailableISOs (): Promise<ISO[]> {
    return prisma.iSO.findMany({
      where: { isAvailable: true },
      orderBy: { os: 'asc' }
    })
  }

  /**
   * Check if ISO exists for specific OS
   */
  public async checkISOForOS (os: string): Promise<ISOStatus> {
    const iso = await prisma.iSO.findFirst({
      where: {
        os: os.toUpperCase(),
        isAvailable: true
      }
    })

    return {
      os: os.toUpperCase(),
      available: !!iso,
      iso: iso || undefined
    }
  }

  /**
   * Get system readiness status
   */
  public async getSystemReadiness (): Promise<{
    ready: boolean;
    availableOS: string[];
    missingOS: string[];
  }> {
    const supportedOS = ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA']
    const availableISOs = await this.getAvailableISOs()
    const availableOS = availableISOs.map(iso => iso.os)
    const missingOS = supportedOS.filter(os => !availableOS.includes(os))

    return {
      ready: availableOS.length > 0,
      availableOS,
      missingOS
    }
  }

  /**
   * Validate ISO file integrity
   */
  public async validateISO (isoId: string): Promise<boolean> {
    try {
      const iso = await prisma.iSO.findUnique({
        where: { id: isoId }
      })

      if (!iso) {
        throw new Error('ISO not found')
      }

      // Check if file exists
      await fs.access(iso.path)

      // Verify file size
      const stats = await fs.stat(iso.path)
      if (BigInt(stats.size) !== iso.size) {
        await prisma.iSO.update({
          where: { id: isoId },
          data: { isAvailable: false }
        })
        return false
      }

      // Update validation timestamp
      await prisma.iSO.update({
        where: { id: isoId },
        data: {
          lastVerified: new Date(),
          isAvailable: true
        }
      })

      return true
    } catch (error) {
      logger.error('ISO validation failed:', error)
      return false
    }
  }

  /**
   * Calculate checksum for ISO file
   */
  public async calculateChecksum (isoId: string): Promise<string> {
    const iso = await prisma.iSO.findUnique({
      where: { id: isoId }
    })

    if (!iso) {
      throw new Error('ISO not found')
    }

    const hash = crypto.createHash('sha256')
    const stream = await fs.readFile(iso.path)
    hash.update(stream)
    const checksum = hash.digest('hex')

    // Update checksum in database
    await prisma.iSO.update({
      where: { id: isoId },
      data: { checksum }
    })

    return checksum
  }

  /**
   * Register ISO after upload
   */
  public async registerISO (
    filename: string,
    os: string,
    size: number,
    filePath: string
  ): Promise<ISO> {
    // Check if ISO already exists
    const existing = await prisma.iSO.findUnique({
      where: { filename }
    })

    if (existing) {
      // Update existing ISO
      return prisma.iSO.update({
        where: { id: existing.id },
        data: {
          size: BigInt(size),
          path: filePath,
          isAvailable: true,
          lastVerified: new Date()
        }
      })
    }

    // Create new ISO record
    const iso = await prisma.iSO.create({
      data: {
        filename,
        os: os.toUpperCase(),
        size: BigInt(size),
        path: filePath,
        isAvailable: true,
        lastVerified: new Date()
      }
    })

    // Emit ISO registered event
    this.eventManager.emitISORegistered(iso)

    return iso
  }

  /**
   * Remove ISO
   */
  public async removeISO (isoId: string): Promise<void> {
    const iso = await prisma.iSO.findUnique({
      where: { id: isoId }
    })

    if (!iso) {
      throw new Error('ISO not found')
    }

    // Delete file from filesystem
    try {
      await fs.unlink(iso.path)
    } catch (error) {
      logger.error('Failed to delete ISO file:', error)
    }

    // Delete from database
    await prisma.iSO.delete({
      where: { id: isoId }
    })

    // Emit ISO removed event
    this.eventManager.emitISORemoved(isoId, iso.filename)
  }

  /**
   * Get ISOs grouped by availability
   */
  public async getISOsByAvailability (): Promise<{
    available: ISO[];
    unavailable: ISO[];
  }> {
    const all = await prisma.iSO.findMany({
      orderBy: { os: 'asc' }
    })

    return {
      available: all.filter(iso => iso.isAvailable),
      unavailable: all.filter(iso => !iso.isAvailable)
    }
  }

  /**
   * Extract OS type from a real-world ISO filename.
   *
   * Matches SUBSTRINGS/patterns, not exact canonical names: downloaded ISOs are
   * named like `ubuntu-24.04.4-live-server-amd64.iso` or
   * `Fedora-Server-netinst-x86_64-42-1.1.iso`, never `ubuntu.iso`. The old exact
   * lookup (`osMapping[name]`) returned null for every real ISO, so the
   * filesystem sync silently registered nothing and the UI reported "no ISO"
   * even with valid ISOs present — while CreateMachineServiceV2.getOSIsoPath
   * (which globs `ubuntu-*.iso`) would happily boot them. This aligns the two.
   *
   * Windows is matched by (win|windows) + version digits so a driver ISO like
   * `virtio-win.iso` (contains "win" but no "10"/"11") never mis-maps to Windows.
   * Order matters: the more specific Windows tokens are tested before the
   * distro substrings.
   */
  private extractOSType (filename: string): string | null {
    const name = filename.toLowerCase()

    if (/(?:windows|win)[ ._-]*11/.test(name)) return 'WINDOWS11'
    if (/(?:windows|win)[ ._-]*10/.test(name)) return 'WINDOWS10'
    if (name.includes('ubuntu')) return 'UBUNTU'
    if (name.includes('fedora')) return 'FEDORA'

    return null
  }

  /**
   * Get all supported OS types
   */
  public getSupportedOSTypes (): string[] {
    return ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA']
  }

  /**
   * Check multiple OS availability at once
   */
  public async checkMultipleOSAvailability (osList: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>()
    const availableISOs = await this.getAvailableISOs()
    const availableOS = new Set(availableISOs.map(iso => iso.os))

    for (const os of osList) {
      result.set(os.toUpperCase(), availableOS.has(os.toUpperCase()))
    }

    return result
  }
}

export default ISOService
