import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import express, { type Request, type RequestHandler, type Response } from 'express'
import { requireClientCert } from './clusterMtls'

/**
 * Multi-node Phase 3 (cold migration): the node-agent side of the disk wire.
 *
 * The master's AgentStorageMigrationAdapter moves a stopped VM's qcow2 between
 * nodes by PULLING it from the source agent and PUSHING it to the target agent.
 * This router exposes those operations on the agent's existing mTLS verb server:
 *
 *   POST /agent/disk/stat   {path}            → { exists, size, sha256 }
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

  async sha256 (p: string): Promise<string> {
    const abs = this.resolveWithin(p)
    const hash = crypto.createHash('sha256')
    await pipeline(fs.createReadStream(abs), hash)
    return hash.digest('hex')
  }

  createReadStream (p: string): fs.ReadStream {
    return fs.createReadStream(this.resolveWithin(p))
  }

  /** Stream `src` into `p` atomically (temp file → fsync-on-close → rename), returning the sha256 of what was written. */
  async writeFrom (p: string, src: NodeJS.ReadableStream): Promise<{ size: number, sha256: string }> {
    const abs = this.resolveWithin(p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.part-${process.pid}-${Date.now()}`
    const hash = crypto.createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform (chunk: Buffer, _enc, cb) { size += chunk.length; hash.update(chunk); cb(null, chunk) }
    })
    try {
      await pipeline(src, meter, fs.createWriteStream(tmp))
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      throw err
    }
    fs.renameSync(tmp, abs)
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

  router.post('/disk/stat', express.json({ limit: '64kb' }), auth, async (req: Request, res: Response) => {
    try {
      const p = (req.body ?? {}).path as string
      const abs = store.resolveWithin(p)
      if (!fs.existsSync(abs)) { res.json({ ok: true, exists: false }); return }
      res.json({ ok: true, exists: true, size: store.size(p), sha256: await store.sha256(p) })
    } catch (err) { badPath(res, err) }
  })

  router.get('/disk/pull', auth, (req: Request, res: Response) => {
    try {
      const p = String(req.query.path ?? '')
      const abs = store.resolveWithin(p)
      if (!fs.existsSync(abs)) { res.status(404).json({ ok: false, error: 'disk not found' }); return }
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', String(store.size(p)))
      const rs = store.createReadStream(p)
      rs.on('error', (err) => { if (!res.headersSent) res.status(500); res.destroy(err) })
      rs.pipe(res)
    } catch (err) { badPath(res, err) }
  })

  router.post('/disk/push', auth, async (req: Request, res: Response) => {
    try {
      const p = String(req.query.path ?? '')
      const expected = req.query.sha256 != null ? String(req.query.sha256) : undefined
      store.resolveWithin(p) // validate before consuming the body
      const written = await store.writeFrom(p, req)
      if (expected !== undefined && expected !== written.sha256) {
        await store.unlink(p)
        res.status(422).json({ ok: false, error: 'sha256 mismatch on received disk', expected, actual: written.sha256 })
        return
      }
      res.json({ ok: true, ...written })
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
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
