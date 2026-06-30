import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { Readable } from 'node:stream'
import { clusterClientTlsOptions, type ClusterIdentity } from './clusterMtls'

/**
 * Multi-node Phase 3 (cold migration): STREAMING mTLS transport for moving a VM's
 * disk between nodes, byte-for-byte, without buffering whole qcow2 images in
 * memory. The JSON ops channel (httpsJsonPost) caps the body at 16 MiB — wrong for
 * multi-GB disks — so disk transfer gets its own streaming GET/POST that pipe
 * directly to/from the filesystem.
 *
 * Both directions reuse clusterClientTlsOptions: present the master's client cert,
 * verify the chain against the CA, AND pin the target agent's leaf CN to its node
 * name (a rogue node's CA-signed cert is rejected). Only the master ever calls
 * these — the agent disk endpoints require the master's verified client cert.
 */

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000 // 1h: a large cold disk copy may run long

/**
 * Open a streaming GET over mTLS and resolve with the live response stream once
 * the 2xx headers arrive (the caller pipes the body to disk). Rejects on a
 * non-2xx status (draining a bounded error body first) or any transport error.
 */
export function streamGetOverMtls (
  url: string,
  identity: ClusterIdentity,
  expectedCn: string,
  opts: { timeoutMs?: number } = {}
): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch (e) { reject(e as Error); return }

    let settled = false
    const settle = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(deadline); fn() } }

    const req = https.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        ...clusterClientTlsOptions(identity, expectedCn)
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          // Drain a bounded error body so the message is useful, then reject.
          const chunks: Buffer[] = []
          let total = 0
          res.on('data', (c: Buffer) => { if (total < 64 * 1024) { total += c.length; chunks.push(c) } })
          res.on('end', () => settle(() => reject(new Error(`disk pull failed (${status}): ${Buffer.concat(chunks).toString('utf8')}`))))
          res.on('error', (err) => settle(() => reject(err)))
          return
        }
        settle(() => resolve(res))
      }
    )
    const deadline = setTimeout(() => { req.destroy(new Error('disk pull deadline exceeded')) }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (typeof deadline.unref === 'function') deadline.unref()
    req.on('error', (err) => settle(() => reject(err)))
    req.end()
  })
}

export interface StreamPostResult { status: number, text: string }

/**
 * POST a Readable `body` over mTLS (chunked) and resolve with the status + a
 * bounded response text. The body stream is piped into the request, so a multi-GB
 * disk never lands in memory. A body-stream error aborts the request and rejects.
 */
export function streamPostOverMtls (
  url: string,
  body: Readable,
  identity: ClusterIdentity,
  expectedCn: string,
  opts: { timeoutMs?: number, maxResponseBytes?: number } = {}
): Promise<StreamPostResult> {
  return new Promise<StreamPostResult>((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch (e) { reject(e as Error); return }
    const maxBytes = opts.maxResponseBytes ?? 1024 * 1024

    let settled = false
    const settle = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(deadline); fn() } }

    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        ...clusterClientTlsOptions(identity, expectedCn),
        headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          total += c.length
          if (total > maxBytes) { req.destroy(new Error(`disk push response exceeded ${maxBytes} bytes`)); return }
          chunks.push(c)
        })
        res.on('aborted', () => settle(() => reject(new Error('disk push response aborted'))))
        res.on('error', (err) => settle(() => reject(err)))
        res.on('end', () => settle(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })))
      }
    )
    const deadline = setTimeout(() => { req.destroy(new Error('disk push deadline exceeded')) }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (typeof deadline.unref === 'function') deadline.unref()
    req.on('error', (err) => settle(() => reject(err)))
    // A read error on the source disk must tear down the in-flight push.
    body.on('error', (err) => { req.destroy(err instanceof Error ? err : new Error(String(err))) })
    body.pipe(req)
  })
}
