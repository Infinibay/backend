import { RecommendationType } from '@prisma/client'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { ResolutionHandler } from './index'

interface AppUpdateEntry {
  name?: string
  package?: string
  isSecurity?: boolean
  is_security?: boolean
}

function extractUpdates (ctx: Parameters<ResolutionHandler['run']>[0]): AppUpdateEntry[] {
  const recData = (ctx.recommendation.data || {}) as Record<string, unknown>
  const list = (recData.updates || recData.applications || recData.pending_updates) as AppUpdateEntry[] | undefined
  return Array.isArray(list) ? list : []
}

function pickPackages (entries: AppUpdateEntry[], explicit?: string[], securityOnly?: boolean): string[] {
  if (explicit && explicit.length > 0) return explicit
  const filtered = securityOnly
    ? entries.filter(e => e.isSecurity === true || e.is_security === true)
    : entries
  return filtered.map(e => e.package || e.name).filter((v): v is string => Boolean(v))
}

async function runPackageUpdates (
  ctx: Parameters<ResolutionHandler['run']>[0],
  packages: string[]
): Promise<{ succeeded: string[]; failed: Array<{ package: string; error: string }> }> {
  const socket = getVirtioSocketWatcherService()
  const succeeded: string[] = []
  const failed: Array<{ package: string; error: string }> = []

  if (packages.length === 0) {
    throw new Error('No packages to update')
  }

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const pct = 10 + Math.floor((i / packages.length) * 85)
    await ctx.reportProgress(pct, `Updating ${pkg} (${i + 1}/${packages.length})`)
    try {
      const response = await socket.sendPackageCommand(ctx.machineId, 'PackageUpdate', pkg, 5 * 60 * 1000)
      if (response.success) succeeded.push(pkg)
      else failed.push({ package: pkg, error: response.error || 'Unknown error' })
    } catch (err: any) {
      failed.push({ package: pkg, error: err?.message || String(err) })
    }
  }

  if (succeeded.length === 0) {
    throw new Error(`All ${packages.length} package updates failed`)
  }

  return { succeeded, failed }
}

export const installAppUpdatesHandler: ResolutionHandler = {
  actionKey: 'install_updates',
  types: [RecommendationType.APP_UPDATE_AVAILABLE],
  requiresConfirmation: true,
  async run (ctx) {
    const entries = extractUpdates(ctx)
    const explicit = (ctx.params.packages as string[] | undefined)
    const securityOnly = Boolean(ctx.params.securityOnly)
    const packages = pickPackages(entries, explicit, securityOnly)
    const result = await runPackageUpdates(ctx, packages)
    const message = result.failed.length === 0
      ? `Updated ${result.succeeded.length} packages successfully.`
      : `Updated ${result.succeeded.length} packages, ${result.failed.length} failed.`
    return { message, data: result as unknown as Record<string, unknown> }
  }
}

export const installSecurityUpdatesHandler: ResolutionHandler = {
  actionKey: 'install_security_updates',
  types: [RecommendationType.APP_UPDATE_AVAILABLE],
  requiresConfirmation: true,
  async run (ctx) {
    const entries = extractUpdates(ctx)
    const explicit = (ctx.params.packages as string[] | undefined)
    const packages = pickPackages(entries, explicit, true)
    if (packages.length === 0) {
      return { message: 'No security updates found.', data: { succeeded: [], failed: [] } }
    }
    const result = await runPackageUpdates(ctx, packages)
    const message = result.failed.length === 0
      ? `Installed ${result.succeeded.length} security updates.`
      : `Installed ${result.succeeded.length} security updates, ${result.failed.length} failed.`
    return { message, data: result as unknown as Record<string, unknown> }
  }
}
