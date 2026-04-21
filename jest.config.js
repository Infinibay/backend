/**
 * Jest configuration.
 *
 * DB tests (integration/, e2e/, and unit tests using testPrisma) share a
 * single real Postgres database. To avoid deadlocks caused by concurrent
 * TRUNCATE CASCADE across workers, the entire suite runs with maxWorkers=1
 * (serial execution). The overhead is acceptable because most tests are fast
 * unit tests (~0.1 s each) and the DB cleanup is cheap (~5 ms).
 */
module.exports = {
  testEnvironment: "node",
  globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  moduleNameMapper: {
    '^@main/logger$': '<rootDir>/__mocks__/logger.ts',
    '^@utils/VirtManager$': '<rootDir>/__mocks__/utils/VirtManager/index.ts',
    '^@utils/VirtManager/(.*)$': '<rootDir>/__mocks__/utils/VirtManager/$1',
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@graphql/(.*)$': '<rootDir>/app/graphql/$1',
    '^@resolvers/(.*)$': '<rootDir>/app/graphql/resolvers/$1',
    '^@main/(.*)$': '<rootDir>/app/$1',
    '^uuid$': '<rootDir>/__mocks__/uuid.ts',
    '^chokidar$': '<rootDir>/__mocks__/chokidar.ts',
    '^@infinibay/libvirt-node$': '<rootDir>/__mocks__/libvirt-node.js'
  },
  rootDir: '',
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  setupFiles: ['<rootDir>/tests/setup/loadEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  collectCoverageFrom: [
    'app/**/*.ts',
    '!app/**/*.d.ts',
    '!app/index.ts',
    '!app/schema.graphql'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  clearMocks: true,
  verbose: true,
  maxWorkers: 1,
  forceExit: true
}
