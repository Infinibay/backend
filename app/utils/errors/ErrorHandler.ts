import { PrismaClient } from '@prisma/client'
import { EventManager } from '../../services/EventManager'

export enum ErrorCode {
  // Domain errors
  MACHINE_NOT_FOUND = 'MACHINE_NOT_FOUND',
  MACHINE_OPERATION_FAILED = 'MACHINE_OPERATION_FAILED',
  LIBVIRT_CONNECTION_FAILED = 'LIBVIRT_CONNECTION_FAILED',

  // System errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // Network errors
  NETWORK_FILTER_ERROR = 'NETWORK_FILTER_ERROR',
  FIREWALL_ERROR = 'FIREWALL_ERROR',

  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Resource errors
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // VM Recommendation errors
  VM_RECOMMENDATION_ERROR = 'VM_RECOMMENDATION_ERROR',
  VM_RECOMMENDATION_CHECKER_FAILED = 'VM_RECOMMENDATION_CHECKER_FAILED',
  VM_RECOMMENDATION_SERVICE_ERROR = 'VM_RECOMMENDATION_SERVICE_ERROR',
  VM_RECOMMENDATION_GENERATION_FAILED = 'VM_RECOMMENDATION_GENERATION_FAILED'
}

export interface ErrorContext {
  userId?: string
  machineId?: string
  operation?: string
  service?: string
  [key: string]: string | number | boolean | undefined
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
  code?: ErrorCode
  context?: ErrorContext
  timestamp: string
}

export class AppError extends Error {
  constructor (
    message: string,
    public code: ErrorCode,
    public statusCode: number = 500,
    public isOperational: boolean = true,
    public context?: ErrorContext
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler
  private errorLogger: ErrorLogger

  private constructor (
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {
    this.errorLogger = new ErrorLogger(prisma)
  }

  static initialize (prisma: PrismaClient, eventManager: EventManager): void {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler(prisma, eventManager)
    }
  }

  static getInstance (): ErrorHandler {
    if (!ErrorHandler.instance) {
      throw new Error('ErrorHandler not initialized')
    }
    return ErrorHandler.instance
  }

  async handleError (error: Error, context?: ErrorContext): Promise<void> {
    // Log to database
    await this.errorLogger.log(error, context)

    // For now, we'll emit a status_changed event for system errors
    // In the future, we might want to extend EventAction to include 'error'
    await this.eventManager.dispatchEvent(
      'system',
      'status_changed',
      {
        status: 'error',
        error: this.serializeError(error),
        context
      }
    )

    // Handle based on error type
    if (error instanceof AppError) {
      if (!error.isOperational) {
        // Critical error - might need to restart process
        this.handleCriticalError(error)
      }
    } else {
      // Unknown error - log and investigate
      console.error('Unhandled error type:', error)
    }
  }

  private serializeError (error: Error): SerializedError {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as AppError).code,
      context: (error as AppError).context,
      timestamp: new Date().toISOString()
    }
  }

  private handleCriticalError (error: AppError): void {
    console.error('CRITICAL ERROR - System may be unstable:', error)
    // Could trigger graceful shutdown here if needed
  }

  // Utility method to wrap async operations with error handling
  async executeWithErrorHandling<T> (
    operation: () => Promise<T>,
    errorContext: ErrorContext
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      await this.handleError(error as Error, errorContext)
      throw error
    }
  }

  // Create standardized error responses for GraphQL
  createGraphQLError (error: Error): {
    success: false
    message: string
    code?: ErrorCode
  } {
    if (error instanceof AppError) {
      return {
        success: false,
        message: error.message,
        code: error.code
      }
    }

    return {
      success: false,
      message: 'An unexpected error occurred',
      code: ErrorCode.INTERNAL_ERROR
    }
  }
}

// Error Logger class - Currently logs to console, but ready for DB integration
export class ErrorLogger {
  constructor (private prisma: PrismaClient) {}

  async log (error: Error, context?: ErrorContext): Promise<void> {
    try {
      // For now, we'll log to console since we need to create the errorLog table first
      const logEntry = {
        message: error.message,
        stack: error.stack,
        code: (error as AppError).code || 'UNKNOWN',
        context: JSON.stringify(context),
        timestamp: new Date(),
        severity: this.determineSeverity(error)
      }

      console.error('[ERROR_LOG]', logEntry)

      // TODO: Once errorLog table is created, uncomment this:
      // await this.prisma.errorLog.create({
      //   data: logEntry
      // })
    } catch (logError) {
      // Fallback to console if database logging fails
      console.error('Failed to log error to database:', logError)
      console.error('Original error:', error)
    }
  }

  private determineSeverity (error: Error): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (error instanceof AppError) {
      if (!error.isOperational) return 'CRITICAL'
      if (error.statusCode >= 500) return 'HIGH'
      if (error.statusCode >= 400) return 'MEDIUM'
    }
    return 'LOW'
  }
}
