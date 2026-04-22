import { RecommendationType } from '@prisma/client'
import { getVirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { ResolutionHandler } from './index'

const SCRIPT = `
try {
  Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction Stop
  Start-Service WinDefend -ErrorAction SilentlyContinue
  $p = Get-MpPreference
  Write-Output ("RealtimeMonitoringEnabled=" + (-not $p.DisableRealtimeMonitoring))
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

export const enableDefenderHandler: ResolutionHandler = {
  actionKey: 'enable_defender',
  types: [RecommendationType.DEFENDER_DISABLED],
  async run (ctx) {
    const socket = getVirtioSocketWatcherService()
    await ctx.reportProgress(25, 'Executing PowerShell to enable Defender')
    const response = await socket.sendMaintenancePowerShellScript(
      ctx.machineId,
      SCRIPT,
      { runAsAdmin: true, scriptType: 'inline' },
      120000
    )
    if (!response.success) {
      throw new Error(response.error || 'Failed to enable Windows Defender')
    }
    return { message: 'Windows Defender real-time protection enabled.', data: (response.data || {}) as Record<string, unknown> }
  }
}
