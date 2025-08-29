import { PrismaClient } from '@prisma/client'
import { EventManager } from '../EventManager'
import { SocketService } from '../SocketService'
import { ErrorHandler } from '../../utils/errors/ErrorHandler'
import { Debugger } from '../../utils/debug'

export interface ServiceConfig {
  name: string
  dependencies?: ServiceDependencies
  options?: Record<string, string | number | boolean>
}

export interface ServiceDependencies {
  prisma: PrismaClient
  eventManager?: EventManager
  socketService?: SocketService
  errorHandler?: ErrorHandler
}

export abstract class BaseService {
  protected debug: Debugger
  protected initialized = false
  protected prisma: PrismaClient
  protected eventManager?: EventManager
  protected errorHandler: ErrorHandler

  constructor (protected config: ServiceConfig) {
    this.debug = new Debugger(`service:${config.name}`)
    this.prisma = config.dependencies!.prisma
    this.eventManager = config.dependencies?.eventManager
    this.errorHandler = config.dependencies?.errorHandler || ErrorHandler.getInstance()
  }

  async initialize (): Promise<void> {
    if (this.initialized) {
      this.debug.log('warn', 'Service already initialized')
      return
    }

    try {
      await this.onInitialize()
      this.initialized = true
      this.debug.log('info', 'Service initialized successfully')
    } catch (error) {
      this.debug.log('error', `Failed to initialize service: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  async shutdown (): Promise<void> {
    if (!this.initialized) {
      return
    }

    try {
      await this.onShutdown()
      this.initialized = false
      this.debug.log('info', 'Service shutdown successfully')
    } catch (error) {
      this.debug.log('error', `Error during service shutdown: ${error instanceof Error ? error.message : String(error)}`)
      // Don't throw on shutdown errors, just log them
    }
  }

  protected abstract onInitialize (): Promise<void>
  protected abstract onShutdown (): Promise<void>

  protected async executeWithErrorHandling<T> (
    operation: () => Promise<T>,
    errorContext: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      await this.errorHandler.handleError(error as Error, {
        service: this.config.name,
        ...errorContext
      })
      throw error
    }
  }

  protected isInitialized (): boolean {
    return this.initialized
  }

  protected requireInitialized (): void {
    if (!this.initialized) {
      throw new Error(`Service ${this.config.name} is not initialized`)
    }
  }

  protected getServiceName (): string {
    return this.config.name
  }

  protected getConfig (): ServiceConfig {
    return this.config
  }
}
