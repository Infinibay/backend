import { RecommendationType } from '@prisma/client'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { ResolutionHandler } from './index'

const OS_UPDATE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

// Cap stored guest output so a large package-manager transcript can't bloat the
// persisted resolution row (the UI only needs a readable tail).
function clip (s: string | undefined, max = 20000): string {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s
}

export const installOSUpdatesHandler: ResolutionHandler = {
  actionKey: 'install_updates',
  types: [RecommendationType.OS_UPDATE_AVAILABLE],
  requiresConfirmation: true,
  async run (ctx) {
    const socket = getVirtioSocketWatcherService()
    await ctx.reportProgress(15, 'Requesting OS update installation in guest')

    const response = await socket.sendUpdateSystemSoftware(ctx.machineId, undefined, OS_UPDATE_TIMEOUT_MS)

    if (!response.success) {
      throw new Error(response.error || 'Guest refused update command')
    }

    await ctx.reportProgress(95, 'Updates installed, checking reboot state')

    const data = (response.data || {}) as Record<string, unknown>
    const requiresReboot = Boolean(data.reboot_required ?? data.requires_reboot)

    return {
      message: requiresReboot
        ? 'Updates installed. System reboot required to complete.'
        : 'Updates installed successfully.',
      // Fold the guest's real stdout/stderr into the persisted result so the UI
      // can show what the package manager actually did (the "logs" view).
      data: {
        ...data,
        stdout: clip(response.stdout),
        stderr: clip(response.stderr)
      },
      requiresReboot
    }
  }
}
