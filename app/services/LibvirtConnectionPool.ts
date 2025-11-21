import { Connection } from '@infinibay/libvirt-node'
import { v4 as uuidv4 } from 'uuid'
import { SingletonService } from './base/SingletonService'
import { ServiceConfig } from './base/BaseService'
import { AppError, ErrorCode } from '../utils/errors/ErrorHandler'
import { PrismaClient } from '@prisma/client'

export interface PoolConfig {
  minConnections: number
  maxConnections: number
  acquireTimeout: number
  idleTimeout: number
  connectionUri?: string
}

interface PooledConnection {
  connection: Connection
  inUse: boolean
  lastUsed: number
  id: string
  createdAt: number
}

export class LibvirtConnectionPool extends SingletonService {
  private pool: PooledConnection[] = []
  private waitQueue: Array<{
    resolve: (conn: Connection) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }> = []

  private poolConfig: PoolConfig
  private cleanupInterval?: NodeJS.Timeout
  private connectionErrors = 0
  private lastErrorTime = 0
  private static defaultInstance: LibvirtConnectionPool | null = null

  constructor (config: ServiceConfig) {
    super(config)
    const options = config.options || {}
    this.poolConfig = {
      minConnections: (options.minConnections as number) || 2,
      maxConnections: (options.maxConnections as number) || 10,
      acquireTimeout: (options.acquireTimeout as number) || 30000,
      idleTimeout: (options.idleTimeout as number) || 60000,
      connectionUri: options.connectionUri as string | undefined
    }
  }

  static getPoolInstance (prisma: PrismaClient, config?: Partial<PoolConfig>): LibvirtConnectionPool {
    if (!LibvirtConnectionPool.defaultInstance) {
      const serviceConfig: ServiceConfig = {
        name: 'libvirt-connection-pool',
        dependencies: {
          prisma
        },
        options: {
          minConnections: config?.minConnections || 2,
          maxConnections: config?.maxConnections || 10,
          acquireTimeout: config?.acquireTimeout || 30000,
          idleTimeout: config?.idleTimeout || 60000,
          connectionUri: config?.connectionUri || 'qemu:///system'
        }
      }
      LibvirtConnectionPool.defaultInstance = new LibvirtConnectionPool(serviceConfig)
    }
    return LibvirtConnectionPool.defaultInstance
  }

  protected async onInitialize (): Promise<void> {
    // Create minimum connections
    const connectionPromises = []
    for (let i = 0; i < this.poolConfig.minConnections; i++) {
      connectionPromises.push(this.createConnection())
    }

    try {
      await Promise.all(connectionPromises)
      this.debug.log('info', `Created ${this.poolConfig.minConnections} initial connections`)
    } catch (error) {
      this.debug.log('error', `Failed to create initial connections: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }

    // Start cleanup interval for idle connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections().catch(err => {
        this.debug.log('error', `Cleanup error: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, 30000)
  }

  protected async onShutdown (): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Reject all waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout)
      waiter.reject(new AppError(
        'Connection pool is shutting down',
        ErrorCode.LIBVIRT_CONNECTION_FAILED,
        503,
        true
      ))
    }
    this.waitQueue = []

    // Close all connections
    await Promise.all(
      this.pool.map(async (pooled) => {
        try {
          pooled.connection.close()
        } catch (error) {
          this.debug.log('error', `Failed to close connection ${pooled.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    )

    this.pool = []
  }

  async acquire (): Promise<Connection> {
    this.requireInitialized()

    return this.executeWithErrorHandling(async () => {
      // Try to find available connection
      let pooled = this.pool.find(p => !p.inUse && this.isConnectionHealthy(p))

      if (!pooled && this.pool.length < this.poolConfig.maxConnections) {
        // Create new connection if under limit
        try {
          pooled = await this.createConnection()
        } catch (error) {
          this.handleConnectionError(error as Error)
          throw error
        }
      }

      if (pooled) {
        pooled.inUse = true
        pooled.lastUsed = Date.now()
        this.connectionErrors = 0 // Reset error count on success
        return pooled.connection
      }

      // Wait for available connection
      return this.waitForConnection()
    }, { operation: 'acquire_connection' })
  }

  async release (connection: Connection): Promise<void> {
    const pooled = this.pool.find(p => p.connection === connection)

    if (!pooled) {
      this.debug.log('warn', 'Attempted to release unknown connection')
      return
    }

    pooled.inUse = false
    pooled.lastUsed = Date.now()

    // Check if anyone is waiting
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()
      if (waiter) {
        clearTimeout(waiter.timeout)
        pooled.inUse = true
        waiter.resolve(connection)
      }
    }
  }

  private async createConnection (): Promise<PooledConnection> {
    const libvirt = await import('@infinibay/libvirt-node')
    const connection = libvirt.Connection.open(this.poolConfig.connectionUri || 'qemu:///system')

    if (!connection) {
      throw new AppError(
        'Failed to open libvirt connection',
        ErrorCode.LIBVIRT_CONNECTION_FAILED,
        503,
        true
      )
    }

    const pooled: PooledConnection = {
      connection,
      inUse: false,
      lastUsed: Date.now(),
      id: uuidv4(),
      createdAt: Date.now()
    }

    this.pool.push(pooled)
    this.debug.log('info', `Created new connection ${pooled.id}`)

    return pooled
  }

  private waitForConnection (): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitQueue.findIndex(w => w.resolve === resolve)
        if (index !== -1) {
          this.waitQueue.splice(index, 1)
        }
        reject(new AppError(
          'Connection acquire timeout',
          ErrorCode.LIBVIRT_CONNECTION_FAILED,
          503,
          true
        ))
      }, this.poolConfig.acquireTimeout)

      this.waitQueue.push({ resolve, reject, timeout })

      this.debug.log('info', `Request waiting for connection. Queue size: ${this.waitQueue.length}`)
    })
  }

  private async cleanupIdleConnections (): Promise<void> {
    const now = Date.now()
    const toRemove: PooledConnection[] = []

    for (const pooled of this.pool) {
      if (!pooled.inUse &&
          now - pooled.lastUsed > this.poolConfig.idleTimeout &&
          this.pool.filter(p => !p.inUse).length > this.poolConfig.minConnections) {
        toRemove.push(pooled)
      }
    }

    for (const pooled of toRemove) {
      try {
        pooled.connection.close()
        const index = this.pool.indexOf(pooled)
        if (index !== -1) {
          this.pool.splice(index, 1)
          this.debug.log('info', `Removed idle connection ${pooled.id}`)
        }
      } catch (error) {
        this.debug.log('error', `Failed to cleanup connection ${pooled.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private isConnectionHealthy (pooled: PooledConnection): boolean {
    try {
      // Simple health check - could be enhanced
      const age = Date.now() - pooled.createdAt
      const maxAge = 3600000 // 1 hour

      if (age > maxAge) {
        this.debug.log('info', `Connection ${pooled.id} exceeded max age`)
        return false
      }

      return true
    } catch (error) {
      this.debug.log('warn', `Connection ${pooled.id} health check failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private handleConnectionError (error: Error): void {
    this.connectionErrors++
    this.lastErrorTime = Date.now()

    if (this.connectionErrors > 5) {
      this.debug.log('error', 'Multiple connection failures detected. Pool health may be degraded.')
      // Could emit health status event here
    }
  }

  private getDefaultConfig (): PoolConfig {
    return {
      minConnections: 2,
      maxConnections: 10,
      acquireTimeout: 30000,
      idleTimeout: 60000
    }
  }

  // Helper method for operations
  async withConnection<T> (
    operation: (connection: Connection) => Promise<T>
  ): Promise<T> {
    const connection = await this.acquire()

    try {
      return await operation(connection)
    } finally {
      await this.release(connection)
    }
  }

  // Pool statistics
  getStatistics (): {
    total: number
    inUse: number
    available: number
    waitQueueSize: number
    connectionErrors: number
    } {
    return {
      total: this.pool.length,
      inUse: this.pool.filter(p => p.inUse).length,
      available: this.pool.filter(p => !p.inUse).length,
      waitQueueSize: this.waitQueue.length,
      connectionErrors: this.connectionErrors
    }
  }

  async testConnection (): Promise<boolean> {
    try {
      const result = await this.withConnection(async (conn) => {
        // Try to get hypervisor version as a basic test
        const version = conn.getHypVersion()
        return version !== undefined
      })
      return result
    } catch (error) {
      this.debug.log('error', `Connection test failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}
