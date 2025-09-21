import { PrismaClient, AppSettings } from '@prisma/client'

export interface AppSettingsUpdateInput {
  theme?: string;
  wallpaper?: string;
  logoUrl?: string;
  interfaceSize?: string;
}

export class AppSettingsService {
  private prisma: PrismaClient

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Get current app settings (creates default if none exist)
   */
  public async getAppSettings (): Promise<AppSettings> {
    try {
      // Always upsert to ensure default settings exist
      const settings = await this.prisma.appSettings.upsert({
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
