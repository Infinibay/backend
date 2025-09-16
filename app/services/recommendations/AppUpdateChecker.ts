import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

interface Application {
  name?: string
  app_name?: string
  version?: string
  current_version?: string
  update_available?: string
  new_version?: string
  is_security_update?: boolean
  update_source?: string
  update_size_bytes?: number
}

interface ApplicationInventory {
  applications?: Application[]
}

/**
 * AppUpdateChecker - Tracks application updates and security patches
 *
 * @description
 * Monitors installed applications for available updates, prioritizing security updates
 * and providing actionable recommendations for application maintenance.
 *
 * @category Maintenance
 *
 * @analysis
 * 1. Filters applications with available updates
 * 2. Prioritizes security updates (displayed first)
 * 3. Calculates total download size and update count
 * 4. Limits individual recommendations to top 5 apps
 * 5. Provides summary for large update sets (>5 apps)
 *
 * @input
 * - context.latestSnapshot.applicationInventory.applications: Array of installed apps
 *
 * @output
 * - type: 'APP_UPDATE_AVAILABLE'
 * - Individual app updates (top 5) + summary if >5 total
 * - Severity: 'high' for security updates, 'medium' for regular updates
 *
 * @example
 * Input: Chrome security update available
 * Output: Recommendation to update Chrome with security priority
 */
export class AppUpdateChecker extends RecommendationChecker {
  getName (): string { return 'AppUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.applicationInventory) {
      return results
    }

    try {
      const inventoryData = typeof context.latestSnapshot.applicationInventory === 'string'
        ? JSON.parse(context.latestSnapshot.applicationInventory)
        : context.latestSnapshot.applicationInventory

      if (!inventoryData || typeof inventoryData !== 'object') {
        console.warn('VMRecommendationService: Invalid applicationInventory format')
        return results
      }

      const applications = inventoryData.applications || []
      if (!Array.isArray(applications)) {
        return results
      }

      const updatableApps = applications.filter(app =>
        app &&
        typeof app === 'object' &&
        app.update_available &&
        app.update_available !== null &&
        app.update_available !== ''
      )

      if (updatableApps.length === 0) {
        return results
      }

      const securityUpdates = updatableApps.filter(app => app.is_security_update === true)
      const regularUpdates = updatableApps.filter(app => app.is_security_update !== true)

      const totalSizeMB = updatableApps.reduce((sum, app) => {
        const sizeBytes = app.update_size_bytes || 0
        return sum + (sizeBytes / (1024 * 1024))
      }, 0)

      const topApps = [
        ...securityUpdates.slice(0, 3),
        ...regularUpdates.slice(0, 2)
      ].slice(0, 5)

      for (const app of topApps) {
        const isSecurityUpdate = app.is_security_update === true
        const appName = app.name || app.app_name || 'Unknown Application'
        const currentVersion = app.version || app.current_version || 'Unknown'
        const availableVersion = app.update_available || app.new_version || 'Unknown'
        const updateSource = app.update_source || 'Windows Update'
        const vmName = context.machineConfig?.name || 'VM'

        const text = isSecurityUpdate
          ? `Security update available for ${appName} on ${vmName} (current: ${currentVersion}, available: ${availableVersion})`
          : `Update available for ${appName} on ${vmName} (current: ${currentVersion}, available: ${availableVersion})`

        const actionText = isSecurityUpdate
          ? `Update ${appName} on ${vmName} through ${updateSource} to fix security vulnerabilities`
          : `Update ${appName} on ${vmName} through ${updateSource} to get new features and improvements`

        results.push({
          type: 'APP_UPDATE_AVAILABLE',
          text,
          actionText,
          data: {
            appName,
            currentVersion,
            availableVersion,
            updateSource,
            isSecurityUpdate,
            updateSizeMB: app.update_size_bytes ? Math.round(app.update_size_bytes / (1024 * 1024)) : null,
            severity: isSecurityUpdate ? 'high' : 'medium'
          }
        })
      }

      if (updatableApps.length > 5) {
        const totalCount = updatableApps.length
        const securityCount = securityUpdates.length

        results.push({
          type: 'APP_UPDATE_AVAILABLE',
          text: `${totalCount} application updates available (${securityCount} security updates)`,
          actionText: 'Review and install available updates to keep applications secure and up-to-date',
          data: {
            totalCount,
            securityCount,
            regularCount: regularUpdates.length,
            totalSizeMB: Math.round(totalSizeMB),
            topApps: updatableApps.slice(0, 10).map((app: Application) => ({
              name: app.name || app.app_name,
              currentVersion: app.version || app.current_version,
              availableVersion: app.update_available || app.new_version,
              isSecurityUpdate: app.is_security_update === true
            })),
            severity: securityCount > 0 ? 'high' : 'medium'
          }
        })
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse applicationInventory:', error)
    }

    return results
  }
}