/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  moduleNameMapper: {
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@graphql/(.*)$': '<rootDir>/app/graphql/$1',
    '^@resolvers/(.*)$': '<rootDir>/app/graphql/resolvers/$1',
    '^@main/(.*)$': '<rootDir>/app/$1',
    '^libvirt-node$': '<rootDir>/__mocks__/libvirt-node.js',
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