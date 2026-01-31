// ============================================================================
// Package Manifest Types (without zod dependency)
// ============================================================================

/**
 * Capabilities that a package can request access to.
 * These define what system resources the package needs.
 */
export interface PackageCapabilities {
  /** List of domains the package needs network access to (e.g., ["api.openai.com"]) */
  network?: string[]
  /** Whether the package needs persistent storage */
  storage?: boolean
  /** Cron expression for scheduled execution (e.g., "0 0/6 * * *" for every 6 hours) */
  cron?: string
  /** Whether the package can execute remediations */
  remediation?: boolean
}

/**
 * Data types that checkers can request access to.
 */
export type CheckerDataNeeds =
  | 'diskMetrics'
  | 'diskHealth'
  | 'historicalMetrics'
  | 'processSnapshots'
  | 'portUsage'
  | 'machineConfig'
  | 'windowsUpdate'
  | 'defenderStatus'
  | 'applicationInventory'

/**
 * Definition of a health checker within a package.
 */
export interface PackageCheckerDef {
  /** Unique identifier for the checker (lowercase alphanumeric with dashes) */
  name: string
  /** Path to the checker implementation file relative to package root */
  file: string
  /** Type identifier for the recommendation produced by this checker */
  type: string
  /** Data that should be passed to the checker at runtime */
  dataNeeds?: CheckerDataNeeds[]
}

/**
 * Definition of a remediation script within a package.
 */
export interface PackageRemediation {
  /** Unique identifier for the remediation */
  name: string
  /** Path to the script file relative to package root */
  script: string
  /** Platforms this remediation supports */
  platforms: ('windows' | 'linux')[]
}

/**
 * Definition of a configurable setting within a package.
 */
export interface PackageSetting {
  /** Type of the setting value */
  type: 'string' | 'number' | 'boolean' | 'secret' | 'select'
  /** Display label for the setting */
  label: string
  /** Optional description explaining the setting */
  description?: string
  /** Whether this setting is required */
  required?: boolean
  /** Default value if not configured */
  default?: string | number | boolean
  /** Options for 'select' type settings */
  options?: Array<{ value: string; label: string }>
}

/**
 * Complete manifest structure for an Infinibay package.
 */
export interface PackageManifest {
  /** Unique identifier for the package (lowercase alphanumeric with dashes) */
  name: string
  /** Semantic version (e.g., "1.0.0") */
  version: string
  /** Human-readable display name */
  displayName: string
  /** Optional description of the package */
  description?: string
  /** Author or organization name */
  author: string
  /** License type */
  license: 'open-source' | 'commercial'
  /** Minimum Infinibay version required */
  minInfinibayVersion?: string
  /** Capabilities requested by this package */
  capabilities?: PackageCapabilities
  /** Health checkers provided by this package */
  checkers: PackageCheckerDef[]
  /** Remediation scripts provided by this package */
  remediations?: PackageRemediation[]
  /** Configurable settings for this package */
  settings?: Record<string, PackageSetting>
}

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * Runtime status of a loaded package
 */
export interface PackageStatus {
  name: string
  version: string
  isLoaded: boolean
  isEnabled: boolean
  isBuiltin: boolean
  lastError?: string
  checkerCount: number
  loadedAt?: Date
}

/**
 * Context passed to package checkers during analysis
 */
export interface PackageCheckerContext {
  vmId: string
  diskMetrics?: unknown
  diskHealth?: unknown
  historicalMetrics?: unknown[]
  processSnapshots?: unknown[]
  portUsage?: unknown[]
  machineConfig?: unknown
  windowsUpdate?: unknown
  defenderStatus?: unknown
  applicationInventory?: unknown
  settings: Record<string, unknown>
}

/**
 * Severity levels for recommendations
 */
export type CheckerSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Result returned by a package checker
 */
export interface PackageCheckerResult {
  type: string
  text: string
  actionText: string
  severity: CheckerSeverity
  data?: Record<string, unknown>
  remediation?: string
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validation error structure
 */
export interface ValidationError {
  field: string
  message: string
}

/**
 * Validation result
 */
export interface ValidationResult {
  success: boolean
  data?: PackageManifest
  errors?: ValidationError[]
}

/**
 * Validate a package manifest
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = []

  if (!manifest || typeof manifest !== 'object') {
    return { success: false, errors: [{ field: 'root', message: 'Manifest must be an object' }] }
  }

  const m = manifest as Record<string, unknown>

  // Required string fields
  if (typeof m.name !== 'string' || !/^[a-z0-9-]+$/.test(m.name)) {
    errors.push({ field: 'name', message: 'Name must be lowercase alphanumeric with dashes' })
  }

  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) {
    errors.push({ field: 'version', message: 'Version must be semver (e.g., 1.0.0)' })
  }

  if (typeof m.displayName !== 'string' || m.displayName.length === 0) {
    errors.push({ field: 'displayName', message: 'Display name is required' })
  }

  if (typeof m.author !== 'string' || m.author.length === 0) {
    errors.push({ field: 'author', message: 'Author is required' })
  }

  if (m.license !== 'open-source' && m.license !== 'commercial') {
    errors.push({ field: 'license', message: 'License must be "open-source" or "commercial"' })
  }

  // Checkers array
  if (!Array.isArray(m.checkers) || m.checkers.length === 0) {
    errors.push({ field: 'checkers', message: 'At least one checker is required' })
  } else {
    for (let i = 0; i < m.checkers.length; i++) {
      const checker = m.checkers[i] as Record<string, unknown>
      if (typeof checker.name !== 'string' || !/^[a-z0-9-]+$/.test(checker.name)) {
        errors.push({ field: `checkers[${i}].name`, message: 'Checker name must be lowercase alphanumeric with dashes' })
      }
      if (typeof checker.file !== 'string') {
        errors.push({ field: `checkers[${i}].file`, message: 'Checker file is required' })
      }
      if (typeof checker.type !== 'string') {
        errors.push({ field: `checkers[${i}].type`, message: 'Checker type is required' })
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors }
  }

  return { success: true, data: m as unknown as PackageManifest }
}

/**
 * Schema object for compatibility with existing code that imports PackageManifestSchema
 */
export const PackageManifestSchema = {
  safeParse(data: unknown): { success: true; data: PackageManifest } | { success: false; error: { format: () => string } } {
    const result = validateManifest(data)
    if (result.success) {
      return { success: true, data: result.data! }
    }
    return {
      success: false,
      error: {
        format: () => result.errors!.map(e => `${e.field}: ${e.message}`).join('\n')
      }
    }
  }
}
