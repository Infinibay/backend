import { Express, Request, Response, NextFunction } from 'express'
import express from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import cors from 'cors'
import timeout from 'connect-timeout'
import { Server } from 'node:http'

// Constants
const ONE_HOUR_MS = 60 * 60 * 1000
const MAX_UPLOAD_SIZE = '100gb'

export const configureServer = (app: Express, httpServer: Server): void => {
  // Configure socket timeouts and logging
  configureSocketHandling(httpServer)

  // Configure express middleware
  configureMiddleware(app)
}

const configureSocketHandling = (httpServer: Server): void => {
  httpServer.on('connection', (socket) => {
    socket.setTimeout(ONE_HOUR_MS)
    console.log(`[${new Date().toISOString()}] New connection established - Remote Address: ${socket.remoteAddress}`)

    socket.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Socket error from ${socket.remoteAddress}:`, error)
    })

    socket.on('close', (hadError) => {
      console.log(`[${new Date().toISOString()}] Connection closed from ${socket.remoteAddress} ${hadError ? 'due to error' : 'normally'}`)
    })

    socket.on('timeout', () => {
      console.log(`[${new Date().toISOString()}] Connection timeout from ${socket.remoteAddress}`)
      socket.end()
    })
  })

  httpServer.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Server error:`, error)
  })

  httpServer.on('clientError', (error, socket) => {
    console.error(`[${new Date().toISOString()}] Client error:`, error)
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })
}

const configureMiddleware = (app: Express): void => {
  // Configure CORS first
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Range'],
    maxAge: ONE_HOUR_MS / 1000, // Convert to seconds for CORS
    credentials: true
  }))

  // Configure static file serving from public directory
  const publicPath = path.resolve(process.cwd(), 'public')
  app.use(express.static(publicPath, {
    maxAge: '7d', // Cache static files for 7 days (immutable assets)
    index: false, // Prevent directory listing
    dotfiles: 'ignore' // Ignore dotfiles for security
  }))
  console.log(`[${new Date().toISOString()}] Static file serving configured: ${publicPath}`)

  // Configure express for large file uploads
  app.use(bodyParser.json({ limit: MAX_UPLOAD_SIZE }))
  app.use(bodyParser.urlencoded({ limit: MAX_UPLOAD_SIZE, extended: true }))

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
