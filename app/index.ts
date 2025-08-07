// External Libraries
import express from 'express'
import http from 'node:http'
import 'dotenv/config'
import 'reflect-metadata'
import cors from 'cors'

// Prisma Client
import { PrismaClient } from '@prisma/client'

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

// Crons
import { startCrons } from './crons/all'

const prisma = new PrismaClient()

async function bootstrap(): Promise<void> {
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
        context: async ({ req, res }): Promise<InfinibayContext> => ({
          prisma,
          req,
          res,
          user: null,
          setupMode: false
        })
      })
    )

    installCallbacks(prisma)

    // Initialize Socket.io and Event Management
    const socketService = createSocketService(prisma)
    socketService.initialize(httpServer)

    const eventManager = createEventManager(socketService, prisma)

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
        console.log(`🔌 Socket.io ready for real-time connections`)
        resolve()
      })
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

void bootstrap().catch((error) => {
  console.error('Unhandled error during bootstrap:', error)
  process.exit(1)
})
