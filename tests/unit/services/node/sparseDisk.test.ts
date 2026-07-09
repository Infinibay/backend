import { describe, it, expect, afterEach } from '@jest/globals'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { createSparseStream, receiveSparse, SPARSE_BLOCK } from '../../../../app/services/node/sparseDisk'

/**
 * Sparse disk transfer codec (cold cross-node migration): only the non-zero regions
 * of a qcow2 cross the wire, reconstructed into a byte-identical SPARSE file on the
 * far side (holes stay holes), with an integrity trailer the receiver verifies. These
 * tests pin the round-trip fidelity AND the receiver's rejection of tampered /
 * truncated / oversized / out-of-bounds streams.
 */

const tmpFiles: string[] = []
function tmp (tag: string): string {
  const p = path.join(os.tmpdir(), `sparse-test-${process.pid}-${tmpFiles.length}-${tag}`)
  tmpFiles.push(p)
  return p
}
afterEach(() => { for (const p of tmpFiles.splice(0)) fs.rmSync(p, { force: true }) })

async function sha256File (p: string): Promise<string> {
  const h = crypto.createHash('sha256')
  await new Promise<void>((res, rej) => {
    const s = fs.createReadStream(p)
    s.on('data', (c) => h.update(c)); s.on('end', () => res()); s.on('error', rej)
  })
  return h.digest('hex')
}
const allocatedBytes = (p: string): number => fs.statSync(p).blocks * 512

async function writeSparseFile (logicalSize: number, writes: Array<{ off: number, buf: Buffer }>): Promise<string> {
  const p = tmp('src')
  const fh = await fsp.open(p, 'w')
  await fh.truncate(logicalSize)
  for (const w of writes) await fh.write(w.buf, 0, w.buf.length, w.off)
  await fh.sync(); await fh.close()
  return p
}

async function toWire (src: string): Promise<Buffer> {
  const fd = await fsp.open(src, 'r')
  const { size } = await fd.stat()
  const chunks: Buffer[] = []
  for await (const c of createSparseStream(fd, size)) chunks.push(Buffer.from(c as Buffer))
  return Buffer.concat(chunks)
}

// Re-feed the wire in tiny awkward chunks to stress the parser's cross-chunk buffering.
function fragmented (buf: Buffer, chunk = 7): Readable {
  const parts: Buffer[] = []
  for (let i = 0; i < buf.length; i += chunk) parts.push(buf.subarray(i, Math.min(i + chunk, buf.length)))
  return Readable.from(parts.length ? parts : [Buffer.alloc(0)])
}

async function fromWire (wire: Buffer, logicalSize: number, cap: number): Promise<{ target: string, dataBytes: number }> {
  const target = tmp('dst')
  const fh = await fsp.open(target, 'w')
  await fh.truncate(logicalSize)
  const res = await receiveSparse(fragmented(wire) as AsyncIterable<Buffer>, { fd: fh, logicalSize, dataByteCap: cap })
  await fh.sync(); await fh.close()
  return { target, dataBytes: res.dataBytes }
}

const rnd = (n: number): Buffer => crypto.randomBytes(n)
const MiB = 1024 * 1024

describe('sparseDisk codec — round trip', () => {
  it.each([
    ['mixed regions crossing the read-chunk boundary', 90 * MiB, [
      { off: 0, buf: rnd(64 * 1024) },
      { off: 4 * MiB - 1000, buf: rnd(4000) },
      { off: 40 * MiB, buf: rnd(MiB) }
    ]],
    ['all-zero image', 10 * MiB, []],
    ['tiny non-block-aligned image', 100, [{ off: 0, buf: rnd(100) }]],
    ['data only at the trailing edge', 8 * MiB, [{ off: 8 * MiB - 4096, buf: rnd(4096) }]]
  ] as Array<[string, number, Array<{ off: number, buf: Buffer }>]>)(
    'reconstructs a byte-identical sparse file: %s',
    async (_name, logicalSize, writes) => {
      const src = await writeSparseFile(logicalSize, writes)
      const wire = await toWire(src)
      const { target, dataBytes } = await fromWire(wire, logicalSize, logicalSize)

      expect(await sha256File(target)).toBe(await sha256File(src)) // logical content identical
      expect(allocatedBytes(target)).toBeLessThanOrEqual(dataBytes + 4096) // stays sparse (± one FS block)
      expect(wire.length).toBeLessThanOrEqual(dataBytes + 64 * 1024) // wire is only the data, not the holes
    }
  )

  it('moves vastly less than the logical size for a mostly-hole image', async () => {
    const src = await writeSparseFile(90 * MiB, [{ off: 0, buf: rnd(MiB) }])
    const wire = await toWire(src)
    expect(wire.length).toBeLessThan(2 * MiB) // ~1 MiB of data, not 90 MiB
  })
})

describe('sparseDisk codec — integrity & abuse rejection', () => {
  async function goodWire (): Promise<{ wire: Buffer, logical: number }> {
    const logical = 2 * MiB
    const src = await writeSparseFile(logical, [{ off: 0, buf: rnd(64 * 1024) }])
    return { wire: await toWire(src), logical }
  }

  it('rejects a tampered data byte (trailer mismatch)', async () => {
    const { wire, logical } = await goodWire()
    const bad = Buffer.from(wire); bad[20] = bad[20] ^ 0xff
    await expect(fromWire(bad, logical, logical)).rejects.toThrow(/integrity check failed/)
  })

  it('rejects a truncated stream (missing trailer)', async () => {
    const { wire, logical } = await goodWire()
    await expect(fromWire(wire.subarray(0, wire.length - 10), logical, logical)).rejects.toThrow(/truncated stream/)
  })

  it('enforces the cumulative data-byte cap', async () => {
    const { wire, logical } = await goodWire()
    await expect(fromWire(wire, logical, 1024)).rejects.toThrow(/exceed declared allocation cap/)
  })

  it('rejects an extent beyond the declared logical size', async () => {
    const { wire } = await goodWire()
    await expect(fromWire(wire, 1000, 1000)).rejects.toThrow(/exceeds logical size/)
  })

  it('exposes a stable block size aligned to the qcow2 cluster', () => {
    expect(SPARSE_BLOCK).toBe(64 * 1024)
  })
})
