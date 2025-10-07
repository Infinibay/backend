import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

/**
 * PortConflictChecker - Disabled (Firewall system removed)
 *
 * @description
 * This checker has been disabled as the firewall system has been removed.
 * Returns empty results until the firewall system is redesigned.
 *
 * @category Security
 */
export class PortConflictChecker extends RecommendationChecker {
  getName (): string { return 'PortConflictChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // Firewall system removed - no port conflict analysis available
    return []
  }
}
