import logger from '@main/logger'
import { PrismaClient, AppSettings } from '@prisma/client'
import { promises as fs } from 'fs'
import path from 'path'

export interface AppSettingsUpdateInput {
  theme?: string;
  wallpaper?: string;
  logoUrl?: string;
  interfaceSize?: string;
  brandName?: string;
  themePreset?: string;
  accentColor?: string;
  accent2Color?: string;
  accent3Color?: string;
}

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
const WALLPAPERS_DIR = process.env.INFINIBAY_WALLPAPERS_DIR || '/opt/infinibay/wallpapers'

export class AppSettingsService {
  private prisma: PrismaClient

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Get the first available wallpaper from the wallpapers directory
   */
  private async getFirstAvailableWallpaper (): Promise<string | null> {
    try {
      // Check if directory exists
      await fs.access(WALLPAPERS_DIR)

      // Read directory contents
      const files = await fs.readdir(WALLPAPERS_DIR)

      // Filter and sort wallpapers
      const wallpapers = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase()
          return SUPPORTED_EXTENSIONS.includes(ext)
        })
        .sort((a, b) => a.localeCompare(b))

      // Return first wallpaper if available
      if (wallpapers.length > 0) {
        logger.info(`Auto-selecting first wallpaper: ${wallpapers[0]}`)
        return wallpapers[0]
      }

      return null
    } catch (error) {
      logger.warn('Could not read wallpapers directory:', error)
      return null
    }
  }

  /**
   * Get current app settings (creates default if none exist)
   * Auto-selects first available wallpaper if using default placeholder
   */
  public async getAppSettings (): Promise<AppSettings> {
    try {
      // Always upsert to ensure default settings exist
      let settings = await this.prisma.appSettings.upsert({
        where: { id: 'default-settings' },
        update: {},
        create: {
          id: 'default-settings',
          theme: 'system',
          wallpaper: 'wallpaper1.jpg',
          logoUrl: null,
          interfaceSize: 'xl'
        }
      })

      // Auto-select first wallpaper if using default placeholder
      if (settings.wallpaper === 'wallpaper1.jpg') {
        const firstWallpaper = await this.getFirstAvailableWallpaper()
        if (firstWallpaper) {
          settings = await this.prisma.appSettings.update({
            where: { id: 'default-settings' },
            data: { wallpaper: firstWallpaper }
          })
          logger.info('✓ Auto-selected first wallpaper')
        }
      }

      return settings
    } catch (error) {
      logger.error('Error retrieving app settings:', error)
      throw error
    }
  }

  /**
   * Update app settings
   */
  public async updateAppSettings (input: AppSettingsUpdateInput): Promise<AppSettings> {
    try {
      // Validate input
      this.validateInput(input)

      // Update settings using fixed ID
      const updatedSettings = await this.prisma.appSettings.update({
        where: { id: 'default-settings' },
        data: {
          ...input,
          updatedAt: new Date()
        }
      })

      return updatedSettings
    } catch (error) {
      logger.error('Error updating app settings:', error)
      throw error
    }
  }

  /**
   * Create default app settings
   */
  public async createDefaultSettings (): Promise<AppSettings> {
    try {
      const defaultSettings = await this.prisma.appSettings.upsert({
        where: { id: 'default-settings' },
        update: {},
        create: {
          id: 'default-settings',
          theme: 'system',
          wallpaper: 'wallpaper1.jpg',
          logoUrl: null,
          interfaceSize: 'xl'
        }
      })

      logger.info('Default app settings created successfully')
      return defaultSettings
    } catch (error) {
      logger.error('Error creating default app settings:', error)
      throw error
    }
  }

  /**
   * Reset app settings to default values
   */
  public async resetToDefaults (): Promise<AppSettings> {
    try {
      const resetSettings = await this.prisma.appSettings.update({
        where: { id: 'default-settings' },
        data: {
          theme: 'system',
          wallpaper: 'wallpaper1.jpg',
          logoUrl: null,
          interfaceSize: 'xl',
          brandName: null,
          themePreset: null,
          accentColor: null,
          accent2Color: null,
          accent3Color: null,
          updatedAt: new Date()
        }
      })

      return resetSettings
    } catch (error) {
      logger.error('Error resetting app settings:', error)
      throw error
    }
  }

  /**
   * Validate settings input
   */
  private validateInput (input: AppSettingsUpdateInput): void {
    const validThemes = ['light', 'dark', 'system']
    const validInterfaceSizes = ['sm', 'md', 'lg', 'xl']

    // Guard on presence, not truthiness: an empty string is falsy but is
    // still forwarded by the resolver and persisted to the non-null column,
    // so it must be checked against the enum whitelist and rejected.
    if (input.theme != null && !validThemes.includes(input.theme)) {
      throw new Error(`Invalid theme. Must be one of: ${validThemes.join(', ')}`)
    }

    if (input.interfaceSize != null && !validInterfaceSizes.includes(input.interfaceSize)) {
      throw new Error(`Invalid interface size. Must be one of: ${validInterfaceSizes.join(', ')}`)
    }

    if (input.wallpaper && typeof input.wallpaper !== 'string') {
      throw new Error('Wallpaper must be a string')
    }

    if (input.logoUrl !== undefined && input.logoUrl !== null && typeof input.logoUrl !== 'string') {
      throw new Error('Logo URL must be a string or null')
    }

    // Bound the unbounded text fields. This row is served by getAppSettings to
    // every authenticated user (appSettings:view is universal), so a single
    // write of an oversized/hostile value would be amplified to all clients.
    const tooLong = (v: unknown, max: number): boolean =>
      typeof v === 'string' && v.length > max
    if (tooLong(input.wallpaper, 255)) {
      throw new Error('Wallpaper is too long (max 255 characters)')
    }
    if (tooLong(input.brandName, 128)) {
      throw new Error('Brand name is too long (max 128 characters)')
    }
    if (tooLong(input.themePreset, 64)) {
      throw new Error('Theme preset is too long (max 64 characters)')
    }
    // Constrain logoUrl to http(s) or a relative ("/") URL so a persisted
    // javascript:/data: URI can't be fanned out to every client's UI.
    if (input.logoUrl && (input.logoUrl.length > 2048 || !/^(https?:\/\/|\/)/i.test(input.logoUrl))) {
      throw new Error('Logo URL must be an http(s) or relative ("/") URL (max 2048 characters)')
    }

    const HEX = /^#([a-f0-9]{3}|[a-f0-9]{6})$/i
    const TRIPLET = /^\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}\s*$/
    const isColor = (v: unknown): v is string =>
      typeof v === 'string' && (HEX.test(v) || TRIPLET.test(v))
    for (const key of ['accentColor', 'accent2Color', 'accent3Color'] as const) {
      const v = input[key]
      if (v !== undefined && v !== null && v !== '' && !isColor(v)) {
        throw new Error(`${key} must be a hex ("#RRGGBB") or "R G B" triplet`)
      }
    }
  }

  /**
   * Get available theme options
   */
  public getAvailableThemes (): string[] {
    return ['light', 'dark', 'system']
  }

  /**
   * Get available interface size options
   */
  public getAvailableInterfaceSizes (): string[] {
    return ['sm', 'md', 'lg', 'xl']
  }
}

export default AppSettingsService
