/**
 * Mock for @main/logger (winston logger)
 * 
 * Exports a logger object with jest.fn() for each level.
 * Tests can spy on these methods to verify logging behavior.
 */
import type { Logger } from 'winston'

const logger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
  level: 'debug',
  transports: [],
  format: {},
  createLogger: jest.fn(),
  child: jest.fn(),
  isLevelEnabled: jest.fn(() => true),
  configure: jest.fn(),
  add: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  close: jest.fn(),
  flush: jest.fn()
} as unknown as Logger

// Make createLogger and child return the mock itself
;(logger as any).createLogger.mockReturnValue(logger)
;(logger as any).child.mockReturnValue(logger)

export default logger
