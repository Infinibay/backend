import { PrismaClient } from '@prisma/client'
import { FEATURE_FLAGS, FEATURE_FLAG_BY_KEY, isKnownFlag } from '@main/featureFlags/registry'

export interface ResolvedFeatureFlag {
  key: string
  label: string
  description: string
  enabled: boolean
}

/**
 * Resolves feature flags by overlaying the DB overrides on top of the code
 * registry defaults. A flag with no DB row falls back to its registry default.
 */
export class FeatureFlagService {
  constructor (private readonly prisma: PrismaClient) {}

  async getAll (): Promise<ResolvedFeatureFlag[]> {
    const rows = await this.prisma.featureFlag.findMany()
    const overrides = new Map(rows.map((r) => [r.key, r.enabled]))
    return FEATURE_FLAGS.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      enabled: overrides.has(f.key) ? (overrides.get(f.key) as boolean) : f.default
    }))
  }

  /** Effective on/off for a single key — DB override, else registry default. */
  async isEnabled (key: string): Promise<boolean> {
    const row = await this.prisma.featureFlag.findUnique({ where: { key } })
    if (row) return row.enabled
    const def = FEATURE_FLAG_BY_KEY[key]
    return def ? def.default : false
  }

  async set (key: string, enabled: boolean, updatedById?: string | null): Promise<ResolvedFeatureFlag> {
    if (!isKnownFlag(key)) {
      throw new Error(`Unknown feature flag: ${key}`)
    }
    await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, updatedById: updatedById ?? null },
      update: { enabled, updatedById: updatedById ?? null }
    })
    const def = FEATURE_FLAG_BY_KEY[key]
    return { key, label: def.label, description: def.description, enabled }
  }
}
