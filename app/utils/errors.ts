/**
 * Domain-specific error classes for consistent error handling across services
 */
import { GraphQLError } from 'graphql'

/**
 * Shim error classes replacing the removed apollo-server-express / apollo-server-errors
 * classes. Each maps to a GraphQLError with the appropriate `extensions.code`, matching
 * the codes Apollo Server used previously.
 */
export class UserInputError extends GraphQLError {
  constructor (message: string, extensions?: Record<string, unknown>) {
    super(message, { extensions: { code: 'BAD_USER_INPUT', ...(extensions || {}) } })
    this.name = 'UserInputError'
  }
}

export class AuthenticationError extends GraphQLError {
  constructor (message: string, extensions?: Record<string, unknown>) {
    super(message, { extensions: { code: 'UNAUTHENTICATED', ...(extensions || {}) } })
    this.name = 'AuthenticationError'
  }
}

export class ForbiddenError extends GraphQLError {
  constructor (message: string, extensions?: Record<string, unknown>) {
    super(message, { extensions: { code: 'FORBIDDEN', ...(extensions || {}) } })
    this.name = 'ForbiddenError'
  }
}

export class ApolloError extends GraphQLError {
  constructor (message: string, code: string = 'INTERNAL_SERVER_ERROR', extensions?: Record<string, unknown>) {
    super(message, { extensions: { code, ...(extensions || {}) } })
    this.name = 'ApolloError'
  }
}

export class NotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class CircularDependencyError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'CircularDependencyError'
  }
}

/**
 * Check if an error is a domain error that should be mapped to UserInputError
 */
export function isDomainError (error: unknown): error is NotFoundError | ConflictError | CircularDependencyError {
  return error instanceof NotFoundError ||
         error instanceof ConflictError ||
         error instanceof CircularDependencyError
}
