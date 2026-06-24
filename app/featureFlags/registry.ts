/**
 * Feature-flag registry — the single source of truth for KNOWN flags.
 *
 * The DB (`FeatureFlag`) only stores the on/off override per key; the label,
 * description and default live here in code. The `featureFlags` query merges
 * this registry with the DB overrides, and `setFeatureFlag` validates the key
 * against it. To add a flag: append an entry here (and gate its UI/endpoints).
 */

export interface FeatureFlagDef {
  key: string
  label: string
  description: string
  /** Value used when there is no DB override. Default OFF for unfinished work. */
  default: boolean
}

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  {
    key: 'storage',
    label: 'Storage management',
    description: 'Storage backend management — external mounts, cloud buckets, quotas and per-department storage policies. Not implemented yet; off by default.',
    default: false
  }
]

export const FEATURE_FLAG_BY_KEY: Record<string, FeatureFlagDef> = Object.fromEntries(
  FEATURE_FLAGS.map((f) => [f.key, f])
)

export function isKnownFlag (key: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAG_BY_KEY, key)
}
