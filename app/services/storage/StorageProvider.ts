import path from 'path'
import os from 'os'
import fsp from 'fs/promises'

/**
 * Storage backend abstraction.
 *
 * Today Infinibay stores VM disks as qcow2 files under a single directory
 * (`INFINIZATION_DISK_DIR`) assumed to be a byte-identical path on every node, and
 * decides whether cross-node migration must copy the disk from one honor-system
 * boolean (`INFINIBAY_SHARED_STORAGE`). This abstraction wraps that decision so
 * real NFS/Ceph backends can be added later without a rewrite. See
 * lxd/docs/setup-system/03-storage-provider-scaffolding.md.
 *
 * v1 ships `local` and `shared-mount` (both are just filesystem paths). `ceph`
 * (native RBD, no filesystem mount) is a documented stub — it is the only backend
 * that breaks the "a disk is just a path" assumption and would require changes in
 * the infinization QemuCommandBuilder to attach RBD volumes.
 */
export type StorageBackendKind = 'local' | 'shared-mount' | 'ceph'

export interface StorageVerifyResult {
  ok: boolean
  backend: StorageBackendKind
  diskDir: string
  isMountpoint?: boolean
  isNetworkFs?: boolean
  writable?: boolean
  /** Bytes available on the underlying filesystem, when known. */
  freeBytes?: number
  /** Human-readable pass/fail reason. */
  detail: string
}

export interface StorageProvider {
  readonly kind: StorageBackendKind
  /** Is the same disk reachable from every node without an explicit copy? */
  isShared(): boolean
  /** Verify the backend is actually usable on this host (mount present, writable, ...). */
  verify(diskDir: string): Promise<StorageVerifyResult>
  /**
   * Absolute path/URI the hypervisor should use for a VM's disk. For
   * local/shared-mount this is a filesystem path; future block backends (ceph)
   * override with an `rbd:pool/...` style URI.
   */
  resolveDiskLocation(diskDir: string, fileName: string): string
  /** Human summary for the setup UI / preflight. */
  describe(): string
}

// ── Shared low-level filesystem checks (used by Local + SharedMount) ──────────

/** Filesystem types treated as network/shared storage in /proc/mounts. */
const NETWORK_FS = new Set([
  'nfs', 'nfs4', 'ceph', 'cephfs', 'cifs', 'smb', 'smb3', 'smbfs',
  'glusterfs', 'fuse.glusterfs', 'fuse.ceph', 'lustre', 'ocfs2', 'gfs2'
])

/** True if the path exists (any type). */
export async function pathExists (p: string): Promise<boolean> {
  try {
    await fsp.stat(p)
    return true
  } catch {
    return false
  }
}

/** Touch+unlink a temp file inside `dir` to prove it is writable. */
export async function isWritable (dir: string): Promise<boolean> {
  // Vary the probe name by pid so concurrent verifies don't collide. (Math.random
  // is intentionally avoided — it is unavailable in some sandboxes and pid+hrtime
  // is enough uniqueness for a transient probe file.)
  const probe = path.join(dir, `.ib-storage-probe-${process.pid}-${process.hrtime.bigint().toString(36)}`)
  try {
    await fsp.writeFile(probe, 'ok')
    await fsp.unlink(probe)
    return true
  } catch {
    return false
  }
}

/** Bytes available on the filesystem backing `p`, or undefined if unknown. */
export async function freeBytes (p: string): Promise<number | undefined> {
  try {
    // fs.statfs is available on Node ≥ 18.15; bavail*bsize = space usable by an
    // unprivileged process.
    const st = await (fsp as unknown as { statfs?: (x: string) => Promise<{ bsize: number, bavail: number }> }).statfs?.(p)
    if (st && typeof st.bavail === 'number' && typeof st.bsize === 'number') {
      return st.bavail * st.bsize
    }
  } catch {
    /* not fatal */
  }
  return undefined
}

/**
 * Is `dir` a mountpoint? A directory whose st_dev differs from its parent's is a
 * mount root. Best-effort: returns false on any stat error.
 */
export async function isMountpoint (dir: string): Promise<boolean> {
  try {
    const resolved = path.resolve(dir)
    const parent = path.dirname(resolved)
    if (parent === resolved) return true // filesystem root
    const [a, b] = await Promise.all([fsp.stat(resolved), fsp.stat(parent)])
    return a.dev !== b.dev
  } catch {
    return false
  }
}

/**
 * Detect whether the filesystem backing `dir` is a network filesystem, by finding
 * the longest mountpoint in /proc/mounts that is a prefix of `dir` and checking
 * its fstype. Returns undefined when /proc/mounts is unavailable (non-Linux).
 */
export async function isNetworkFs (dir: string): Promise<boolean | undefined> {
  try {
    const raw = await fsp.readFile('/proc/mounts', 'utf8')
    const resolved = path.resolve(dir)
    let bestLen = -1
    let bestType: string | undefined
    for (const line of raw.split('\n')) {
      const parts = line.split(/\s+/)
      if (parts.length < 3) continue
      const mountPoint = parts[1].replace(/\\040/g, ' ')
      const fsType = parts[2]
      const isPrefix = resolved === mountPoint || resolved.startsWith(mountPoint.endsWith('/') ? mountPoint : mountPoint + '/')
      if (isPrefix && mountPoint.length > bestLen) {
        bestLen = mountPoint.length
        bestType = fsType.toLowerCase()
      }
    }
    if (bestType === undefined) return undefined
    return NETWORK_FS.has(bestType)
  } catch {
    return undefined
  }
}

/**
 * Full shared-storage verification, reused by the TUI (Phase A), the boot
 * preflight, and any future reconfigure UI. Checks, in order: path exists → is a
 * mountpoint → is a network filesystem → is writable. Reports which check failed.
 */
export async function verifySharedStorage (diskDir: string): Promise<StorageVerifyResult> {
  const base: StorageVerifyResult = { ok: false, backend: 'shared-mount', diskDir, detail: '' }

  if (!await pathExists(diskDir)) {
    return { ...base, detail: `Disk directory ${diskDir} does not exist. Create and mount the shared volume there first.` }
  }

  const mount = await isMountpoint(diskDir)
  const netFs = await isNetworkFs(diskDir)
  const writable = await isWritable(diskDir)
  const free = await freeBytes(diskDir)

  const result: StorageVerifyResult = {
    ...base,
    isMountpoint: mount,
    isNetworkFs: netFs,
    writable,
    freeBytes: free
  }

  if (!mount) {
    return { ...result, detail: `${diskDir} is not a mountpoint — it looks like a plain local directory, not a mounted shared volume.` }
  }
  if (netFs === false) {
    return { ...result, detail: `${diskDir} is a mountpoint but its filesystem is not a recognized network filesystem (nfs/ceph/cifs/...). It may be a local block device rather than shared storage.` }
  }
  if (!writable) {
    return { ...result, detail: `${diskDir} is not writable by this process (uid ${typeof os.userInfo === 'function' ? os.userInfo().uid : '?'}).` }
  }

  const netNote = netFs === undefined ? ' (fs type could not be confirmed on this platform)' : ''
  return { ...result, ok: true, detail: `Shared storage verified at ${diskDir}: mountpoint, network filesystem${netNote}, writable.` }
}

/** Local-disk verification: exists + writable + free space. */
export async function verifyLocalStorage (diskDir: string): Promise<StorageVerifyResult> {
  const base: StorageVerifyResult = { ok: false, backend: 'local', diskDir, detail: '' }
  if (!await pathExists(diskDir)) {
    return { ...base, detail: `Disk directory ${diskDir} does not exist yet (it will be created on first VM boot).` }
  }
  const writable = await isWritable(diskDir)
  const free = await freeBytes(diskDir)
  if (!writable) {
    return { ...base, writable, freeBytes: free, detail: `${diskDir} is not writable by this process.` }
  }
  return { ...base, ok: true, writable, freeBytes: free, detail: `Local disk storage at ${diskDir} is present and writable.` }
}
