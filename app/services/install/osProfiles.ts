/**
 * OS install profiles — the distro-agnostic catalog that drives unattended
 * installation by MECHANISM rather than by a hardcoded distro name.
 *
 * Two install mechanisms cover the Linux world:
 *   - 'cloud-init'  — Debian/Ubuntu-family autoinstall (subiquity NoCloud seed:
 *                     user-data/meta-data). Handled by CloudInitInstaller.
 *   - 'kickstart'   — RHEL-family anaconda (Fedora / RHEL / Rocky / Alma / CentOS).
 *                     Handled by KickstartInstaller.
 * Windows uses a third mechanism ('autounattend', an answer file) handled by
 * UnattendedWindowsManager — kept separate, it is not a Linux install.
 *
 * Adding support for a new distro/version is a DATA change here (a catalog entry),
 * not new code: the installer reads the profile + the ISO to adapt. The OS string
 * may be a bare family ('ubuntu', 'fedora') or carry a version ('ubuntu-22.04',
 * 'rocky9'); resolveOsProfile normalizes both.
 */

export type InstallMechanism = 'cloud-init' | 'kickstart' | 'autounattend'
export type OsFamily = 'ubuntu' | 'debian' | 'fedora' | 'rhel' | 'windows'

export interface OsProfile {
  /** Canonical id (matches the OsEnum value where one exists). */
  id: string
  family: OsFamily
  mechanism: InstallMechanism
  displayName: string
  /**
   * Ordered patterns to locate the base ISO in the ISO directory. The first match
   * wins. Family-generic so 'ubuntu-24.04.iso', 'ubuntu.iso' all match.
   */
  isoPatterns: RegExp[]
  /**
   * cloud-init only: the subiquity `source.id` to request. `undefined`/absent means
   * "let the installer auto-detect a valid source from the ISO" (correct for Server
   * ISOs, which have NO 'ubuntu-desktop' source — hardcoding it stalls the install).
   */
  cloudInitPreferredSource?: string
  /**
   * The edition the product requires for this OS. For a VDI product Ubuntu must be
   * 'desktop'. Drives install-source selection (full desktop vs minimized/server)
   * and base-ISO disambiguation when several ISOs of the same family are present.
   * Absent → no edition constraint (any matching ISO is acceptable).
   */
  expectedEdition?: 'desktop' | 'server'
  /** kickstart only: package group/environment to install (e.g. a server vs workstation env). */
  kickstartEnvironment?: string
  /** Boots via OVMF UEFI by default. */
  uefi: boolean
}

const PROFILES: OsProfile[] = [
  {
    id: 'ubuntu', family: 'ubuntu', mechanism: 'cloud-init', displayName: 'Ubuntu',
    isoPatterns: [/ubuntu.*\.iso$/i],
    // Prefer the FULL desktop source on Desktop ISOs. Ubuntu Desktop ISOs expose
    // BOTH 'ubuntu-desktop-minimal' (marked default:true — a minimized desktop with
    // no 'ubuntu-desktop' metapackage) and 'ubuntu-desktop' (the full desktop). The
    // auto-detector honors the ISO's default:true entry, so without this it picked
    // the *minimal* source and produced a near-empty system. detectInstallSource only
    // uses this when the ISO actually lists it (ids.some), so on a Server ISO — which
    // has no 'ubuntu-desktop' source — it safely falls back to the ISO default
    // ('ubuntu-server'). Full desktop is the right default for a VDI product.
    cloudInitPreferredSource: 'ubuntu-desktop',
    expectedEdition: 'desktop',
    uefi: true
  },
  {
    id: 'debian', family: 'debian', mechanism: 'cloud-init', displayName: 'Debian',
    isoPatterns: [/debian.*\.iso$/i],
    uefi: true
  },
  {
    id: 'fedora', family: 'fedora', mechanism: 'kickstart', displayName: 'Fedora',
    isoPatterns: [/fedora.*\.iso$/i],
    uefi: true
  },
  {
    id: 'rhel', family: 'rhel', mechanism: 'kickstart', displayName: 'RHEL family',
    // Matches RHEL and its rebuilds, all anaconda/kickstart.
    isoPatterns: [/(rhel|rocky|almalinux|alma|centos|oracle)[-_].*\.iso$/i],
    uefi: true
  },
  {
    id: 'windows10', family: 'windows', mechanism: 'autounattend', displayName: 'Windows 10',
    isoPatterns: [/win(dows)?[-_ ]?10.*\.iso$/i, /Win10.*\.iso$/i],
    uefi: true
  },
  {
    id: 'windows11', family: 'windows', mechanism: 'autounattend', displayName: 'Windows 11',
    isoPatterns: [/win(dows)?[-_ ]?11.*\.iso$/i, /Win11.*\.iso$/i],
    uefi: true
  }
]

/**
 * Resolve an OS string to its install profile. Accepts a bare family ('ubuntu'),
 * a versioned string ('ubuntu-22.04', 'rocky9'), or a legacy alias ('redhat').
 * Matching order: exact id → known alias → longest family/id prefix → null.
 */
export function resolveOsProfile (os: string | null | undefined): OsProfile | null {
  const n = (os ?? '').toLowerCase().trim()
  if (n.length === 0) return null

  // Exact id.
  const exact = PROFILES.find((p) => p.id === n)
  if (exact) return exact

  // Legacy / family aliases that map onto a catalog family.
  const ALIASES: Record<string, string> = {
    redhat: 'rhel', rocky: 'rhel', rockylinux: 'rhel', almalinux: 'rhel', alma: 'rhel', centos: 'rhel', oracle: 'rhel'
  }
  if (ALIASES[n]) return PROFILES.find((p) => p.id === ALIASES[n]) ?? null

  // Prefix match so versioned strings resolve ('ubuntu-22.04' → ubuntu, 'rocky9' → rhel).
  // Prefer the longest matching family/id so 'windows11' beats a hypothetical 'windows'.
  const byPrefix = PROFILES
    .filter((p) => n.startsWith(p.id) || n.startsWith(p.family) || (ALIASES[p.family] === undefined && Object.keys(ALIASES).some((a) => n.startsWith(a) && ALIASES[a] === p.id)))
    .sort((a, b) => Math.max(b.id.length, b.family.length) - Math.max(a.id.length, a.family.length))
  if (byPrefix[0]) return byPrefix[0]

  // RHEL rebuilds named without a separator ('rocky9', 'alma9').
  const rebuild = Object.keys(ALIASES).find((a) => n.startsWith(a))
  if (rebuild) return PROFILES.find((p) => p.id === ALIASES[rebuild]) ?? null

  return null
}

/** The install mechanism for an OS string, or null if unknown. */
export function installMechanismFor (os: string | null | undefined): InstallMechanism | null {
  return resolveOsProfile(os)?.mechanism ?? null
}

/** Exposed for tests / tooling. */
export function allOsProfiles (): readonly OsProfile[] {
  return PROFILES
}
