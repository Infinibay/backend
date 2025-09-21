import { Resolver, Query, Mutation, Arg, Authorized, Ctx } from 'type-graphql'
import { AppSettingsService, AppSettingsUpdateInput } from '@services/AppSettingsService'
import { AppSettings, AppSettingsInput } from '@graphql/types/AppSettingsType'
import { InfinibayContext } from '@utils/context'

@Resolver()
export class AppSettingsResolver {
  /**
   * Get current app settings
   */
  @Query(() => AppSettings)
  @Authorized('USER')
  async getAppSettings (@Ctx() { prisma }: InfinibayContext): Promise<AppSettings> {
    const appSettingsService = new AppSettingsService(prisma)
    const settings = await appSettingsService.getAppSettings()

    // Transform database result to match GraphQL types
    return {
      id: settings.id,
      theme: settings.theme,
      wallpaper: settings.wallpaper,
      logoUrl: settings.logoUrl,
      interfaceSize: settings.interfaceSize,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt
    }
  }

  /**
   * Update app settings
   */
  @Mutation(() => AppSettings)
  @Authorized('ADMIN')
  async updateAppSettings (
    @Arg('input') input: AppSettingsInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<AppSettings> {
    const appSettingsService = new AppSettingsService(prisma)

    // Build update object with only provided fields
    const updateData: AppSettingsUpdateInput = {}
    if (input.theme !== undefined) updateData.theme = input.theme
    if (input.wallpaper !== undefined) updateData.wallpaper = input.wallpaper
    if (input.logoUrl !== undefined) updateData.logoUrl = input.logoUrl
    if (input.interfaceSize !== undefined) updateData.interfaceSize = input.interfaceSize

    const updatedSettings = await appSettingsService.updateAppSettings(updateData)

    // Transform database result to match GraphQL types
    return {
      id: updatedSettings.id,
      theme: updatedSettings.theme,
      wallpaper: updatedSettings.wallpaper,
      logoUrl: updatedSettings.logoUrl,
      interfaceSize: updatedSettings.interfaceSize,
      createdAt: updatedSettings.createdAt,
      updatedAt: updatedSettings.updatedAt
    }
  }
}
