import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import type { FileHandle } from 'node:fs/promises'

/**
 * Multi-node cold migration — SPARSE disk transfer codec.
 *
 * The raw disk wire (AgentDiskServer /disk/push|pull) streams a qcow2 byte-for-byte
 * including its holes. A VM disk is routinely provisioned with a large virtual size
 * (e.g. 90 GiB) but only a few GiB actually allocated; the file is sparse (or
 * metadata-preallocated), so streaming the APPARENT size pushes tens of GiB of
 * zeros over the wire. On a LAN that takes ~10 min and trips the node's HTTP
 * request timeout mid-body (408) — the migration fails even though almost nothing
 * real needed to move.
 *
 * This codec transfers ONLY the non-zero regions, reproducing an identical sparse
 * file on the target (holes stay holes — the target FS allocation matches the
 * source, not the virtual size). It is format-agnostic (works on any disk image,
 * not just qcow2): allocation is detected by scanning for zero blocks, so it needs
 * no qemu-img and no native lseek(SEEK_DATA) binding.
 *
 * ── Wire format (a single octet-stream) ────────────────────────────────────────
 *   repeated extent frames, in strictly ASCENDING, non-overlapping file order:
 *     [offset : u64 BE][length : u64 BE][data : `length` bytes]      (length > 0)
 *   terminator:
 *     [0xFFFFFFFFFFFFFFFF : u64 BE][0 : u64 BE]                      (length == 0)
 *   trailer:
 *     [sha256 : 32 bytes]  — digest of every PRECEDING extent-frame byte
 *                            (each extent's 16-byte header + its data), in order.
 *
 * Integrity is the trailer hash: the sender hashes exactly the bytes it emits for
 * the extents; the receiver hashes exactly the bytes it consumes for them. A match
 * proves the reconstructed image equals what the sender intended, end to end —
 * without either side hashing the (huge) zero holes. Holes are zero by construction
 * (the target ftruncates to the logical size and only writes the extents), so the
 * logical images are identical. The terminator + trailer are NOT hashed.
 *
 * The receiver also enforces: ascending non-overlapping offsets, every extent
 * within the declared logical size, a per-frame length ceiling, and a cumulative
 * data-byte cap (so a peer holding the master cert cannot smuggle an unbounded body
 * past the free-space guard). A stream that ends before the terminator + full
 * trailer is a truncated transfer and is rejected.
 */

export const SPARSE_BLOCK = 64 * 1024 // zero-detection granularity (qcow2 cluster size)
export const READ_CHUNK = 4 * 1024 * 1024 // source read size; bounds one frame's data length
export const MAX_FRAME_BYTES = 64 * 1024 * 1024 // receiver sanity cap on a single extent length
const HEADER_BYTES = 16
const TRAILER_BYTES = 32 // sha256
const TERMINATOR_LENGTH = BigInt(0)

const ZERO_BLOCK = Buffer.alloc(SPARSE_BLOCK)

function isZeroRegion (buf: Buffer, start: number, end: number): boolean {
  const len = end - start
  return len === SPARSE_BLOCK
    ? buf.subarray(start, end).equals(ZERO_BLOCK)
    : buf.subarray(start, end).equals(ZERO_BLOCK.subarray(0, len))
}

/**
 * Produce the sparse wire stream for the file at `absPath`. Reads the file once
 * (holes read at memory speed), emitting a frame per contiguous non-zero run and a
 * running sha256 over the emitted extent bytes, closed by a terminator + trailer.
 * The returned Readable owns the fd and closes it on completion or early destroy.
 */
export function createSparseStream (fd: FileHandle, size: number): Readable {
  async function * gen (): AsyncGenerator<Buffer> {
    const hash = crypto.createHash('sha256')
    const buf = Buffer.allocUnsafe(READ_CHUNK)

    function frame (offset: number, data: Buffer): [Buffer, Buffer] {
      const header = Buffer.allocUnsafe(HEADER_BYTES)
      header.writeBigUInt64BE(BigInt(offset), 0)
      header.writeBigUInt64BE(BigInt(data.length), 8)
      const payload = Buffer.from(data) // COPY: `buf` is reused across reads
      hash.update(header)
      hash.update(payload)
      return [header, payload]
    }

    // Own the fd: close it when the stream finishes OR is destroyed early (a rejected
    // push aborts the request → Readable.from calls .return() → this finally runs), so
    // a flurry of failed migrations can't leak descriptors on the long-lived agent.
    try {
      let pos = 0
      while (pos < size) {
        const { bytesRead } = await fd.read(buf, 0, READ_CHUNK, pos)
        if (bytesRead <= 0) break
        // Walk SPARSE_BLOCK sub-blocks, coalescing adjacent non-zero blocks into one
        // extent (bounded by this read chunk, so a frame's data never exceeds READ_CHUNK).
        let runStart = -1
        for (let off = 0; off < bytesRead; off += SPARSE_BLOCK) {
          const end = Math.min(off + SPARSE_BLOCK, bytesRead)
          if (isZeroRegion(buf, off, end)) {
            if (runStart >= 0) { const [h, d] = frame(pos + runStart, buf.subarray(runStart, off)); yield h; yield d; runStart = -1 }
          } else if (runStart < 0) {
            runStart = off
          }
        }
        if (runStart >= 0) { const [h, d] = frame(pos + runStart, buf.subarray(runStart, bytesRead)); yield h; yield d }
        pos += bytesRead
      }

      // Terminator = a header whose length field is 0. Offset field is all-ones
      // (built by byte fill to avoid an ES2020 BigInt literal at the es2016 target).
      const terminator = Buffer.alloc(HEADER_BYTES)
      terminator.fill(0xff, 0, 8)
      terminator.writeBigUInt64BE(TERMINATOR_LENGTH, 8)
      yield terminator
      yield hash.digest()
    } finally {
      await fd.close()
    }
  }

  return Readable.from(gen())
}

export interface SparseReceiveResult {
  /** Total non-zero bytes written (the real, allocated payload). */
  dataBytes: number
}

/**
 * Reconstruct a sparse file from the wire stream into the already-open `fd` (opened
 * writable; the caller ftruncates it to `logicalSize` first so trailing holes
 * exist). Verifies the trailer hash, enforces monotonic/in-bounds extents, a
 * per-frame ceiling, and a cumulative `dataByteCap`. Rejects a truncated stream.
 * Does NOT fsync/rename — the caller owns durability + atomic publish.
 */
export async function receiveSparse (
  source: AsyncIterable<Buffer>,
  opts: { fd: FileHandle, logicalSize: number, dataByteCap: number }
): Promise<SparseReceiveResult> {
  const { fd, logicalSize, dataByteCap } = opts
  const hash = crypto.createHash('sha256')

  let pending: Buffer = Buffer.alloc(0)
  type State = 'header' | 'data' | 'trailer' | 'done'
  let state: State = 'header'

  let curOffset = 0 // file offset for the extent currently being written
  let curRemaining = 0 // bytes of the current extent still to consume
  let cursor = 0 // end of the last-written extent (monotonic guard)
  let dataBytes = 0
  const trailerChunks: Buffer[] = []
  let trailerHave = 0

  const fail = (msg: string): never => { throw new Error(`sparse disk stream: ${msg}`) }

  for await (const chunk of source) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])

    let progress = true
    while (progress) {
      progress = false

      if (state === 'header') {
        if (pending.length >= HEADER_BYTES) {
          const header = pending.subarray(0, HEADER_BYTES)
          const length = header.readBigUInt64BE(8)
          if (length === TERMINATOR_LENGTH) {
            state = 'trailer'
            pending = pending.subarray(HEADER_BYTES)
            progress = true
            continue
          }
          const offsetBig = header.readBigUInt64BE(0)
          if (offsetBig > BigInt(Number.MAX_SAFE_INTEGER) || length > BigInt(Number.MAX_SAFE_INTEGER)) fail('frame field out of range')
          const offset = Number(offsetBig)
          const len = Number(length)
          if (len > MAX_FRAME_BYTES) fail(`frame length ${len} exceeds ceiling ${MAX_FRAME_BYTES}`)
          if (offset < cursor) fail(`non-monotonic/overlapping extent at ${offset} (cursor ${cursor})`)
          if (offset + len > logicalSize) fail(`extent [${offset},${offset + len}) exceeds logical size ${logicalSize}`)
          dataBytes += len
          if (dataBytes > dataByteCap) fail(`data bytes ${dataBytes} exceed declared allocation cap ${dataByteCap}`)
          hash.update(header)
          curOffset = offset
          curRemaining = len
          state = 'data'
          pending = pending.subarray(HEADER_BYTES)
          progress = true
        }
      } else if (state === 'data') {
        if (pending.length > 0) {
          const take = Math.min(curRemaining, pending.length)
          const slice = pending.subarray(0, take)
          hash.update(slice)
          await fd.write(slice, 0, take, curOffset)
          curOffset += take
          curRemaining -= take
          pending = pending.subarray(take)
          if (curRemaining === 0) { cursor = curOffset; state = 'header' }
          progress = true
        }
      } else if (state === 'trailer') {
        if (pending.length > 0) {
          const need = TRAILER_BYTES - trailerHave
          const take = Math.min(need, pending.length)
          trailerChunks.push(pending.subarray(0, take))
          trailerHave += take
          pending = pending.subarray(take)
          if (trailerHave === TRAILER_BYTES) state = 'done'
          progress = true
        }
      } else { // 'done'
        if (pending.length > 0) fail('unexpected trailing bytes after trailer')
      }
    }
  }

  if (state !== 'done') fail('truncated stream (missing terminator or trailer)')
  const declared = Buffer.concat(trailerChunks)
  const actual = hash.digest()
  if (!crypto.timingSafeEqual(declared, actual)) fail('integrity check failed (trailer sha256 mismatch)')

  return { dataBytes }
}
