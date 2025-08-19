import { PrismaClient } from '@prisma/client'

declare global {
  var prisma: PrismaClient | undefined
}

const prismaClientSingleton = (): PrismaClient => {
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

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: pooledUrl
      }
    }
  })

  // Eagerly connect to ensure the connection pool is established
  client.$connect()
    .then(() => {
      console.log('✅ Database connected successfully with connection pooling')
      console.log('   Connection limit: 20, Pool timeout: 10s')
    })
    .catch((error) => {
      console.error('❌ Failed to connect to database:', error)
      process.exit(1)
    })

  return client
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma
}

// Graceful shutdown
process.on('beforeExit', async () => {
  console.log('Disconnecting from database...')
  await prisma.$disconnect()
})

// Handle termination signals
process.on('SIGINT', async () => {
  console.log('SIGINT received, disconnecting from database...')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, disconnecting from database...')
  await prisma.$disconnect()
  process.exit(0)
})

export default prisma
