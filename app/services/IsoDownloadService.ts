import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import type { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { UserInputError } from '@utils/errors'
import ISOService from './ISOService'
import ISOEventManager from './EventManagers/ISOEventManager'
import { resolveOsProfile, OsProfile, AutoDownloadSpec } from './install/osProfiles'
import { validateUbuntuDesktopISO, validateFedoraNetinstallISO } from '../routes/isoUpload'

const debug = logger.child ? logger.child({ module: 'iso-download' }) : logger

interface ResolvedDownload {
  url: string
  sha256: string
  /** The publisher's filename (for logging only — on disk it becomes `${os}.iso`). */
  sourceFilename: string
}

export type IsoDownloadPhase = 'idle' | 'resolving' | 'downloading' | 'verifying' | 'registering' | 'done' | 'failed' | 'cancelled'

export interface IsoDownloadState {
  os: string
  state: IsoDownloadPhase
  receivedBytes: number
  totalBytes: number
  error?: string
}

/**
 * Auto-download orchestrator for the supported Linux install images, built on top
 * of the existing ISOService/osProfiles machinery. It resolves the latest official
 * URL + checksum from the distro's PUBLISHED INDEX (not HTML scraping of a landing
 * page), streams it with Socket.IO progress, verifies the checksum, runs the same
 * content validators the upload route uses, lands the file in the canonical flat
 * dir `${INFINIBAY_BASE_DIR}/iso/${os}.iso`, and registers it.
 *
 * Windows is intentionally NOT auto-downloadable (Microsoft CDN links expire) —
 * callers get a clear error pointing at the manual upload path.
 *
 * See lxd/docs/setup-system/02-setup-onboarding.md §4.
 */
export class IsoDownloadService {
  private static instance: IsoDownloadService
  private readonly inProgress = new Set<string>()
  // Per-OS live status the frontend can POLL (socket-independent, so it works even
  // during /setup where the realtime socket may not be connected).
  private readonly status = new Map<string, IsoDownloadState>()
  private readonly aborters = new Map<string, AbortController>()

  private constructor () {}

  public static getInstance (): IsoDownloadService {
    if (!IsoDownloadService.instance) {
      IsoDownloadService.instance = new IsoDownloadService()
    }
    return IsoDownloadService.instance
  }

  /** OS ids that can be auto-downloaded (those with an autoDownload profile spec). */
  public static downloadableOsIds (): string[] {
    return ['ubuntu', 'fedora'].filter((os) => resolveOsProfile(os)?.autoDownload)
  }

  public isDownloading (os: string): boolean {
    return this.inProgress.has(os.toLowerCase())
  }

  /** Live download status for an OS (null if nothing has been attempted). */
  public getStatus (os: string): IsoDownloadState | null {
    return this.status.get(os.toLowerCase().trim()) ?? null
  }

  /** Cancel an in-progress download. Returns true if one was actually aborted. */
  public cancel (os: string): boolean {
    const osLower = os.toLowerCase().trim()
    const aborter = this.aborters.get(osLower)
    if (aborter) {
      aborter.abort()
      return true
    }
    return false
  }

  /**
   * Kick off an auto-download. Returns immediately (fire-and-forget). Progress and
   * the terminal result are exposed via `getStatus(os)` (polled by the UI) AND over
   * Socket.IO (`iso:download:*`) when a socket is connected. Throws synchronously
   * only for the "cannot start" cases (bad OS, already running).
   */
  public start (os: string, prisma: PrismaClient, userId?: string): boolean {
    const osLower = os.toLowerCase().trim()
    const profile = resolveOsProfile(osLower)

    if (!profile) {
      throw new UserInputError(`Unknown OS "${os}".`)
    }
    if (!profile.autoDownload) {
      const hint = profile.officialDownloadUrl ? ` Download it from ${profile.officialDownloadUrl} and upload it instead.` : ''
      throw new UserInputError(`${profile.displayName} cannot be auto-downloaded.${hint}`)
    }
    if (this.inProgress.has(osLower)) {
      throw new UserInputError(`A download for ${profile.displayName} is already in progress.`)
    }

    const controller = new AbortController()
    this.aborters.set(osLower, controller)
    this.inProgress.add(osLower)
    this.status.set(osLower, { os: osLower, state: 'resolving', receivedBytes: 0, totalBytes: 0 })
    // Fire-and-forget: never await here.
    void this.run(osLower, profile, profile.autoDownload, prisma, controller, userId)
      .catch((err) => {
        debug.error(`ISO auto-download failed for ${osLower}: ${(err as Error)?.message}`)
      })
      .finally(() => {
        this.inProgress.delete(osLower)
        this.aborters.delete(osLower)
      })
    return true
  }

  private setStatus (os: string, patch: Partial<IsoDownloadState>): void {
    const cur = this.status.get(os) ?? { os, state: 'idle', receivedBytes: 0, totalBytes: 0 }
    this.status.set(os, { ...cur, ...patch })
  }

  private async run (os: string, profile: OsProfile, spec: AutoDownloadSpec, prisma: PrismaClient, controller: AbortController, userId?: string): Promise<void> {
    const events = ISOEventManager.getInstance()
    const canonicalName = `${os}.iso`
    const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
    const isoDir = path.join(baseDir, 'iso')
    const tempDir = path.join(baseDir, 'temp')
    const tmpPath = path.join(tempDir, `${os}.iso.download`)
    const finalPath = path.join(isoDir, canonicalName)

    try {
      await fsp.mkdir(isoDir, { recursive: true })
      await fsp.mkdir(tempDir, { recursive: true })

      this.setStatus(os, { state: 'resolving' })
      debug.info(`Resolving latest ${profile.displayName} image (${spec.strategy})…`)
      const resolved = await this.resolve(spec)
      debug.info(`Downloading ${resolved.sourceFilename} from ${resolved.url}`)

      this.setStatus(os, { state: 'downloading' })
      await this.downloadTo(resolved.url, tmpPath, canonicalName, events, os, controller.signal, userId)

      this.setStatus(os, { state: 'verifying' })
      // Verify checksum before trusting the file.
      const actualSha = await sha256File(tmpPath)
      if (actualSha.toLowerCase() !== resolved.sha256.toLowerCase()) {
        throw new Error(`Checksum mismatch for ${resolved.sourceFilename} (expected ${resolved.sha256.slice(0, 12)}…, got ${actualSha.slice(0, 12)}…). The download may be corrupt or the published index changed.`)
      }

      // Content validation (same checks the upload route runs).
      const validation = os === 'ubuntu'
        ? await validateUbuntuDesktopISO(tmpPath)
        : os === 'fedora'
          ? await validateFedoraNetinstallISO(tmpPath)
          : { valid: true }
      if (!validation.valid) {
        throw new Error(validation.error || `Downloaded ${profile.displayName} image failed content validation.`)
      }

      this.setStatus(os, { state: 'registering' })
      // Atomically publish into the canonical flat dir (never overwrite a good ISO
      // with a partial: we only rename AFTER checksum+content verification).
      await fsp.rename(tmpPath, finalPath)

      const size = (await fsp.stat(finalPath)).size
      const isoService = ISOService.getInstance()
      await isoService.registerISO(canonicalName, os, size, finalPath)

      // Populate the previously-unused checksum + downloadUrl columns.
      const iso = await prisma.iSO.update({
        where: { filename: canonicalName },
        data: { checksum: actualSha, downloadUrl: resolved.url, lastVerified: new Date() }
      })

      this.setStatus(os, { state: 'done' })
      debug.info(`${profile.displayName} ISO ready at ${finalPath}`)
      events.emitDownloadComplete(iso, userId)
    } catch (err) {
      // Clean up any partial file so it can't shadow a good ISO.
      await fsp.rm(tmpPath, { force: true }).catch(() => {})

      const aborted = controller.signal.aborted || (err as Error)?.name === 'AbortError'
      if (aborted) {
        this.setStatus(os, { state: 'cancelled', error: undefined })
        debug.info(`ISO auto-download for ${os} cancelled`)
        events.emitDownloadFailed(canonicalName, os, 'Download cancelled.', userId)
        return
      }
      const message = (err as Error)?.message || 'Unknown error'
      const hint = profile.officialDownloadUrl ? ` You can download it manually from ${profile.officialDownloadUrl} and upload it.` : ''
      this.setStatus(os, { state: 'failed', error: `${message}${hint}` })
      debug.error(`ISO auto-download for ${os} failed: ${message}`)
      events.emitDownloadFailed(canonicalName, os, `${message}${hint}`, userId)
    }
  }

  /** Resolve the concrete ISO URL + expected sha256 for a distro/version. */
  private async resolve (spec: AutoDownloadSpec): Promise<ResolvedDownload> {
    switch (spec.strategy) {
      case 'ubuntu-releases':
        return await resolveUbuntu(spec)
      case 'fedora-releases':
        return await resolveFedora(spec)
      default:
        throw new Error(`Unsupported auto-download strategy "${spec.strategy}".`)
    }
  }

  /** Stream `url` to `tmpPath`, updating live status + emitting throttled socket progress. */
  private async downloadTo (url: string, tmpPath: string, canonicalName: string, events: ISOEventManager, os: string, signal: AbortSignal, userId?: string): Promise<void> {
    const res = await fetch(url, { redirect: 'follow', signal })
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: HTTP ${res.status} ${res.statusText} for ${url}`)
    }
    const total = Number(res.headers.get('content-length') || 0)
    this.setStatus(os, { totalBytes: total, receivedBytes: 0 })
    let received = 0
    let lastEmit = 0
    const self = this

    const counter = new Transform({
      transform (chunk: Buffer, _enc, cb) {
        received += chunk.length
        self.setStatus(os, { receivedBytes: received })
        const now = Date.now()
        // Throttle socket emits to ~1/750ms so a multi-GB download doesn't flood it.
        if (total > 0 && now - lastEmit > 750) {
          lastEmit = now
          events.emitDownloadProgress(canonicalName, received, total, userId)
        }
        cb(null, chunk)
      }
    })

    // Aborting the fetch (via `signal` above) errors res.body → the wrapped Node
    // Readable errors → this pipeline rejects with an AbortError. No need to also
    // thread `signal` into pipeline (avoids an overload/typing edge).
    await pipeline(Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]), counter, fs.createWriteStream(tmpPath))
    this.setStatus(os, { receivedBytes: total || received })
    if (total > 0) events.emitDownloadProgress(canonicalName, total, total, userId)
  }
}

// ── Distro-specific index resolution ─────────────────────────────────────────

/**
 * Ubuntu: AUTO-DETECT the version. The releases index lists version dirs
 * (14.04/ … 26.04/). We prefer the newest LTS (even-year .04), then read that
 * dir's LISTING (not just SHA256SUMS — which can reference an already-pruned
 * point release, e.g. 24.04.3 → 403) to pick a desktop-amd64 image that actually
 * EXISTS, and take its checksum from SHA256SUMS.
 */
async function resolveUbuntu (spec: AutoDownloadSpec): Promise<ResolvedDownload> {
  const base = spec.baseUrl.replace(/\/+$/, '')
  const indexHtml = await fetchText(base + '/')
  const all = uniq(matchAll(indexHtml, /href="(\d+\.\d+)\/"/gi)).filter((v) => aboveFloor(v, spec.minVersion))
  const lts = all.filter(isUbuntuLts).sort(cmpDottedDesc)
  const ordered = lts.length ? lts : all.slice().sort(cmpDottedDesc)

  for (const v of ordered) {
    const dir = `${base}/${v}/`
    let listing: string
    try { listing = await fetchText(dir) } catch { continue }
    // Only files present in the directory listing exist (avoids pruned-release 403s).
    const existing = uniq(matchAll(listing, /ubuntu-[\d.]+-desktop-amd64\.iso/gi))
    if (existing.length === 0) continue
    const file = existing.sort(cmpFileDesc)[0] // newest point release that exists
    let sha: string | undefined
    try {
      const sums = await fetchText(dir + 'SHA256SUMS')
      for (const line of sums.split('\n')) {
        const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
        if (m && m[2] === file) { sha = m[1]; break }
      }
    } catch { /* try next version */ }
    if (!sha) continue
    return { url: dir + file, sha256: sha, sourceFilename: file }
  }
  throw new Error('No downloadable Ubuntu desktop image found on the releases index.')
}

/**
 * Fedora: AUTO-DETECT the version from the (master) releases index, newest first.
 * Read the Server/x86_64/iso listing for a netinst image + its CHECKSUM (GPG-signed,
 * `SHA256 (<file>) = <hash>`). Server netinst is kickstart-capable (unlike Live).
 */
async function resolveFedora (spec: AutoDownloadSpec): Promise<ResolvedDownload> {
  const base = spec.baseUrl.replace(/\/+$/, '')
  const indexHtml = await fetchText(base + '/')
  const versions = uniq(matchAll(indexHtml, /href="(\d+)\/"/gi))
    .filter((v) => aboveFloor(v, spec.minVersion))
    .sort((a, b) => Number(b) - Number(a))

  for (const v of versions) {
    const dir = `${base}/${v}/Server/x86_64/iso/`
    let listing: string
    try { listing = await fetchText(dir) } catch { continue }
    const isoMatch = listing.match(new RegExp(`Fedora-Server-netinst-x86_64-${escapeRe(v)}[^"'<>\\s]*\\.iso`, 'i'))
    if (!isoMatch) continue
    const isoFile = isoMatch[0]
    const checksumMatch = listing.match(new RegExp(`Fedora-Server-${escapeRe(v)}[^"'<>\\s]*-x86_64-CHECKSUM`, 'i'))
    if (!checksumMatch) continue
    let checksumText: string
    try { checksumText = await fetchText(dir + checksumMatch[0]) } catch { continue }
    const shaLine = checksumText.split('\n').find((l) => l.includes(isoFile) && /sha256/i.test(l))
    const sha = shaLine?.match(/=\s*([0-9a-f]{64})/i)?.[1]
    if (!sha) continue
    return { url: dir + isoFile, sha256: sha, sourceFilename: isoFile }
  }
  throw new Error('No downloadable Fedora Server netinst image found on the releases index.')
}

// ── version helpers ──────────────────────────────────────────────────────────

function matchAll (text: string, re: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = g.exec(text)) !== null) out.push(m[1] ?? m[0])
  return out
}

function uniq (arr: string[]): string[] {
  return Array.from(new Set(arr))
}

/** Ubuntu LTS = even-numbered year + `.04` (20.04, 22.04, 24.04, 26.04). */
function isUbuntuLts (v: string): boolean {
  const [major, minor] = v.split('.')
  return minor === '04' && Number(major) % 2 === 0
}

/** Descending compare for dotted numeric versions ("26.04" > "24.04" > "25.10"? no: 26>25). */
function cmpDottedDesc (a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** Descending by the version embedded in an ubuntu-<ver>-desktop file. */
function cmpFileDesc (a: string, b: string): number {
  const va = a.match(/ubuntu-([\d.]+)-/)?.[1] ?? '0'
  const vb = b.match(/ubuntu-([\d.]+)-/)?.[1] ?? '0'
  return cmpDottedDesc(va, vb)
}

function aboveFloor (v: string, floor?: string): boolean {
  if (!floor) return true
  return cmpDottedDesc(v, floor) <= 0 // v >= floor
}

// ── small helpers ────────────────────────────────────────────────────────────

async function sha256File (p: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(p), hash)
  return hash.digest('hex')
}

async function fetchText (url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`)
  return await res.text()
}

function escapeRe (s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default IsoDownloadService
