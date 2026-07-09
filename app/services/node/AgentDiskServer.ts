import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import express, { type Request, type RequestHandler, type Response } from 'express'
import { requireClientCert } from './clusterMtls'
import { createSparseStream, receiveSparse } from './sparseDisk'

/**
 * Multi-node Phase 3 (cold migration): the node-agent side of the disk wire.
 *
 * The master's AgentStorageMigrationAdapter moves a stopped VM's qcow2 between
 * nodes by PULLING it from the source agent and PUSHING it to the target agent.
 * This router exposes those operations on the agent's existing mTLS verb server:
 *
 *   POST /agent/disk/stat   {path, sha256?}   → { exists, size, allocated, sha256? }  (sha256 defaults on; opt out for a cheap metadata-only stat)
 *   GET  /agent/disk/pull?path=…              → 200 octet-stream of the file
 *   POST /agent/disk/push?path=…&sha256=…     → write (atomic) + verify, { size, sha256 }
 *   POST /agent/disk/delete {path}            → unlink (source cleanup after verify)
 *
 * SECURITY (defence in depth):
 *   - mTLS + the master's verified client cert (pinned to masterCn) — only the
 *     master may touch node disks.
 *   - Every path is confined to the node's diskDir via LocalDiskStore: a path that
 *     escapes the directory (traversal / absolute elsewhere) is rejected 400, so a
 *     bug in the caller can never read or clobber files outside the disk store.
 *   - push writes to a temp file and only renames into place after the sha256
 *     matches, so the target path is never a half-written image (invariant I2).
 */

/** A filesystem-confined store of VM disk images under a single directory. */
export class LocalDiskStore {
  private readonly root: string
  constructor (diskDir: string) {
    this.root = path.resolve(diskDir)
  }

  /**
   * Resolve `p` and assert it lives inside the disk dir. Accepts an absolute path
   * (the disk paths the master holds are absolute and identical across nodes) or a
   * bare filename. Throws on any path that escapes the store.
   */
  resolveWithin (p: string): string {
    if (typeof p !== 'string' || p.length === 0) throw new Error('disk path is required')
    const abs = path.resolve(this.root, p)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`disk path '${p}' is outside the node disk store`)
    }
    return abs
  }

  exists (p: string): boolean {
    return fs.existsSync(this.resolveWithin(p))
  }

  size (p: string): number {
    return fs.statSync(this.resolveWithin(p)).size
  }

  /**
   * Bytes actually allocated on disk for `p` (st_blocks × 512) — the REAL payload a
   * sparse transfer must move, vs `size()` which is the apparent/virtual span (holes
   * included). Drives the target free-space guard + the receiver's data-byte cap.
   */
  allocatedBytes (p: string): number {
    return fs.statSync(this.resolveWithin(p)).blocks * 512
  }

  /**
   * Bytes currently free on the filesystem backing the disk store. The disk dir
   * may not exist yet on a node that has never run a VM, so statfs the nearest
   * EXISTING ancestor (free space is a property of the filesystem, not the dir).
   */
  freeBytes (): number {
    let dir = this.root
    while (!fs.existsSync(dir)) {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    const st = fs.statfsSync(dir)
    return st.bavail * st.bsize
  }

  async sha256 (p: string): Promise<string> {
    const abs = this.resolveWithin(p)
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(abs), hash)
    return hash.digest('hex')
  }

  createReadStream (p: string): fs.ReadStream {
    return fs.createReadStream(this.resolveWithin(p))
  }

  /**
   * Open `p` as a SPARSE wire stream (only non-zero regions, framed + hashed — see
   * sparseDisk.ts). The returned stream owns the fd and closes it on end/destroy.
   */
  async createSparseReadStream (p: string): Promise<Readable> {
    const abs = this.resolveWithin(p)
    const fd = await fsp.open(abs, 'r')
    const { size } = await fd.stat()
    return createSparseStream(fd, size)
  }

  /**
   * Reconstruct a SPARSE wire stream (`src`) into `p` atomically (temp file →
   * ftruncate to `logicalSize` so trailing holes exist → write extents → fsync →
   * rename → fsync dir), returning the real bytes written. `dataByteCap` bounds the
   * cumulative extent payload so a peer can't smuggle an unbounded body past the
   * free-space guard. The trailer sha256 is verified inside receiveSparse.
   */
  async writeFromSparse (
    p: string,
    src: NodeJS.ReadableStream,
    opts: { logicalSize: number, dataByteCap: number }
  ): Promise<{ size: number, dataBytes: number }> {
    const abs = this.resolveWithin(p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.part-${process.pid}-${Date.now()}`
    const fh = await fsp.open(tmp, 'w')
    let dataBytes = 0
    try {
      await fh.truncate(opts.logicalSize)
      const result = await receiveSparse(src as AsyncIterable<Buffer>, {
        fd: fh,
        logicalSize: opts.logicalSize,
        dataByteCap: opts.dataByteCap
      })
      dataBytes = result.dataBytes
      await fh.sync() // durability P1/P2: the master reclaims the source on our ok
    } catch (err) {
      try { await fh.close() } catch { /* already closed */ }
      fs.rmSync(tmp, { force: true })
      throw err
    }
    await fh.close()
    fs.renameSync(tmp, abs)
    const dirFd = fs.openSync(path.dirname(abs), 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
    return { size: opts.logicalSize, dataBytes }
  }

  /**
   * Stream `src` into `p` atomically (temp file → fsync-on-close → rename), returning the
   * sha256 of what was written. When `maxBytes` is given the stream is aborted the moment
   * the cumulative body exceeds that ceiling — a caller that lies about (or omits) its size
   * can otherwise write an unbounded body that fills the node filesystem and ENOSPC-fails
   * co-located VMs. On abort pipeline() rejects and the temp file is rm'd in the catch below.
   */
  async writeFrom (p: string, src: NodeJS.ReadableStream, maxBytes?: number): Promise<{ size: number, sha256: string }> {
    const abs = this.resolveWithin(p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.part-${process.pid}-${Date.now()}`
    const hash = crypto.createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform (chunk: Buffer, _enc, cb) {
        size += chunk.length
        if (maxBytes !== undefined && size > maxBytes) { cb(new Error('push body exceeds declared size')); return }
        hash.update(chunk); cb(null, chunk)
      }
    })
    // DURABILITY (audit P1/P2): in the cross-node migration path the master deletes
    // the SOURCE disk on the strength of this push returning ok — so the target bytes
    // must be on STABLE storage first, not merely in the OS page cache. A target-host
    // crash inside the writeback window would otherwise lose the only surviving copy.
    // fsync the file data (own the fd so autoClose can't close it before the fsync),
    // then fsync the parent directory so the rename entry itself survives a crash.
    const fd = fs.openSync(tmp, 'w')
    try {
      await pipeline(src, meter, fs.createWriteStream(tmp, { fd, autoClose: false }))
      fs.fsyncSync(fd)
    } catch (err) {
      try { fs.closeSync(fd) } catch { /* already closed */ }
      fs.rmSync(tmp, { force: true })
      throw err
    }
    try { fs.closeSync(fd) } catch { /* already closed */ }
    fs.renameSync(tmp, abs)
    const dirFd = fs.openSync(path.dirname(abs), 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
    return { size, sha256: hash.digest('hex') }
  }

  async unlink (p: string): Promise<boolean> {
    const abs = this.resolveWithin(p)
    if (!fs.existsSync(abs)) return false
    await fs.promises.unlink(abs)
    return true
  }
}

export interface AgentDiskServerOptions {
  store: LocalDiskStore
  /** 'mtls' (default) requires the master's verified client cert, pinned to masterCn. */
  auth?: 'mtls' | 'none'
  masterCn?: string
}

/** Build the agent's disk router. Mount at `/agent` so paths are `/agent/disk/*`. */
export function createAgentDiskRouter (opts: AgentDiskServerOptions): express.Router {
  const router = express.Router()
  const store = opts.store
  const auth: RequestHandler = opts.auth === 'none'
    ? (_req, _res, next) => next()
    : requireClientCert(opts.masterCn)

  const badPath = (res: Response, err: unknown): void => {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }

  const truthyParam = (v: unknown): boolean => v === '1' || v === 'true'

  // Parse a query param that must be a SINGLE positive integer (rejects arrays,
  // missing, non-finite, ≤0). Used for the sparse push's size/dataSize.
  const singlePositiveInt = (v: unknown): number | null => {
    if (Array.isArray(v) || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  }

  // Capability probe: the master checks this BEFORE choosing the sparse wire so a
  // not-yet-upgraded node cleanly falls back to raw (old agents 404 here). Kept
  // trivial + unauthenticated-safe (still behind mTLS/token `auth`) — it leaks nothing.
  router.post('/disk/capabilities', express.json({ limit: '4kb' }), auth, (_req: Request, res: Response) => {
    res.json({ ok: true, sparse: true })
  })

  router.post('/disk/stat', express.json({ limit: '64kb' }), auth, async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {}
      const p = body.path as string
      const abs = store.resolveWithin(p)
      if (!fs.existsSync(abs)) { res.json({ ok: true, exists: false }); return }
      // `allocated` (real bytes) lets the master size a sparse pull's free-space guard
      // and data cap; `size` stays the apparent/logical span used to ftruncate. Both are
      // O(1) fs.statSync reads.
      //
      // sha256 is a WHOLE-FILE read (seconds→minutes for a multi-GiB qcow2) and would
      // otherwise trip the master's 15s mTLS request deadline ("cluster mTLS request
      // deadline exceeded") on a node→master transfer. Compute it ONLY when the caller
      // asks: the sparse wire proves integrity with the stream's own trailer and passes
      // `sha256: false`, so it never pays; the raw transfer + backup staging still verify
      // against it and get it by default. Default true keeps pre-flag callers working.
      const wantSha = body.sha256 !== false
      const meta: { ok: true, exists: true, size: number, allocated: number, sha256?: string } = {
        ok: true, exists: true, size: store.size(p), allocated: store.allocatedBytes(p)
      }
      if (wantSha) meta.sha256 = await store.sha256(p)
      res.json(meta)
    } catch (err) { badPath(res, err) }
  })

  router.get('/disk/pull', auth, async (req: Request, res: Response) => {
    try {
      const p = String(req.query.path ?? '')
      const abs = store.resolveWithin(p)
      if (!fs.existsSync(abs)) { res.status(404).json({ ok: false, error: 'disk not found' }); return }
      res.setHeader('content-type', 'application/octet-stream')
      // Sparse pull: stream only the non-zero regions (framed + hashed). The length is
      // not known up front, so it goes out chunked (no content-length). The master
      // reconstructs via writeFromSparse and verifies the trailer hash.
      let rs: Readable
      if (truthyParam(req.query.sparse)) {
        rs = await store.createSparseReadStream(p)
      } else {
        res.setHeader('content-length', String(store.size(p)))
        rs = store.createReadStream(p)
      }
      // Use pipeline() (not raw rs.pipe): pipe() does NOT destroy the source when the
      // response errors or the client aborts mid-transfer, leaking the open file fd on
      // the long-lived agent. pipeline() tears down rs on any res error / premature
      // close and routes read errors through the same catch, so a flurry of aborted
      // migrations can't exhaust the node's descriptor limit.
      void pipeline(rs, res).catch((err) => { if (!res.headersSent) res.status(500); res.destroy(err) })
    } catch (err) { badPath(res, err) }
  })

  router.post('/disk/push', auth, async (req: Request, res: Response) => {
    try {
      const p = String(req.query.path ?? '')
      store.resolveWithin(p) // validate before consuming the body

      // ── Sparse push (negotiated via /disk/capabilities) ─────────────────────────
      // Only the non-zero regions arrive, framed + integrity-trailer'd (sparseDisk.ts).
      // `size` is the logical/apparent span (ftruncate target so trailing holes exist);
      // `dataSize` is the real allocated bytes, which drives BOTH the free-space guard
      // and the receiver's cumulative data cap. No sha256 param — integrity is the
      // stream's own trailer hash, verified inside receiveSparse.
      if (truthyParam(req.query.sparse)) {
        const logicalSize = singlePositiveInt(req.query.size)
        const dataSize = singlePositiveInt(req.query.dataSize)
        if (logicalSize == null) { res.status(400).json({ ok: false, error: 'size query param is required and must be a positive number' }); return }
        if (dataSize == null) { res.status(400).json({ ok: false, error: 'dataSize query param is required and must be a positive number' }); return }
        const needBytes = Math.ceil(dataSize * 1.05)
        const free = store.freeBytes()
        if (free < needBytes) {
          res.status(507).json({ ok: false, error: `insufficient disk space on target: need ~${dataSize} bytes, ${free} free` })
          return
        }
        // Bound the cumulative payload by the LOGICAL span — you can't have more non-zero
        // blocks than the whole image. `dataSize` (allocated) only sizes the free-space
        // guard above: the codec's 64 KiB block granularity can push real bytes modestly
        // above the FS's finer-grained st_blocks, so a dataSize-derived cap would risk
        // falsely rejecting a legit transfer. A genuine disk-fill still fails safely at
        // write time (ENOSPC) with the temp file reclaimed. This mirrors the raw path,
        // which likewise bounds by the declared apparent size.
        const written = await store.writeFromSparse(p, req, { logicalSize, dataByteCap: logicalSize })
        res.json({ ok: true, sparse: true, ...written })
        return
      }

      // ── Raw push (legacy / pre-sparse peers) ────────────────────────────────────
      // The honest master always declares BOTH the exact byte size and the sha256 of the
      // image it pushes (see AgentStorageMigrationAdapter.pushUrl). Require and strictly
      // validate both BEFORE reading a single body byte: an omitted/understated size or a
      // missing integrity target is exactly how a rogue caller (holding the master cert)
      // would slip an unbounded body past the free-space guard and ENOSPC-fail co-located VMs.
      if (Array.isArray(req.query.sha256) || req.query.sha256 == null || String(req.query.sha256).length === 0) {
        res.status(400).json({ ok: false, error: 'sha256 query param is required' })
        return
      }
      const expected = String(req.query.sha256)
      if (Array.isArray(req.query.size)) {
        res.status(400).json({ ok: false, error: 'size query param must be a single value' })
        return
      }
      const expectedSize = req.query.size != null ? Number(req.query.size) : NaN
      if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
        res.status(400).json({ ok: false, error: 'size query param is required and must be a positive number' })
        return
      }
      // Refuse before consuming the body if the target FS cannot hold the incoming
      // disk (with a 5% margin) — otherwise a too-big migration fills the node disk
      // and ENOSPC-fails OTHER VMs' writes that share it (507 Insufficient Storage).
      const maxBytes = Math.ceil(expectedSize * 1.05)
      const free = store.freeBytes()
      if (free < maxBytes) {
        res.status(507).json({ ok: false, error: `insufficient disk space on target: need ~${expectedSize} bytes, ${free} free` })
        return
      }
      // …and enforce that ceiling DURING the write, not just against the declared value:
      // writeFrom aborts + rm's the temp file the instant the body overruns maxBytes.
      const written = await store.writeFrom(p, req, maxBytes)
      if (expected !== written.sha256) {
        await store.unlink(p)
        res.status(422).json({ ok: false, error: 'sha256 mismatch on received disk', expected, actual: written.sha256 })
        return
      }
      res.json({ ok: true, ...written })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Caller faults get a 4xx: an over-cap raw body (413), or a malformed/overlapping/
      // tampered sparse stream (422). Everything else is a server-side 500.
      let status = 500
      if (/exceeds declared size/.test(msg)) status = 413
      else if (/exceed declared allocation cap/.test(msg)) status = 413
      else if (/^sparse disk stream:/.test(msg)) status = 422
      res.status(status).json({ ok: false, error: msg })
    }
  })

  router.post('/disk/delete', express.json({ limit: '64kb' }), auth, async (req: Request, res: Response) => {
    try {
      const p = (req.body ?? {}).path as string
      store.resolveWithin(p)
      const deleted = await store.unlink(p)
      res.json({ ok: true, deleted })
    } catch (err) { badPath(res, err) }
  })

  return router
}
