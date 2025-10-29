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
import { expressMiddleware } from '@apollo/server/express4'
import { InfinibayContext, createUserValidationHelpers, SafeUser } from './utils/context'
import { verifyRequestAuth } from './utils/jwtAuth'

import { checkGpuAffinity } from './utils/checkGpuAffinity'

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
import { startCrons } from './crons/all'

// Store services for cleanup
let virtioSocketWatcherService: ReturnType<typeof createVirtioSocketWatcherService> | null = null

async function bootstrap (): Promise<void> {
  try {
    // Clean up stale GPU assignments before server starts
    await checkGpuAffinity(prisma)

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
    const apolloServer = await createApolloServer()
    await apolloServer.start()

    // Apply Apollo middleware
    app.use(
      '/graphql',
      cors({
        origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
        credentials: true
      }),
      expressMiddleware(apolloServer, {
        context: async ({ req, res }): Promise<InfinibayContext> => {
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
    console.log('⚠️ Error Handler initialized')

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

    eventManager.registerResourceManager('applications', applicationEventManager)
    eventManager.registerResourceManager('departments', departmentEventManager)
    eventManager.registerResourceManager('firewall', firewallEventManager)
    eventManager.registerResourceManager('users', userEventManager)
    eventManager.registerResourceManager('vms', vmEventManager)
    eventManager.registerResourceManager('scripts', scriptsEventManager)

    console.log('🎯 Real-time event system initialized with all resource managers')

    // Initialize health monitoring system
    const healthQueueManager = new VMHealthQueueManager(prisma, eventManager)
    console.log('⚕️ VM Health Queue Manager initialized')

    // Initialize and start background health service
    const backgroundTaskService = new BackgroundTaskService(prisma, eventManager)
    const backgroundHealthService = new BackgroundHealthService(
      prisma,
      backgroundTaskService,
      eventManager,
      healthQueueManager
    )
    backgroundHealthService.start()
    console.log('🏥 Background Health Service initialized and started')

    // Initialize and start VirtioSocketWatcherService (already created earlier for context)
    virtioSocketWatcher.initialize(vmEventManager, healthQueueManager)

    // Forward metrics updates to Socket.io clients
    virtioSocketWatcher.on('metricsUpdated', ({ vmId, metrics }) => {
      socketService.emitToRoom(`vm:${vmId}`, 'metricsUpdate', { vmId, metrics })
    })

    try {
      await virtioSocketWatcher.start()
      virtioSocketWatcherService = virtioSocketWatcher // Store for cleanup
      console.log('🔌 VirtioSocketWatcherService started successfully')
    } catch (error) {
      console.error('⚠️ Failed to start VirtioSocketWatcherService:', error)
      // Don't fail the server startup if the virtio socket watcher fails
    }

    // Initialize script file watcher
    if (process.env.SCRIPT_FILE_WATCHER_ENABLED !== 'false') {
      try {
        const { initializeScriptFileWatcher } = await import('./services/scripts/ScriptFileWatcher')
        initializeScriptFileWatcher()
        console.log('✅ Script file watcher initialized')
      } catch (error) {
        console.error('❌ Failed to initialize script file watcher:', error)
      }
    }

    // Start cron jobs
    await startCrons()

    // Start server
    const port = parseInt(process.env.PORT || '4000', 10)
    const host = '0.0.0.0'

    await new Promise<void>((resolve) => {
      httpServer.listen({ port, host }, () => {
        console.log(`🚀 Server ready at http://${host}:${port}`)
        console.log(`🚀 GraphQL endpoint: http://${host}:${port}/graphql`)
        console.log(`🚀 Health check endpoint available at http://${host}:${port}/health`)
        console.log('🔌 Socket.io ready for real-time connections')
        resolve()
      })
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Graceful shutdown handler
async function shutdown (): Promise<void> {
  console.log('\n🛑 Shutting down gracefully...')

  // Stop VirtioSocketWatcherService
  if (virtioSocketWatcherService) {
    try {
      await virtioSocketWatcherService.stop()
      console.log('✅ VirtioSocketWatcherService stopped')
    } catch (error) {
      console.error('⚠️ Error stopping VirtioSocketWatcherService:', error)
    }
  }

  // Disconnect Prisma
  await prisma.$disconnect()
  console.log('✅ Database connections closed')

  process.exit(0)
}

// Handle shutdown signals
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

void bootstrap().catch((error) => {
  console.error('Unhandled error during bootstrap:', error)
  process.exit(1)
})
