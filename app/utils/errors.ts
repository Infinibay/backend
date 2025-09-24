/**
 * Domain-specific error classes for consistent error handling across services
 */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CircularDependencyError'
  }
}

/**
 * Check if an error is a domain error that should be mapped to UserInputError
 */
export function isDomainError(error: unknown): error is NotFoundError | ConflictError | CircularDependencyError {
  return error instanceof NotFoundError ||
         error instanceof ConflictError ||
         error instanceof CircularDependencyError
}