import os from 'os'
import https from 'node:https'
import express from 'express'
import logger from '@main/logger'
import { ClusterCA } from './ClusterCA'
import { clusterServerOptions } from './clusterMtls'
import { createClusterRouter } from '../../routes/cluster'

/**
 * Multi-node Phase 2 (2.1d): the master's dedicated cluster mTLS server.
 *
 * The ops channel (heartbeat / DB facade) cannot share the main HTTP server: that
 * server is HTTP and serves browsers (GraphQL), which must NOT be asked for a
 * client certificate. mTLS therefore needs its own TLS listener. This server:
 *
 *   - presents the master's own CA-signed leaf certificate (getMasterIdentity),
 *   - REQUESTS a client cert (requestCert) but does not reject at the TLS layer
 *     (rejectUnauthorized: false), so the token-gated enrollment routes — which a
 *     joining, cert-less node must reach — still work; the ops routes enforce a
 *     verified client cert in middleware (requireClientCert) and derive the node
 *     identity from its CN.
 *
 * Opt-in via INFINIBAY_CLUSTER_MTLS=1 so single-node hosts are byte-for-byte
 * unchanged (no CA generated, no extra listener). Best-effort: a failure here must
 * never block the main server from starting.
 */

let clusterServerRef: https.Server | null = null
let certRefreshTimer: NodeJS.Timeout | null = null

// How often to re-load the master leaf and refresh the TLS context, so a renewed
// (re-minted) certificate is served WITHOUT restarting the master.
const CERT_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12h

export function startClusterMtlsServer (): https.Server | null {
  if (process.env.INFINIBAY_CLUSTER_MTLS !== '1') {
    return null
  }
  try {
    const masterName = process.env.INFINIBAY_NODE_NAME || os.hostname()
    const ca = new ClusterCA()
    const identity = ca.getMasterIdentity(masterName)

    const app = express()
    app.disable('x-powered-by')
    app.get('/cluster/health', (_req, res) => { res.json({ ok: true, role: 'master', name: masterName }) })
    app.use('/cluster', createClusterRouter({ mode: 'mtls' }))

    const server = https.createServer(clusterServerOptions(identity, { rejectUnauthorized: false }), app)
    const port = parseInt(process.env.INFINIBAY_CLUSTER_PORT || '4433', 10)
    const host = process.env.INFINIBAY_CLUSTER_HOST || '0.0.0.0'

    server.on('error', (err) => { logger.error('⚠️ Cluster mTLS server error:', err) })
    server.listen(port, host, () => {
      logger.info(`🔐 Cluster mTLS server listening on ${host}:${port} (CN=${masterName}) — ops require a client cert, enrollment is token-gated`)
    })

    // Periodically re-mint-if-needed and hot-swap the server cert (no restart).
    certRefreshTimer = setInterval(() => {
      try {
        const fresh = ca.getMasterIdentity(masterName)
        server.setSecureContext(clusterServerOptions(fresh, { rejectUnauthorized: false }))
      } catch (err) {
        logger.error('⚠️ Cluster mTLS cert refresh failed:', err)
      }
    }, CERT_REFRESH_INTERVAL_MS)
    if (typeof certRefreshTimer.unref === 'function') certRefreshTimer.unref()

    clusterServerRef = server
    return server
  } catch (error) {
    logger.error('⚠️ Failed to start cluster mTLS server (multi-node ops disabled):', error)
    return null
  }
}

export function stopClusterMtlsServer (): void {
  if (certRefreshTimer) {
    clearInterval(certRefreshTimer)
    certRefreshTimer = null
  }
  if (clusterServerRef) {
    clusterServerRef.close()
    clusterServerRef = null
  }
}
