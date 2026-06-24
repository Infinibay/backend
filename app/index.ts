// Module aliases must be registered first
import logger from '@main/logger'
import 'module-alias/register'

// Global BigInt → JSON serialization. ISO.size and other Prisma BigInt fields
// otherwise crash any logger / GraphQL response that hits JSON.stringify.
;(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString()
}

// External Libraries
import express from 'express'
import http from 'node:http'
import 'dotenv/config'
import 'reflect-metadata'
import cors from 'cors'
import jwt from 'jsonwebtoken'

// Prisma Client (with callbacks extension applied automatically)
import prisma from './utils/database'

// Configuration Imports
import { configureServer } from './config/server'
import { createApolloServer } from './config/apollo'
import { configureRoutes } from './config/routes'
import { expressMiddleware } from '@as-integrations/express5'
import { InfinibayContext, createUserValidationHelpers, SafeUser } from './utils/context'
import { verifyRequestAuth } from './utils/jwtAuth'

// GraphQL Subscriptions transport
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/use/ws'

import { checkGpuAffinity } from './utils/checkGpuAffinity'
import { DepartmentNetworkService } from './services/network/DepartmentNetworkService'

// Real-time Services
import { createSocketService } from './services/SocketService'
import { createEventManager } from './services/EventManager'
import { ApplicationEventManager } from './services/ApplicationEventManager'
import { createVirtioSocketWatcherService } from './services/VirtioSocketWatcherService'
import { DepartmentEventManager } from './services/DepartmentEventManager'
import { FirewallEventManager } from './services/FirewallEventManager'
import { UserEventManager } from './services/UserEventManager'
import { VmEventManager } from './services/VmEventManager'

// Health Monitoring Services
import { VMHealthQueueManager } from './services/VMHealthQueueManager'
import { BackgroundHealthService } from './services/BackgroundHealthService'
import { BackgroundTaskService } from './services/BackgroundTaskService'
import { ErrorHandler } from './utils/errors/ErrorHandler'

// Crons
import { startCrons, CronHandles } from './crons/all'

// Backups
import { getBackupService } from './services/BackupService'
import { getBackupScheduleService, BackupScheduleService } from './services/BackupScheduleService'

// Store services for cleanup
let virtioSocketWatcherService: ReturnType<typeof createVirtioSocketWatcherService> | null = null
let httpServerRef: http.Server | null = null
let cronHandles: CronHandles | null = null
let backgroundHealthServiceRef: BackgroundHealthService | null = null
let backupScheduleServiceRef: BackupScheduleService | null = null
let shuttingDown = false

async function bootstrap (): Promise<void> {
  try {
    // Clean up stale GPU assignments before server starts
    await checkGpuAffinity(prisma)

    // Restore department network infrastructure (bridges, dnsmasq, NAT)
    try {
      const networkService = new DepartmentNetworkService(prisma)
      await networkService.restoreAllNetworks()
      logger.info('🌐 Department networks restored successfully')
    } catch (networkError) {
      logger.error('⚠️ Failed to restore department networks:', networkError)
      // Don't fail server startup - networks can be restored later
    }

    // Initialize Express and HTTP server
    const app = express()
    const httpServer = http.createServer(app)

    // Configure base server settings
    configureServer(app, httpServer)

    // Configure routes
    configureRoutes(app)

    // Initialize VirtioSocketWatcher early so it can be used in the context
    const virtioSocketWatcher = createVirtioSocketWatcherService(prisma)

    // Initialize Apollo Server
    const { server: apolloServer, schema } = await createApolloServer()
    await apolloServer.start()

    // GraphQL Subscriptions via graphql-ws
    // Attach a WebSocketServer to the HTTP server for /graphql subscriptions.
    // Must be set up BEFORE Socket.io initializes (which also uses upgrade events).
    const wsServer = new WebSocketServer({
      noServer: true,
      path: '/graphql'
    })

    useServer(
      {
        schema,
        context: async (ctx: any) => {
          // Re-use the same auth verification as HTTP queries
          const req = ctx.extra.request as express.Request
          const debugAuth = process.env.DEBUG_AUTH === '1' || process.env.NODE_ENV !== 'production'
          const authResult = await verifyRequestAuth(req, { method: 'context', debugAuth })
          const userHelpers = createUserValidationHelpers(authResult.user, authResult.meta)
          return {
            prisma,
            user: authResult.user,
            setupMode: false,
            virtioSocketWatcher,
            auth: authResult.meta,
            userHelpers
          }
        }
      },
      wsServer
    )

    // Intercept WebSocket upgrade requests for /graphql path only
    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname
      if (pathname === '/graphql') {
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit('connection', ws, request)
        })
      }
      // Other paths (e.g., /socket.io) fall through to Socket.io's handler
    })

    logger.info('📡 GraphQL subscriptions (graphql-ws) configured on /graphql')

    // Apply Apollo middleware
    app.use(
      '/graphql',
      cors({
        origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
        credentials: true
      }),
      expressMiddleware(apolloServer, {
        context: async ({ req, res }: { req: express.Request, res: express.Response }): Promise<InfinibayContext> => {
          const debugAuth = process.env.DEBUG_AUTH === '1' || process.env.NODE_ENV !== 'production'

          // Use shared JWT verification utility
          const authResult = await verifyRequestAuth(req, {
            method: 'context',
            debugAuth
          })

          // Create user validation helpers
          const userHelpers = createUserValidationHelpers(authResult.user, authResult.meta)

          return {
            prisma,
            req,
            res,
            user: authResult.user,
            setupMode: false,
            virtioSocketWatcher,
            auth: authResult.meta,
            userHelpers
          }
        }
      })
    )

    // Note: Model callbacks are now automatically applied via Prisma Client Extensions
    // See app/utils/database.ts and app/utils/modelsCallbacks.ts

    // Initialize Socket.io and Event Management
    const socketService = createSocketService(prisma)
    socketService.initialize(httpServer)

    const eventManager = createEventManager(socketService, prisma)

    // Initialize ErrorHandler for background services
    ErrorHandler.initialize(prisma, eventManager)
    logger.info('⚠️ Error Handler initialized')

    // Initialize VMDetailEventManager for VM detail-specific events
    const { createVMDetailEventManager } = await import('./services/VMDetailEventManager')
    createVMDetailEventManager(prisma)

    // Register resource event managers
    const applicationEventManager = new ApplicationEventManager(socketService, prisma)
    const departmentEventManager = new DepartmentEventManager(socketService, prisma)
    const firewallEventManager = new FirewallEventManager(socketService, prisma)
    const userEventManager = new UserEventManager(socketService, prisma)
    const vmEventManager = new VmEventManager(socketService, prisma)

    // Import and register scripts event manager
    const { ScriptsEventManager } = await import('./services/ScriptsEventManager')
    const scriptsEventManager = new ScriptsEventManager(socketService, prisma)

    const { BackupEventManager } = await import('./services/BackupEventManager')
    const backupsEventManager = new BackupEventManager(socketService, prisma, 'backups')
    const backupSchedulesEventManager = new BackupEventManager(socketService, prisma, 'backup_schedules')

    const { RecommendationsEventManager } = await import('./services/RecommendationsEventManager')
    const recommendationsEventManager = new RecommendationsEventManager(socketService, prisma)

    const { GoldenImageEventManager } = await import('./services/GoldenImageEventManager')
    const goldenImageEventManager = new GoldenImageEventManager(socketService, prisma)

    const { PolicyEventManager } = await import('./services/PolicyEventManager')
    const policyEventManager = new PolicyEventManager(socketService, prisma)

    eventManager.registerResourceManager('applications', applicationEventManager)
    eventManager.registerResourceManager('departments', departmentEventManager)
    eventManager.registerResourceManager('firewall', firewallEventManager)
    eventManager.registerResourceManager('users', userEventManager)
    eventManager.registerResourceManager('vms', vmEventManager)
    eventManager.registerResourceManager('scripts', scriptsEventManager)
    eventManager.registerResourceManager('backups', backupsEventManager)
    eventManager.registerResourceManager('backup_schedules', backupSchedulesEventManager)
    eventManager.registerResourceManager('recommendations', recommendationsEventManager)
    eventManager.registerResourceManager('golden_images', goldenImageEventManager)
    eventManager.registerResourceManager('policy', policyEventManager)

    logger.info('🎯 Real-time event system initialized with all resource managers')

    // Initialize health monitoring system
    const healthQueueManager = new VMHealthQueueManager(prisma, eventManager)
    logger.info('⚕️ VM Health Queue Manager initialized')

    // Initialize and start background health service
    const backgroundTaskService = new BackgroundTaskService(prisma, eventManager)
    const backgroundHealthService = new BackgroundHealthService(
      prisma,
      backgroundTaskService,
      eventManager,
      healthQueueManager
    )
    backgroundHealthService.start()
    backgroundHealthServiceRef = backgroundHealthService
    logger.info('🏥 Background Health Service initialized and started')

    // Initialize and start VirtioSocketWatcherService (already created earlier for context)
    virtioSocketWatcher.initialize(vmEventManager, healthQueueManager)

    // Forward metrics updates to Socket.io clients
    virtioSocketWatcher.on('metricsUpdated', ({ vmId, metrics }) => {
      socketService.emitToRoom(`vm:${vmId}`, 'metricsUpdate', { vmId, metrics })
    })

    try {
      await virtioSocketWatcher.start()
      virtioSocketWatcherService = virtioSocketWatcher // Store for cleanup
      logger.info('🔌 VirtioSocketWatcherService started successfully')
    } catch (error) {
      logger.error('⚠️ Failed to start VirtioSocketWatcherService:', error)
      // Don't fail the server startup if the virtio socket watcher fails
    }

    // Initialize script file watcher
    if (process.env.SCRIPT_FILE_WATCHER_ENABLED !== 'false') {
      try {
        const { initializeScriptFileWatcher } = await import('./services/scripts/ScriptFileWatcher')
        initializeScriptFileWatcher()
        logger.info('✅ Script file watcher initialized')
      } catch (error) {
        logger.error('❌ Failed to initialize script file watcher:', error)
      }
    }

    // Initialize script schedule push service
    try {
      const { createScriptSchedulePushService } = await import('./services/scripts/ScriptSchedulePushService')
      createScriptSchedulePushService(prisma)
      logger.info('✅ Script schedule push service initialized')
    } catch (error) {
      logger.error('❌ Failed to initialize script schedule push service:', error)
    }

    // Start cron jobs
    cronHandles = await startCrons()

    // Initialize backup scheduler (loads enabled schedules from DB)
    try {
      const backupService = getBackupService(prisma)
      // Any IN_PROGRESS rows belong to a previous run — mark them FAILED so
      // the UI isn't stuck on a forever-spinning progress bar.
      await backupService.recoverOrphanedBackups()
      const backupScheduleService = getBackupScheduleService(prisma, backupService)
      await backupScheduleService.start()
      backupScheduleServiceRef = backupScheduleService
    } catch (error) {
      logger.error('⚠️ Failed to start BackupScheduleService:', error)
    }

    // Start server
    const port = parseInt(process.env.PORT || '4000', 10)
    const host = '0.0.0.0'

    await new Promise<void>((resolve) => {
      httpServer.listen({ port, host }, () => {
        httpServerRef = httpServer
        logger.info(`🚀 Server ready at http://${host}:${port}`)
        logger.info(`🚀 GraphQL endpoint: http://${host}:${port}/graphql`)
        logger.info(`🚀 Health check endpoint available at http://${host}:${port}/health`)
        logger.info('🔌 Socket.io ready for real-time connections')
        resolve()
      })
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Graceful shutdown handler
async function shutdown (): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('\n🛑 Shutting down gracefully...')

  // Stop accepting new HTTP / Socket.io connections first
  if (httpServerRef) {
    await new Promise<void>((resolve) => {
      httpServerRef!.close((err) => {
        if (err) logger.error('⚠️ Error closing HTTP server:', err)
        else logger.info('✅ HTTP server closed')
        resolve()
      })
    })
  }

  // Stop cron jobs so they don't enqueue new work during shutdown
  if (cronHandles) {
    try {
      cronHandles.stop()
      logger.info('✅ Cron jobs stopped')
    } catch (error) {
      logger.error('⚠️ Error stopping cron jobs:', error)
    }
  }

  // Stop backup schedule service
  if (backupScheduleServiceRef) {
    try {
      backupScheduleServiceRef.stop()
      logger.info('✅ BackupScheduleService stopped')
    } catch (error) {
      logger.error('⚠️ Error stopping BackupScheduleService:', error)
    }
  }

  // Stop background health service
  if (backgroundHealthServiceRef) {
    try {
      backgroundHealthServiceRef.stop()
      logger.info('✅ BackgroundHealthService stopped')
    } catch (error) {
      logger.error('⚠️ Error stopping BackgroundHealthService:', error)
    }
  }

  // Stop VirtioSocketWatcherService
  if (virtioSocketWatcherService) {
    try {
      await virtioSocketWatcherService.stop()
      logger.info('✅ VirtioSocketWatcherService stopped')
    } catch (error) {
      logger.error('⚠️ Error stopping VirtioSocketWatcherService:', error)
    }
  }

  // Disconnect Prisma
  await prisma.$disconnect()
  logger.info('✅ Database connections closed')

  process.exit(0)
}

// Handle shutdown signals
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

void bootstrap().catch((error) => {
  logger.error('Unhandled error during bootstrap:', error)
  process.exit(1)
})
