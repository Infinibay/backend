import * as yaml from 'js-yaml'

/**
 * installSources — pure, I/O-free parsing + selection of subiquity install
 * sources from an Ubuntu ISO's `casper/install-sources.yaml`.
 *
 * This is the single source of truth for "which install source do we ask
 * subiquity to lay down". It is deliberately shape-tolerant and rename-tolerant
 * because the file format is a moving target:
 *   - 24.04 server: the file is a TOP-LEVEL ARRAY of sources.
 *   - 26.04 desktop: the file is an OBJECT `{ kernel, sources: [...], version: 2 }`.
 * The previous inline parser assumed an array only, so on 26.04 it produced an
 * empty list → no `source` was written → subiquity fell back to the ISO's
 * `default: true` entry, which on a Desktop ISO is the *minimized* desktop
 * (`ubuntu-desktop-minimal`) → a near-empty system with no `ubuntu-desktop`
 * metapackage.
 */

export interface NormalizedInstallSource {
  /** The subiquity source id, e.g. 'ubuntu-desktop' / 'ubuntu-server'. */
  id: string
  /** 'desktop' | 'server' | '' — the edition this source installs. */
  variant: string
  /** The ISO's own default:true flag (NOT trusted for fullness — on Desktop
   *  ISOs the default is the *minimized* source). */
  isDefault: boolean
  /** squashfs path relative to the ISO's casper/ dir, e.g. 'minimal.standard.squashfs'. */
  path: string
  /** Installed-footprint estimate from the yaml (may be 0). Used ONLY as a last,
   *  minimal-guarded tie-break — never to decide minimal-vs-full. */
  size: number
  /** e.g. 'fsimage-layered' | 'fsimage' | ''. Layered sources need their base layer too. */
  type: string
  /** SEMANTIC minimal flag: derived from id + name + description text, so it
   *  survives an id that drops the literal word 'minimal'. */
  minimal: boolean
}

function textOf (v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    // name/description are localized maps like { en: '...' }.
    return Object.values(v as Record<string, unknown>)
      .filter((x): x is string => typeof x === 'string')
      .join(' ')
  }
  return ''
}

function normalizeSource (e: Record<string, unknown>): NormalizedInstallSource {
  const id = String(e.id)
  const name = textOf(e.name)
  const description = textOf(e.description)
  const minimal = /minimal|minimized/i.test(`${id} ${name} ${description}`)
  const size = typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : 0
  return {
    id,
    variant: typeof e.variant === 'string' ? e.variant.toLowerCase() : '',
    isDefault: e.default === true,
    path: typeof e.path === 'string' ? e.path : '',
    size,
    type: typeof e.type === 'string' ? e.type : '',
    minimal
  }
}

/**
 * Parse an install-sources.yaml body into normalized sources. Accepts BOTH the
 * top-level-array (24.04) and the `{ sources: [...] }` object (26.04+) shapes,
 * and returns [] on anything unparseable (caller then omits `source` and lets
 * subiquity use the ISO default — safe for exotic/absent files).
 */
export function parseInstallSources (yamlText: string): NormalizedInstallSource[] {
  let parsed: unknown
  try {
    parsed = yaml.load(yamlText)
  } catch {
    return []
  }
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).sources))
        ? ((parsed as Record<string, unknown>).sources as unknown[])
        : []
  return rawList
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object' && typeof (e as Record<string, unknown>).id === 'string')
    .map(normalizeSource)
}

export interface SelectSourceOptions {
  /** Explicit id to prefer (override/tie-break), from the OsProfile. Only honored
   *  when it matches a NON-minimal desktop source, so it can never re-select the
   *  minimized image. */
  preferredId?: string
  /** The edition the product wants for this OS ('desktop' for the VDI Ubuntu). */
  expectedEdition?: 'desktop' | 'server'
}

/** Largest-first, then id asc — deterministic ordering among equally-eligible sources. */
function bySizeThenId (a: NormalizedInstallSource, b: NormalizedInstallSource): number {
  return (b.size - a.size) || a.id.localeCompare(b.id)
}

/**
 * Pick the best install source for the requested edition. Robust to:
 *  - the full-desktop source id being RENAMED (we key on variant+non-minimal, not
 *    the literal 'ubuntu-desktop'),
 *  - the ISO marking the MINIMIZED desktop as default:true (we never lead with
 *    default),
 *  - a missing `variant` field (the minimal-semantic exclusion still keeps us off
 *    the minimized image),
 *  - `size` reflecting layer size instead of installed footprint (size is only a
 *    last, minimal-guarded tie-break).
 * Returns undefined when there are no sources (→ caller omits `source`).
 */
export function selectInstallSource (
  sources: NormalizedInstallSource[],
  opts: SelectSourceOptions = {}
): NormalizedInstallSource | undefined {
  if (sources.length === 0) return undefined

  if (opts.expectedEdition === 'desktop') {
    const desktop = sources.filter(s => s.variant === 'desktop')
    const fullDesktop = desktop.filter(s => !s.minimal)
    if (fullDesktop.length > 0) {
      if (opts.preferredId) {
        const pinned = fullDesktop.find(s => s.id === opts.preferredId)
        if (pinned) return pinned
      }
      return [...fullDesktop].sort(bySizeThenId)[0]
    }
    if (desktop.length > 0) {
      // Only a minimized desktop exists — best effort; caller logs a loud warning.
      return [...desktop].sort(bySizeThenId)[0]
    }
    // No desktop variant at all (a server ISO answering a desktop request):
    // fall through to the generic branch so the install still completes.
  }

  // Generic / server: never return a minimal source when a non-minimal exists.
  const nonMinimal = sources.filter(s => !s.minimal)
  const def = sources.find(s => s.isDefault)
  if (def && !def.minimal) return def
  if (nonMinimal.length > 0) {
    const defNonMin = nonMinimal.find(s => s.isDefault)
    return defNonMin ?? [...nonMinimal].sort(bySizeThenId)[0]
  }
  return def ?? sources[0]
}
