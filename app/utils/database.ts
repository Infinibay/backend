import logger from '@main/logger'
import { PrismaClient } from '@prisma/client'
import { createPrismaClientWithCallbacks } from './modelsCallbacks'

// Type for the extended Prisma client with callbacks
// We use 'any' assertion to maintain compatibility with existing code that expects PrismaClient
type ExtendedPrismaClient = ReturnType<typeof createPrismaClientWithCallbacks> & PrismaClient

declare global {
  var prisma: ExtendedPrismaClient | undefined
}

const prismaClientSingleton = (): ExtendedPrismaClient => {
  // Parse the DATABASE_URL to add connection pool parameters
  const databaseUrl = process.env.DATABASE_URL || ''

  // Add connection pooling parameters to the URL if not already present
  let pooledUrl = databaseUrl
  if (!pooledUrl.includes('connection_limit=')) {
    const separator = pooledUrl.includes('?') ? '&' : '?'
    // Set reasonable connection pool limits:
    // - connection_limit: Maximum number of connections in the pool (20 is reasonable for most apps)
    // - pool_timeout: How long to wait for a connection from the pool (10 seconds)
    pooledUrl += `${separator}connection_limit=20&pool_timeout=10`
  }

  const baseClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: pooledUrl
      }
    }
  })

  // Eagerly connect to ensure the connection pool is established.
  // Skipped under NODE_ENV=test because the mocked PrismaClient in the suite
  // does not return a Promise from $connect(), which would throw here.
  if (process.env.NODE_ENV !== 'test') {
    baseClient.$connect()
      .then(() => {
        logger.info('✅ Database connected successfully with connection pooling')
        logger.info('   Connection limit: 20, Pool timeout: 10s')
        logger.info('   Prisma Client Extensions: Model callbacks enabled')
      })
      .catch((error) => {
        logger.error('❌ Failed to connect to database:', error)
        process.exit(1)
      })
  }

  // Apply client extensions with model callbacks
  // We cast to ExtendedPrismaClient to maintain type compatibility with existing code
  const extendedClient = createPrismaClientWithCallbacks(baseClient) as ExtendedPrismaClient

  return extendedClient
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma
}

// Graceful shutdown
process.on('beforeExit', async () => {
  logger.info('Disconnecting from database...')
  await prisma.$disconnect()
})

// Handle termination signals
process.on('SIGINT', async () => {
  logger.info('SIGINT received, disconnecting from database...')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, disconnecting from database...')
  await prisma.$disconnect()
  process.exit(0)
})

export default prisma
