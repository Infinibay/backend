import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import debug from 'debug'
import { PackageCheckerContext, PackageCheckerResult, PackageManifest } from './types'

const log = debug('infinibay:packages:worker')

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: any
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class PackageWorker extends EventEmitter {
  private process: ChildProcess | null = null
  private pendingRequests: Map<number, PendingRequest> = new Map()
  private requestId: number = 0
  private isShuttingDown: boolean = false
  private restartAttempts: number = 0
  private maxRestartAttempts: number = 3
  private buffer: string = ''
  private healthCheckTimer: NodeJS.Timeout | null = null
  private healthCheckFailures: number = 0
  private stats = {
    requestCount: 0,
    errorCount: 0,
    startedAt: null as Date | null
  }

  constructor(
    private packagePath: string,
    private manifest: PackageManifest,
    private options: {
      timeout?: number  // Default 30000ms
      memoryLimit?: number  // Default 512MB
      autoRestart?: boolean
    } = {}
  ) {
    super()
    this.options = {
      timeout: 30000,
      memoryLimit: 512,
      autoRestart: true,
      ...options
    }
  }

  /**
   * Spawn the worker process
   */
  async spawn(): Promise<void> {
    if (this.process) {
      throw new Error('Worker already running')
    }

    const workerScript = path.resolve(__dirname, 'worker-runner.js')

    this.process = spawn('node', [
      `--max-old-space-size=${this.options.memoryLimit}`,
      workerScript,
      this.packagePath
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PACKAGE_PATH: this.packagePath,
        PACKAGE_NAME: this.manifest.name,
        PACKAGE_CAPABILITIES: JSON.stringify(this.manifest.capabilities || {})
      }
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      log('Worker stderr [%s]: %s', this.manifest.name, data.toString())
    })

    this.process.on('exit', (code, signal) => {
      log('Worker exited [%s]: code=%d signal=%s', this.manifest.name, code, signal)
      this.process = null
      this.handleExit(code, signal)
    })

    this.process.on('error', (error) => {
      log('Worker error [%s]: %s', this.manifest.name, error.message)
      this.emit('error', error)
    })

    // Wait for ready signal
    await this.waitForReady()

    this.stats.startedAt = new Date()
    this.startHealthCheckTimer()

    log('Worker spawned successfully [%s]', this.manifest.name)
    this.restartAttempts = 0
  }

  /**
   * Start periodic health check timer
   */
  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        const healthy = await this.health()
        if (healthy) {
          this.healthCheckFailures = 0
        } else {
          this.healthCheckFailures++
          if (this.healthCheckFailures >= 3) {
            log('Worker %s failed 3 health checks, restarting...', this.manifest.name)
            await this.restart()
          }
        }
      } catch (error) {
        this.healthCheckFailures++
      }
    }, 30000)
  }

  /**
   * Restart worker process
   */
  async restart(): Promise<void> {
    await this.shutdown()
    this.isShuttingDown = false
    await this.spawn()
  }

  /**
   * Wait for worker to signal it's ready
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker failed to start within timeout'))
      }, 10000)

      const checkReady = (data: string) => {
        if (data.includes('"ready":true')) {
          clearTimeout(timeout)
          resolve()
        }
      }

      this.process?.stdout?.once('data', (data: Buffer) => {
        checkReady(data.toString())
      })
    })
  }

  /**
   * Handle stdout data (JSON-RPC responses)
   */
  private handleStdout(data: string): void {
    this.buffer += data

    // Try to parse complete JSON objects
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const response: JsonRpcResponse = JSON.parse(line)
        this.handleResponse(response)
      } catch (error) {
        log('Failed to parse worker response: %s', line)
      }
    }
  }

  /**
   * Handle JSON-RPC response
   */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      log('Received response for unknown request id: %d', response.id)
      return
    }

    this.pendingRequests.delete(response.id)
    clearTimeout(pending.timeout)

    if (response.error) {
      this.stats.errorCount++
      pending.reject(new Error(response.error.message))
    } else {
      pending.resolve(response.result)
    }
  }

  /**
   * Handle worker exit
   */
  private handleExit(code: number | null, signal: string | null): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`Worker exited unexpectedly (code=${code}, signal=${signal})`))
    }
    this.pendingRequests.clear()

    // Auto-restart if enabled and not shutting down
    if (this.options.autoRestart && !this.isShuttingDown && this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++
      log('Attempting to restart worker [%s] (attempt %d/%d)',
        this.manifest.name, this.restartAttempts, this.maxRestartAttempts)

      setTimeout(() => {
        this.spawn().catch(error => {
          log('Failed to restart worker: %s', error.message)
          this.emit('error', error)
        })
      }, 1000 * this.restartAttempts) // Exponential backoff
    }
  }

  /**
   * Send JSON-RPC request to worker
   */
  async send<T>(method: string, params?: any): Promise<T> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Worker not running')
    }

    this.stats.requestCount++

    const id = ++this.requestId
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        this.stats.errorCount++
        reject(new Error(`Request timeout (method=${method}, id=${id})`))
      }, this.options.timeout)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      this.process!.stdin!.write(JSON.stringify(request) + '\n')
    })
  }

  /**
   * Execute analyze method on worker
   */
  async analyze(context: PackageCheckerContext): Promise<PackageCheckerResult[]> {
    const result = await this.send<{ recommendations: PackageCheckerResult[] }>('analyze', {
      vmId: context.vmId,
      context
    })
    return result.recommendations || []
  }

  /**
   * Configure package settings
   */
  async configure(settings: Record<string, any>): Promise<void> {
    await this.send('configure', { settings })
  }

  /**
   * Health check
   */
  async health(): Promise<boolean> {
    try {
      const result = await this.send<{ healthy: boolean }>('health', {})
      return result.healthy
    } catch {
      return false
    }
  }

  /**
   * Shutdown worker gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.process) return

    this.isShuttingDown = true

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }

    try {
      await this.send('shutdown', {})
    } catch {
      // Ignore errors during shutdown
    }

    // Force kill after timeout
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGKILL')
      }
    }, 5000)
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.isShuttingDown
  }

  /**
   * Get package name
   */
  getName(): string {
    return this.manifest.name
  }

  /**
   * Get worker statistics
   */
  getStats(): { uptime: number; requestCount: number; errorCount: number } {
    return {
      uptime: this.stats.startedAt ? Date.now() - this.stats.startedAt.getTime() : 0,
      requestCount: this.stats.requestCount,
      errorCount: this.stats.errorCount
    }
  }
}
