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
    '^@infinibay/libvirt-node$': '<rootDir>/__mocks__/libvirt-node.js'
  },
  rootDir: '',
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
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
  restoreMocks: true,
  verbose: true
};
