// External Libraries
import express from 'express'
import http from 'node:http'
import 'dotenv/config'
import 'reflect-metadata'
import cors from 'cors'
import jwt from 'jsonwebtoken'

// Prisma Client
import prisma from './utils/database'

// Configuration Imports
import { configureServer } from './config/server'
import { createApolloServer } from './config/apollo'
import { configureRoutes } from './config/routes'
import { expressMiddleware } from '@apollo/server/express4'
import { InfinibayContext } from './utils/context'

import installCallbacks from './utils/modelsCallbacks'
import { checkGpuAffinity } from './utils/checkGpuAffinity'

// Real-time Services
import { createSocketService } from './services/SocketService'
import { createEventManager } from './services/EventManager'
import { VmEventManager } from './services/VmEventManager'
import { UserEventManager } from './services/UserEventManager'
import { DepartmentEventManager } from './services/DepartmentEventManager'
import { ApplicationEventManager } from './services/ApplicationEventManager'
import { createVirtioSocketWatcherService } from './services/VirtioSocketWatcherService'

// Crons
import { startCrons } from './crons/all'

// Store services for cleanup
let virtioSocketWatcherService: any = null

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
          // Try to extract user from the authorization token
          let user = null
          const token = req.headers.authorization

          if (token) {
            try {
              const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as { userId: string; userRole: string }
              if (decoded.userId) {
                user = await prisma.user.findUnique({
                  where: { id: decoded.userId },
                  select: {
                    id: true,
                    email: true,
                    password: true,
                    deleted: true,
                    token: true,
                    firstName: true,
                    lastName: true,
                    userImage: true,
                    role: true,
                    createdAt: true
                  }
                })
              }
            } catch (error) {
              // Invalid token, user remains null
              console.error('Token verification failed:', error)
            }
          }

          return {
            prisma,
            req,
            res,
            user,
            setupMode: false,
            virtioSocketWatcher
          }
        }
      })
    )

    installCallbacks(prisma)

    // Initialize Socket.io and Event Management
    const socketService = createSocketService(prisma)
    socketService.initialize(httpServer)

    const eventManager = createEventManager(socketService, prisma)
    
    // Initialize VMDetailEventManager for VM detail-specific events
    const { createVMDetailEventManager } = await import('./services/VMDetailEventManager')
    createVMDetailEventManager(prisma)

    // Register resource event managers
    const vmEventManager = new VmEventManager(socketService, prisma)
    const userEventManager = new UserEventManager(socketService, prisma)
    const departmentEventManager = new DepartmentEventManager(socketService, prisma)
    const applicationEventManager = new ApplicationEventManager(socketService, prisma)

    eventManager.registerResourceManager('vms', vmEventManager)
    eventManager.registerResourceManager('users', userEventManager)
    eventManager.registerResourceManager('departments', departmentEventManager)
    eventManager.registerResourceManager('applications', applicationEventManager)

    console.log('🎯 Real-time event system initialized with all resource managers')

    // Initialize and start VirtioSocketWatcherService (already created earlier for context)
    virtioSocketWatcher.initialize(vmEventManager)

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
