import logger from '@main/logger'
import express, { Express, Request, Response, NextFunction } from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import cors, { CorsOptions } from 'cors'
import timeout from 'connect-timeout'
import { Server } from 'node:http'

// Constants
const ONE_HOUR_MS = 60 * 60 * 1000
// Global JSON/urlencoded body cap. Large ISO uploads stream to disk via multer
// (routes/isoUpload.ts) and never traverse body-parser, so this stays small to
// keep the memory-exhaustion surface bounded. Overridable via MAX_BODY_SIZE.
const BODY_LIMIT = process.env.MAX_BODY_SIZE || '25mb'

/**
 * Build the CORS origin/credentials policy from ALLOWED_ORIGINS, shared by the
 * global middleware and the /graphql mount so both enforce the same allowlist.
 * Security: never emit `origin: '*'` together with `credentials: true`, and in
 * production fail closed (deny cross-origin) when no allowlist is configured —
 * but never throw at boot.
 */
export const buildCorsOptions = (): CorsOptions => {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowed.length > 0) {
    return { origin: allowed, credentials: true }
  }

  if (process.env.NODE_ENV === 'production') {
    logger.warn('⚠️ ALLOWED_ORIGINS is not set in production — denying all cross-origin requests. Set ALLOWED_ORIGINS to a comma-separated allowlist to enable browser clients.')
    return { origin: false, credentials: false }
  }

  // Non-production: reflect any origin for local dev tooling, but WITHOUT
  // credentials so we never ship the '*'+credentials combination.
  return { origin: true, credentials: false }
}

/**
 * Minimal in-house per-IP fixed-window rate limiter. OPT-IN and OFF BY DEFAULT
 * (only mounted when RATE_LIMIT_ENABLED === '1'), so current production
 * behavior is unchanged. Generous, env-tunable limits. WebSocket upgrades never
 * traverse Express middleware, so GraphQL subscriptions are unaffected. This is
 * a coarse flood/brute-force blunt instrument, not a substitute for per-account
 * lockout in the login resolver.
 */
const createRateLimiter = (): ((req: Request, res: Response, next: NextFunction) => void) => {
  const windowMs = (() => { const n = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '', 10); return Number.isFinite(n) && n > 0 ? n : 60_000 })()
  const maxReq = (() => { const n = parseInt(process.env.RATE_LIMIT_MAX ?? '', 10); return Number.isFinite(n) && n > 0 ? n : 300 })()
  const buckets = new Map<string, { count: number, resetAt: number }>()

  // Evict expired buckets so the map cannot grow unbounded under IP churn.
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [ip, b] of buckets) if (b.resetAt <= now) buckets.delete(ip)
  }, windowMs)
  sweeper.unref?.()

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    let bucket = buckets.get(ip)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(ip, bucket)
    }
    bucket.count++
    if (bucket.count > maxReq) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      res.status(429).json({ error: 'Too many requests' })
      return
    }
    next()
  }
}

export const configureServer = (app: Express, httpServer: Server): void => {
  // Configure socket timeouts and logging
  configureSocketHandling(httpServer)

  // Configure express middleware
  configureMiddleware(app)
}

const configureSocketHandling = (httpServer: Server): void => {
  httpServer.on('connection', (socket) => {
    socket.setTimeout(ONE_HOUR_MS)
    logger.info(`[${new Date().toISOString()}] New connection established - Remote Address: ${socket.remoteAddress}`)

    socket.on('error', (error) => {
      logger.error(`[${new Date().toISOString()}] Socket error from ${socket.remoteAddress}:`, error)
    })

    socket.on('close', (hadError) => {
      logger.info(`[${new Date().toISOString()}] Connection closed from ${socket.remoteAddress} ${hadError ? 'due to error' : 'normally'}`)
    })

    socket.on('timeout', () => {
      logger.info(`[${new Date().toISOString()}] Connection timeout from ${socket.remoteAddress}`)
      socket.end()
    })
  })

  httpServer.on('error', (error) => {
    logger.error(`[${new Date().toISOString()}] Server error:`, error)
  })

  httpServer.on('clientError', (error, socket) => {
    logger.error(`[${new Date().toISOString()}] Client error:`, error)
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })
}

const configureMiddleware = (app: Express): void => {
  // Configure CORS first (origin/credentials policy centralized in buildCorsOptions)
  app.use(cors({
    ...buildCorsOptions(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: ONE_HOUR_MS / 1000 // Convert to seconds for CORS
  }))

  // Optional per-IP rate limiting — opt-in, off by default, never in tests.
  if (process.env.RATE_LIMIT_ENABLED === '1' && process.env.NODE_ENV !== 'test') {
    app.use(createRateLimiter())
    logger.info('🛡️ Per-IP rate limiting enabled')
  }

  // Configure static file serving from public directory
  const publicPath = path.resolve(process.cwd(), 'public')
  app.use(express.static(publicPath, {
    maxAge: '7d', // Cache static files for 7 days (immutable assets)
    index: false, // Prevent directory listing
    dotfiles: 'ignore' // Ignore dotfiles for security
  }))
  logger.info(`[${new Date().toISOString()}] Static file serving configured: ${publicPath}`)

  // Body parsers buffer the whole request in memory before parsing, so keep the
  // cap small; large ISO uploads use the streaming multer disk-storage router.
  app.use(bodyParser.json({ limit: BODY_LIMIT }))
  app.use(bodyParser.urlencoded({ limit: BODY_LIMIT, extended: true }))

  // Add global timeout middleware
  app.use(timeout(ONE_HOUR_MS))

  // Add global error handler for timeouts
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err.name === 'TimeoutError') {
      res.status(408).json({ error: 'Request timeout' })
    } else {
      next(err)
    }
  })
}
