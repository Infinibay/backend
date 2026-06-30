import fs from 'fs'
import path from 'path'
import https from 'node:https'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { TLSSocket, PeerCertificate } from 'node:tls'

/**
 * Multi-node Phase 2 (2.1d): mTLS primitives for the cluster channel.
 *
 * Replaces the shared bootstrap token on the OPS channel (heartbeat / DB facade /
 * VM verbs) with per-node client certificates issued by the cluster CA. The
 * verified certificate's CN is the node's identity — derived cryptographically by
 * the TLS layer, NOT self-asserted in the request body — which closes the
 * nodeName-spoofing gap documented in routes/cluster.ts.
 *
 * Pure-ish IO helpers only: NO Prisma, NO type-graphql. Imported by both the
 * master (cluster server + master→agent client) and the node agent (agent→master
 * client + verb server), so it must stay dependency-light.
 *
 * The bootstrap ENROLLMENT channel (/cluster/enroll) deliberately stays
 * token-gated: a joining node has no certificate yet. Its MITM protection is the
 * SAS double-verification (the CA fingerprint is mixed into the 6-digit code), not
 * the transport.
 */

/** A PEM bundle identifying a cluster member for mTLS (its key + leaf cert + the CA). */
export interface ClusterIdentity {
  key: string
  cert: string
  ca: string
}

// Filenames the agent's join client (agent/join.ts) writes into INFINIBAY_CERT_DIR.
const DEFAULT_KEY_FILE = 'node-key.pem'
const DEFAULT_CERT_FILE = 'node-cert.pem'
const DEFAULT_CA_FILE = 'cluster-ca.pem'

/**
 * Load a node's mTLS identity from a directory, or null if it is not fully
 * present (key + cert + CA all required). Lets a caller decide "mTLS or token"
 * purely from whether the materials exist on disk.
 */
export function loadClusterIdentity (
  certDir: string,
  files: { key?: string, cert?: string, ca?: string } = {}
): ClusterIdentity | null {
  const keyPath = path.join(certDir, files.key ?? DEFAULT_KEY_FILE)
  const certPath = path.join(certDir, files.cert ?? DEFAULT_CERT_FILE)
  const caPath = path.join(certDir, files.ca ?? DEFAULT_CA_FILE)
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath) || !fs.existsSync(caPath)) {
    return null
  }
  return {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8'),
    ca: fs.readFileSync(caPath, 'utf8')
  }
}

/**
 * The Common Name of the peer's VERIFIED client certificate, or null when the
 * peer presented no certificate, presented one that did not validate against the
 * server's CA, or the connection is not TLS. `socket.authorized` is the TLS
 * layer's verdict on the chain (set by `requestCert: true`); we trust the CN only
 * when it is true — so a self-signed or wrong-CA cert yields null, not its CN.
 */
export function peerCommonName (socket: TLSSocket | null | undefined): string | null {
  if (!socket || typeof (socket as TLSSocket).getPeerCertificate !== 'function') return null
  if (!(socket as TLSSocket).authorized) return null
  const cert = (socket as TLSSocket).getPeerCertificate()
  const cn = cert?.subject?.CN
  return typeof cn === 'string' && cn.length > 0 ? cn : null
}

/** A request whose caller identity was established by a verified client cert. */
export interface ClusterAuthedRequest extends Request {
  clusterNodeName?: string
}

/**
 * Express middleware: require a VERIFIED client certificate and stamp its CN onto
 * `req.clusterNodeName`. Fail-closed — 401 if no valid client cert. Use on the
 * ops routes of a server started with `requestCert: true, rejectUnauthorized:
 * false` (so enrollment, which presents no cert, can still reach its own routes).
 *
 * `expectedCn`, when supplied, additionally pins the caller's CN (e.g. an agent
 * verb server accepting ONLY the master) — a CA-signed peer with a different CN is
 * rejected.
 */
export function requireClientCert (expectedCn?: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const cn = peerCommonName(req.socket as TLSSocket)
    if (!cn) {
      res.status(401).json({ error: 'a verified client certificate is required (mTLS)' })
      return
    }
    if (expectedCn !== undefined && cn !== expectedCn) {
      res.status(403).json({ error: `client certificate CN '${cn}' is not authorized` })
      return
    }
    ;(req as ClusterAuthedRequest).clusterNodeName = cn
    next()
  }
}

/** TLS server options for a cluster member that requests (but does not strictly require) a client cert. */
export function clusterServerOptions (identity: ClusterIdentity, opts: { rejectUnauthorized?: boolean } = {}): https.ServerOptions {
  return {
    key: identity.key,
    cert: identity.cert,
    ca: identity.ca,
    requestCert: true,
    // false on the master cluster server (enrollment presents no cert, gated by
    // token + middleware); true on the agent verb server (only the master, which
    // always holds a CA-signed cert, may call it).
    rejectUnauthorized: opts.rejectUnauthorized ?? false
  }
}

export interface HttpsPostResult { status: number, text: string }

export interface HttpsPostOptions {
  /**
   * The CN the SERVER's certificate must present — the specific peer we intend to
   * reach (the master's name on agent→master calls, the target node's name on
   * master→agent calls). REQUIRED: chain verification alone is insufficient
   * because every cluster leaf is serverAuth-capable and signed by the same CA, so
   * without this any enrolled node could impersonate the peer (rogue-node MITM).
   */
  expectedCn: string
  /** Absolute wall-clock deadline for the whole request (ms). Default 15000. */
  timeoutMs?: number
  /** Cap on the buffered response body (bytes). Default 16 MiB. */
  maxResponseBytes?: number
}

const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * The shared client-side TLS options for reaching a SPECIFIC cluster peer over
 * mTLS: present our `identity`, verify the chain against our CA, AND pin the peer
 * leaf's CN to `expectedCn`. Chain verification alone is insufficient — every
 * cluster leaf is serverAuth-capable and signed by the same CA, so without the CN
 * pin any enrolled node could impersonate the intended peer (rogue-node MITM).
 * The default hostname check is REPLACED (not disabled): the cert CN is a cluster
 * member name, never the dial IP, so we compare the CN to the intended peer.
 *
 * Reused by httpsJsonPost (JSON ops) and the disk-streaming transport (cold
 * migration) so both speak mTLS to a node identically.
 */
export function clusterClientTlsOptions (
  identity: ClusterIdentity,
  expectedCn: string
): Pick<https.RequestOptions, 'key' | 'cert' | 'ca' | 'checkServerIdentity'> {
  return {
    key: identity.key,
    cert: identity.cert,
    ca: identity.ca,
    checkServerIdentity: (_host: string, cert: PeerCertificate): Error | undefined => {
      const cn = cert?.subject?.CN
      if (cn !== expectedCn) {
        return new Error(`cluster peer CN '${cn ?? '<none>'}' does not match expected '${expectedCn}'`)
      }
      return undefined
    }
  }
}

/**
 * POST a JSON body over mTLS, presenting `identity` as the client certificate and
 * authenticating the SERVER by (a) chain verification against `identity.ca` AND
 * (b) pinning the server leaf's CN to `opts.expectedCn`. The default hostname
 * check is replaced (not merely disabled): the server cert CN is the cluster
 * member name, never the dial IP, so we compare the CN to the intended peer
 * instead of the host. This binds the connection to a SPECIFIC peer — a different
 * (even CA-signed) cert is rejected.
 *
 * The response is bounded (size cap + absolute deadline) and all stream error
 * paths reject cleanly, so a hostile/compromised peer cannot OOM or hang us.
 */
export function httpsJsonPost (
  url: string,
  body: unknown,
  identity: ClusterIdentity,
  opts: HttpsPostOptions
): Promise<HttpsPostResult> {
  return new Promise<HttpsPostResult>((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch (e) { reject(e as Error); return }
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

    let settled = false
    const settle = (fn: () => void): void => { if (!settled) { settled = true; clearTimeout(deadline); fn() } }

    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        // Present our cert, verify the chain against our CA, and pin the peer leaf
        // CN to the intended cluster member (a cert for a DIFFERENT member is
        // rejected even though it chains to the CA).
        ...clusterClientTlsOptions(identity, opts.expectedCn),
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          total += c.length
          if (total > maxBytes) {
            req.destroy(new Error(`cluster mTLS response exceeded ${maxBytes} bytes`))
            return
          }
          chunks.push(c)
        })
        res.on('aborted', () => settle(() => reject(new Error('cluster mTLS response aborted'))))
        res.on('error', (err) => settle(() => reject(err)))
        res.on('end', () => settle(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })))
      }
    )
    // Absolute deadline (fires regardless of socket activity, unlike an idle timeout).
    const deadline = setTimeout(() => { req.destroy(new Error('cluster mTLS request deadline exceeded')) }, opts.timeoutMs ?? 15000)
    if (typeof deadline.unref === 'function') deadline.unref() // don't keep the process alive for an in-flight RPC
    req.on('error', (err) => settle(() => reject(err)))
    req.write(payload)
    req.end()
  })
}
