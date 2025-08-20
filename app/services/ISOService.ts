import { PrismaClient, ISO } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ISOEventManager } from './EventManagers/ISOEventManager';

const prisma = new PrismaClient();

export interface ISOStatus {
  os: string;
  available: boolean;
  iso?: ISO;
}

export class ISOService {
  private static instance: ISOService;
  private eventManager: ISOEventManager;
  private isoBasePath: string;

  private constructor() {
    this.eventManager = ISOEventManager.getInstance();
    this.isoBasePath = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'iso');
  }

  public static getInstance(): ISOService {
    if (!ISOService.instance) {
      ISOService.instance = new ISOService();
    }
    return ISOService.instance;
  }

  /**
   * Scan the ISO directory and sync with database
   */
  public async syncISOsWithFileSystem(): Promise<void> {
    try {
      // Ensure ISO directory exists
      await fs.mkdir(this.isoBasePath, { recursive: true });
      
      // Get all ISO files from filesystem
      const files = await fs.readdir(this.isoBasePath);
      const isoFiles = files.filter(file => file.endsWith('.iso'));

      for (const filename of isoFiles) {
        const filePath = path.join(this.isoBasePath, filename);
        const stats = await fs.stat(filePath);
        
        // Extract OS type from filename (e.g., windows10.iso -> WINDOWS10)
        const osType = this.extractOSType(filename);
        
        if (osType) {
          // Check if ISO exists in database
          const existingISO = await prisma.iSO.findUnique({
            where: { filename }
          });

          if (!existingISO) {
            // Add to database
            await prisma.iSO.create({
              data: {
                filename,
                os: osType,
                size: BigInt(stats.size),
                path: filePath,
                isAvailable: true,
                lastVerified: new Date()
              }
            });
          } else {
            // Update verification timestamp
            await prisma.iSO.update({
              where: { id: existingISO.id },
              data: { 
                lastVerified: new Date(),
                isAvailable: true,
                size: BigInt(stats.size)
              }
            });
          }
        }
      }

      // Mark ISOs as unavailable if file doesn't exist
      const dbISOs = await prisma.iSO.findMany();
      for (const iso of dbISOs) {
        try {
          await fs.access(iso.path);
        } catch {
          await prisma.iSO.update({
            where: { id: iso.id },
            data: { isAvailable: false }
          });
        }
      }
    } catch (error) {
      console.error('Error syncing ISOs with filesystem:', error);
      throw error;
    }
  }

  /**
   * Get all available ISOs
   */
  public async getAvailableISOs(): Promise<ISO[]> {
    return prisma.iSO.findMany({
      where: { isAvailable: true },
      orderBy: { os: 'asc' }
    });
  }

  /**
   * Check if ISO exists for specific OS
   */
  public async checkISOForOS(os: string): Promise<ISOStatus> {
    const iso = await prisma.iSO.findFirst({
      where: { 
        os: os.toUpperCase(),
        isAvailable: true 
      }
    });

    return {
      os: os.toUpperCase(),
      available: !!iso,
      iso: iso || undefined
    };
  }

  /**
   * Get system readiness status
   */
  public async getSystemReadiness(): Promise<{
    ready: boolean;
    availableOS: string[];
    missingOS: string[];
  }> {
    const supportedOS = ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA'];
    const availableISOs = await this.getAvailableISOs();
    const availableOS = availableISOs.map(iso => iso.os);
    const missingOS = supportedOS.filter(os => !availableOS.includes(os));

    return {
      ready: availableOS.length > 0,
      availableOS,
      missingOS
    };
  }

  /**
   * Validate ISO file integrity
   */
  public async validateISO(isoId: string): Promise<boolean> {
    try {
      const iso = await prisma.iSO.findUnique({
        where: { id: isoId }
      });

      if (!iso) {
        throw new Error('ISO not found');
      }

      // Check if file exists
      await fs.access(iso.path);

      // Verify file size
      const stats = await fs.stat(iso.path);
      if (BigInt(stats.size) !== iso.size) {
        await prisma.iSO.update({
          where: { id: isoId },
          data: { isAvailable: false }
        });
        return false;
      }

      // Update validation timestamp
      await prisma.iSO.update({
        where: { id: isoId },
        data: { 
          lastVerified: new Date(),
          isAvailable: true 
        }
      });

      return true;
    } catch (error) {
      console.error('ISO validation failed:', error);
      return false;
    }
  }

  /**
   * Calculate checksum for ISO file
   */
  public async calculateChecksum(isoId: string): Promise<string> {
    const iso = await prisma.iSO.findUnique({
      where: { id: isoId }
    });

    if (!iso) {
      throw new Error('ISO not found');
    }

    const hash = crypto.createHash('sha256');
    const stream = await fs.readFile(iso.path);
    hash.update(stream);
    const checksum = hash.digest('hex');

    // Update checksum in database
    await prisma.iSO.update({
      where: { id: isoId },
      data: { checksum }
    });

    return checksum;
  }

  /**
   * Register ISO after upload
   */
  public async registerISO(
    filename: string, 
    os: string, 
    size: number,
    filePath: string
  ): Promise<ISO> {
    // Check if ISO already exists
    const existing = await prisma.iSO.findUnique({
      where: { filename }
    });

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
      });
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
    });

    // Emit ISO registered event
    this.eventManager.emitISORegistered(iso);

    return iso;
  }

  /**
   * Remove ISO
   */
  public async removeISO(isoId: string): Promise<void> {
    const iso = await prisma.iSO.findUnique({
      where: { id: isoId }
    });

    if (!iso) {
      throw new Error('ISO not found');
    }

    // Delete file from filesystem
    try {
      await fs.unlink(iso.path);
    } catch (error) {
      console.error('Failed to delete ISO file:', error);
    }

    // Delete from database
    await prisma.iSO.delete({
      where: { id: isoId }
    });

    // Emit ISO removed event
    this.eventManager.emitISORemoved(isoId, iso.filename);
  }

  /**
   * Get ISOs grouped by availability
   */
  public async getISOsByAvailability(): Promise<{
    available: ISO[];
    unavailable: ISO[];
  }> {
    const all = await prisma.iSO.findMany({
      orderBy: { os: 'asc' }
    });

    return {
      available: all.filter(iso => iso.isAvailable),
      unavailable: all.filter(iso => !iso.isAvailable)
    };
  }

  /**
   * Extract OS type from filename
   */
  private extractOSType(filename: string): string | null {
    const name = filename.toLowerCase().replace('.iso', '');
    
    const osMapping: { [key: string]: string } = {
      'windows10': 'WINDOWS10',
      'windows11': 'WINDOWS11',
      'win10': 'WINDOWS10',
      'win11': 'WINDOWS11',
      'ubuntu': 'UBUNTU',
      'fedora': 'FEDORA'
    };

    return osMapping[name] || null;
  }

  /**
   * Get all supported OS types
   */
  public getSupportedOSTypes(): string[] {
    return ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA'];
  }

  /**
   * Check multiple OS availability at once
   */
  public async checkMultipleOSAvailability(osList: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const availableISOs = await this.getAvailableISOs();
    const availableOS = new Set(availableISOs.map(iso => iso.os));

    for (const os of osList) {
      result.set(os.toUpperCase(), availableOS.has(os.toUpperCase()));
    }

    return result;
  }
}

export default ISOService;