import { PrismaClient, AppSettings } from '@prisma/client'
import { promises as fs } from 'fs'
import path from 'path'

export interface AppSettingsUpdateInput {
  theme?: string;
  wallpaper?: string;
  logoUrl?: string;
  interfaceSize?: string;
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
        console.log(`Auto-selecting first wallpaper: ${wallpapers[0]}`)
        return wallpapers[0]
      }

      return null
    } catch (error) {
      console.warn('Could not read wallpapers directory:', error)
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
          console.log('✓ Auto-selected first wallpaper')
        }
      }

      return settings
    } catch (error) {
      console.error('Error retrieving app settings:', error)
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
      console.error('Error updating app settings:', error)
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

      console.log('Default app settings created successfully')
      return defaultSettings
    } catch (error) {
      console.error('Error creating default app settings:', error)
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
          updatedAt: new Date()
        }
      })

      return resetSettings
    } catch (error) {
      console.error('Error resetting app settings:', error)
      throw error
    }
  }

  /**
   * Validate settings input
   */
  private validateInput (input: AppSettingsUpdateInput): void {
    const validThemes = ['light', 'dark', 'system']
    const validInterfaceSizes = ['sm', 'md', 'lg', 'xl']

    if (input.theme && !validThemes.includes(input.theme)) {
      throw new Error(`Invalid theme. Must be one of: ${validThemes.join(', ')}`)
    }

    if (input.interfaceSize && !validInterfaceSizes.includes(input.interfaceSize)) {
      throw new Error(`Invalid interface size. Must be one of: ${validInterfaceSizes.join(', ')}`)
    }

    if (input.wallpaper && typeof input.wallpaper !== 'string') {
      throw new Error('Wallpaper must be a string')
    }

    if (input.logoUrl !== undefined && input.logoUrl !== null && typeof input.logoUrl !== 'string') {
      throw new Error('Logo URL must be a string or null')
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
