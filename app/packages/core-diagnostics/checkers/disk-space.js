/**
 * Disk Space Checker - Package wrapper for the core DiskSpaceChecker
 *
 * This wrapper adapts the existing DiskSpaceChecker to the package system interface.
 * It converts PackageCheckerContext to RecommendationContext and transforms results
 * to PackageCheckerResult format.
 */

const path = require('path');

// Import the compiled DiskSpaceChecker from the dist folder
const { DiskSpaceChecker } = require(path.resolve(__dirname, '../../../../dist/services/recommendations/DiskSpaceChecker'));

/**
 * Package-compatible wrapper for DiskSpaceChecker
 * Implements the IPackageChecker interface expected by PackageManager
 */
class DiskSpacePackageChecker {
  constructor() {
    this.checker = new DiskSpaceChecker();
  }

  /**
   * Analyze disk space and return package-formatted results
   * @param {import('../../../services/packages/types').PackageCheckerContext} context
   * @returns {Promise<import('../../../services/packages/types').PackageCheckerResult[]>}
   */
  async analyze(context) {
    // Convert PackageCheckerContext to RecommendationContext
    const recommendationContext = this.convertToRecommendationContext(context);

    // Run the original checker
    const results = await this.checker.analyze(recommendationContext);

    // Convert RecommendationResult[] to PackageCheckerResult[]
    return results.map(result => this.convertToPackageResult(result));
  }

  /**
   * Convert PackageCheckerContext to RecommendationContext
   * @param {import('../../../services/packages/types').PackageCheckerContext} pkgContext
   * @returns {import('../../../services/recommendations/BaseRecommendationChecker').RecommendationContext}
   */
  convertToRecommendationContext(pkgContext) {
    // The package system passes diskMetrics, we need to convert it to latestSnapshot format
    const latestSnapshot = pkgContext.diskMetrics
      ? { diskSpaceInfo: pkgContext.diskMetrics }
      : null;

    return {
      vmId: pkgContext.vmId,
      latestSnapshot: latestSnapshot,
      historicalMetrics: pkgContext.historicalMetrics || [],
      recentProcessSnapshots: pkgContext.processSnapshots || [],
      portUsage: pkgContext.portUsage || [],
      machineConfig: pkgContext.machineConfig || null
    };
  }

  /**
   * Convert RecommendationResult to PackageCheckerResult
   * @param {import('../../../services/recommendations/BaseRecommendationChecker').RecommendationResult} result
   * @returns {import('../../../services/packages/types').PackageCheckerResult}
   */
  convertToPackageResult(result) {
    // Extract severity from the data, default to 'medium' if not present
    const severity = result.data?.severity || 'medium';

    return {
      type: result.type,
      text: result.text,
      actionText: result.actionText,
      severity: severity,
      data: result.data || {}
    };
  }
}

// Export the checker class for dynamic loading
module.exports = DiskSpacePackageChecker;
