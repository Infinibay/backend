import { Resolver, Query, Mutation, Arg, Authorized, Ctx } from 'type-graphql'
import { AppSettingsService, AppSettingsUpdateInput } from '@services/AppSettingsService'
import { AppSettings, AppSettingsInput } from '@graphql/types/AppSettingsType'
import { InfinibayContext } from '@utils/context'

function toGraphql (s: {
  id: string
  theme: string
  wallpaper: string
  logoUrl: string | null
  interfaceSize: string
  brandName: string | null
  themePreset: string | null
  accentColor: string | null
  accent2Color: string | null
  accent3Color: string | null
  createdAt: Date
  updatedAt: Date
}): AppSettings {
  return {
    id: s.id,
    theme: s.theme,
    wallpaper: s.wallpaper,
    logoUrl: s.logoUrl,
    interfaceSize: s.interfaceSize,
    brandName: s.brandName,
    themePreset: s.themePreset,
    accentColor: s.accentColor,
    accent2Color: s.accent2Color,
    accent3Color: s.accent3Color,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }
}

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
    return toGraphql(settings)
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

    // Build update object with only provided fields. Allow-list keeps
    // surprise/unsupported fields out of the Prisma call.
    const updateData: AppSettingsUpdateInput = {}
    if (input.theme !== undefined) updateData.theme = input.theme
    if (input.wallpaper !== undefined) updateData.wallpaper = input.wallpaper
    if (input.logoUrl !== undefined) updateData.logoUrl = input.logoUrl
    if (input.interfaceSize !== undefined) updateData.interfaceSize = input.interfaceSize
    if (input.brandName !== undefined) updateData.brandName = input.brandName
    if (input.themePreset !== undefined) updateData.themePreset = input.themePreset
    if (input.accentColor !== undefined) updateData.accentColor = input.accentColor
    if (input.accent2Color !== undefined) updateData.accent2Color = input.accent2Color
    if (input.accent3Color !== undefined) updateData.accent3Color = input.accent3Color

    const updatedSettings = await appSettingsService.updateAppSettings(updateData)
    return toGraphql(updatedSettings)
  }
}
