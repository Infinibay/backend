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
  },
  rootDir: ''
};