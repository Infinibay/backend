# Testing Strategy Documentation

This document provides comprehensive documentation for Infinibay's testing strategy, including unit testing, integration testing, mocking approaches, and testing best practices.

## Table of Contents

- [Testing Philosophy](#testing-philosophy)
- [Test Architecture](#test-architecture)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [Mocking Strategy](#mocking-strategy)
- [Test Configuration](#test-configuration)
- [Coverage & Reporting](#coverage--reporting)
- [Best Practices](#best-practices)
- [Continuous Integration](#continuous-integration)

## Testing Philosophy

Infinibay's testing strategy is built on the principle of **confidence through comprehensive coverage** while maintaining **development velocity**. Our approach emphasizes:

1. **Test Pyramid Structure**: More unit tests, fewer integration tests, minimal E2E tests
2. **Behavior-Driven Testing**: Tests describe what the system does, not how it's implemented
3. **Mock External Dependencies**: Isolate components for reliable, fast tests
4. **Real Integration Points**: Test actual database and GraphQL integration where valuable
5. **Performance Awareness**: Tests should be fast and not block development workflow

## Test Architecture

```mermaid
graph TB
    subgraph "Test Layers"
        E2E[E2E Tests<br/>GraphQL API]
        Integration[Integration Tests<br/>Resolvers + Database]
        Unit[Unit Tests<br/>Services + Utils]
    end
    
    subgraph "Test Infrastructure"
        Jest[Jest Test Runner]
        Mocks[Mock Libraries]
        Database[Test Database]
        Factories[Test Factories]
    end
    
    subgraph "External Mocks"
        LibvirtMock[Libvirt Mock]
        SocketMock[Socket.io Mock]
        EmailMock[Email Service Mock]
    end
    
    Unit --> Jest
    Integration --> Jest
    E2E --> Jest
    
    Jest --> Mocks
    Jest --> Database
    Jest --> Factories
    
    Unit --> LibvirtMock
    Integration --> SocketMock
    E2E --> EmailMock
```

### Test Structure

```
tests/
├── e2e/                    # End-to-end tests
│   └── graphql-api.test.ts
├── integration/            # Integration tests
│   ├── auth.test.ts
│   └── machine-lifecycle.test.ts
├── unit/                   # Unit tests
│   ├── resolvers/
│   │   ├── machine.test.ts
│   │   ├── user.test.ts
│   │   └── department.test.ts
│   └── services/
│       └── VirtioSocketWatcherService.test.ts
├── setup/                  # Test configuration
│   ├── jest.setup.ts
│   ├── mock-factories.ts
│   └── test-helpers.ts
└── __mocks__/             # Manual mocks
    └── libvirt-node.js
```

## Unit Testing

### Service Layer Testing

Unit tests focus on business logic in services, ensuring they work correctly in isolation:

```typescript
// tests/unit/services/machineLifecycleService.test.ts
import { MachineLifecycleService } from '../../../app/services/machineLifecycleService'
import { prismaMock } from '../../setup/mock-factories'
import { mockUser, mockMachine, mockTemplate } from '../../setup/test-helpers'

describe('MachineLifecycleService', () => {
  let service: MachineLifecycleService
  let mockPrisma: typeof prismaMock

  beforeEach(() => {
    mockPrisma = prismaMock
    service = new MachineLifecycleService(mockPrisma, mockUser)
  })

  describe('createMachine', () => {
    it('should create a machine with valid input', async () => {
      // Arrange
      const input = {
        name: 'Test Machine',
        templateId: 'template-1',
        username: 'admin',
        password: 'password',
        os: 'UBUNTU' as const
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(mockTemplate)
      mockPrisma.machine.create.mockResolvedValue(mockMachine)

      // Act
      const result = await service.createMachine(input)

      // Assert
      expect(result).toBeDefined()
      expect(result.name).toBe(input.name)
      expect(mockPrisma.machine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: input.name,
          templateId: input.templateId,
          userId: mockUser.id
        })
      })
    })

    it('should throw error when template not found', async () => {
      // Arrange
      const input = {
        name: 'Test Machine',
        templateId: 'nonexistent-template',
        username: 'admin',
        password: 'password',
        os: 'UBUNTU' as const
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(service.createMachine(input)).rejects.toThrow('Template not found')
    })
  })

  describe('destroyMachine', () => {
    it('should successfully destroy a machine', async () => {
      // Arrange
      const machineId = 'machine-1'
      mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
      mockPrisma.machine.delete.mockResolvedValue(mockMachine)

      // Act
      const result = await service.destroyMachine(machineId)

      // Assert
      expect(result.success).toBe(true)
      expect(result.message).toBe('Machine destroyed successfully')
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: machineId }
      })
    })

    it('should return error when machine not found', async () => {
      // Arrange
      const machineId = 'nonexistent-machine'
      mockPrisma.machine.findFirst.mockResolvedValue(null)

      // Act
      const result = await service.destroyMachine(machineId)

      // Assert
      expect(result.success).toBe(false)
      expect(result.message).toBe('Machine not found')
    })
  })
})
```

### Resolver Testing

Test GraphQL resolvers with mocked dependencies:

```typescript
// tests/unit/resolvers/machine.test.ts
import { MachineQueries, MachineMutations } from '../../../app/graphql/resolvers/machine/resolver'
import { prismaMock } from '../../setup/mock-factories'
import { mockContext, mockMachine } from '../../setup/test-helpers'

describe('Machine Resolvers', () => {
  describe('MachineQueries', () => {
    let queries: MachineQueries

    beforeEach(() => {
      queries = new MachineQueries()
    })

    describe('machine', () => {
      it('should return machine for admin user', async () => {
        // Arrange
        const machineId = 'machine-1'
        const adminContext = { ...mockContext, user: { ...mockContext.user, role: 'ADMIN' } }
        
        prismaMock.machine.findFirst.mockResolvedValue(mockMachine)

        // Act
        const result = await queries.machine(machineId, adminContext)

        // Assert
        expect(result).toBeDefined()
        expect(result?.id).toBe(machineId)
        expect(prismaMock.machine.findFirst).toHaveBeenCalledWith({
          where: { id: machineId },
          include: expect.any(Object)
        })
      })

      it('should filter by userId for regular user', async () => {
        // Arrange
        const machineId = 'machine-1'
        prismaMock.machine.findFirst.mockResolvedValue(mockMachine)

        // Act
        await queries.machine(machineId, mockContext)

        // Assert
        expect(prismaMock.machine.findFirst).toHaveBeenCalledWith({
          where: { id: machineId, userId: mockContext.user?.id },
          include: expect.any(Object)
        })
      })
    })
  })

  describe('MachineMutations', () => {
    let mutations: MachineMutations

    beforeEach(() => {
      mutations = new MachineMutations()
    })

    describe('powerOn', () => {
      it('should power on machine successfully', async () => {
        // Arrange
        const machineId = 'machine-1'
        prismaMock.machine.findFirst.mockResolvedValue(mockMachine)
        prismaMock.machine.update.mockResolvedValue({ ...mockMachine, status: 'running' })

        // Act
        const result = await mutations.powerOn(machineId, mockContext)

        // Assert
        expect(result.success).toBe(true)
        expect(result.message).toBe('Machine running')
      })
    })
  })
})
```

### Utility Function Testing

Test pure functions and utilities:

```typescript
// tests/unit/utils/pagination.test.ts
import { applyPagination } from '../../../app/utils/pagination'

describe('Pagination Utils', () => {
  describe('applyPagination', () => {
    it('should apply default pagination when no input provided', () => {
      // Act
      const result = applyPagination()

      // Assert
      expect(result).toEqual({
        skip: 0,
        take: 20
      })
    })

    it('should apply custom pagination values', () => {
      // Arrange
      const input = { skip: 10, take: 5 }

      // Act
      const result = applyPagination(input)

      // Assert
      expect(result).toEqual({
        skip: 10,
        take: 5
      })
    })

    it('should enforce maximum take limit', () => {
      // Arrange
      const input = { skip: 0, take: 1000 }

      // Act
      const result = applyPagination(input)

      // Assert
      expect(result.take).toBeLessThanOrEqual(100)
    })
  })
})
```

## Integration Testing

### Database Integration Tests

Test actual database operations with a test database:

```typescript
// tests/integration/machine-lifecycle.test.ts
import { PrismaClient } from '@prisma/client'
import { MachineLifecycleService } from '../../app/services/machineLifecycleService'
import { setupTestDatabase, cleanupTestDatabase } from '../setup/test-helpers'

describe('Machine Lifecycle Integration', () => {
  let prisma: PrismaClient
  let service: MachineLifecycleService

  beforeAll(async () => {
    prisma = await setupTestDatabase()
  })

  afterAll(async () => {
    await cleanupTestDatabase(prisma)
  })

  beforeEach(async () => {
    // Clean database state
    await prisma.machine.deleteMany()
    await prisma.machineTemplate.deleteMany()
    await prisma.user.deleteMany()

    // Set up test data
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: 'hashed-password',
        firstName: 'Test',
        lastName: 'User',
        role: 'USER',
        deleted: false
      }
    })

    const template = await prisma.machineTemplate.create({
      data: {
        name: 'Test Template',
        description: 'Test template description',
        cores: 2,
        ram: 4,
        storage: 50
      }
    })

    service = new MachineLifecycleService(prisma, user)
  })

  it('should create machine and store in database', async () => {
    // Arrange
    const template = await prisma.machineTemplate.findFirst()
    const input = {
      name: 'Integration Test Machine',
      templateId: template!.id,
      username: 'admin',
      password: 'password',
      os: 'UBUNTU' as const
    }

    // Act
    const result = await service.createMachine(input)

    // Assert
    expect(result).toBeDefined()
    expect(result.name).toBe(input.name)

    // Verify in database
    const savedMachine = await prisma.machine.findUnique({
      where: { id: result.id },
      include: { template: true, user: true }
    })

    expect(savedMachine).toBeDefined()
    expect(savedMachine?.name).toBe(input.name)
    expect(savedMachine?.template.id).toBe(template!.id)
  })

  it('should handle concurrent machine creation', async () => {
    // Arrange
    const template = await prisma.machineTemplate.findFirst()
    const inputs = [
      { name: 'Machine 1', templateId: template!.id, username: 'admin', password: 'password', os: 'UBUNTU' as const },
      { name: 'Machine 2', templateId: template!.id, username: 'admin', password: 'password', os: 'UBUNTU' as const },
      { name: 'Machine 3', templateId: template!.id, username: 'admin', password: 'password', os: 'UBUNTU' as const }
    ]

    // Act
    const results = await Promise.all(
      inputs.map(input => service.createMachine(input))
    )

    // Assert
    expect(results).toHaveLength(3)
    results.forEach((result, index) => {
      expect(result.name).toBe(inputs[index].name)
    })

    // Verify all stored
    const machines = await prisma.machine.findMany()
    expect(machines).toHaveLength(3)
  })
})
```

### GraphQL Integration Tests

Test complete GraphQL operations:

```typescript
// tests/integration/auth.test.ts
import { ApolloServer } from '@apollo/server'
import { createApolloServer } from '../../app/config/apollo'
import { PrismaClient } from '@prisma/client'
import { setupTestDatabase } from '../setup/test-helpers'

describe('Authentication Integration', () => {
  let server: ApolloServer
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = await setupTestDatabase()
    server = await createApolloServer()
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
    await prisma.$disconnect()
  })

  describe('login mutation', () => {
    it('should authenticate user with valid credentials', async () => {
      // Arrange
      const email = 'test@example.com'
      const password = 'password123'
      
      await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 10),
          firstName: 'Test',
          lastName: 'User',
          role: 'USER',
          deleted: false
        }
      })

      const query = `
        mutation Login($email: String!, $password: String!) {
          login(email: $email, password: $password) {
            token
          }
        }
      `

      // Act
      const result = await server.executeOperation({
        query,
        variables: { email, password }
      })

      // Assert
      expect(result.body.kind).toBe('single')
      if (result.body.kind === 'single') {
        expect(result.body.singleResult.errors).toBeUndefined()
        expect(result.body.singleResult.data?.login.token).toBeDefined()
      }
    })

    it('should reject invalid credentials', async () => {
      // Arrange
      const query = `
        mutation Login($email: String!, $password: String!) {
          login(email: $email, password: $password) {
            token
          }
        }
      `

      // Act
      const result = await server.executeOperation({
        query,
        variables: { email: 'nonexistent@example.com', password: 'wrongpassword' }
      })

      // Assert
      expect(result.body.kind).toBe('single')
      if (result.body.kind === 'single') {
        expect(result.body.singleResult.errors).toBeDefined()
        expect(result.body.singleResult.errors?.[0].message).toContain('Invalid credentials')
      }
    })
  })
})
```

## Mocking Strategy

### Libvirt Mock Implementation

The comprehensive libvirt mock provides realistic virtualization simulation:

```typescript
// __mocks__/libvirt-node.js
const mockState = {
  domains: new Map(),
  networks: new Map(),
  storagePools: new Map(),
  nwFilters: new Map()
}

class MockDomain {
  constructor(xml) {
    this.xml = xml
    this.name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-vm'
    this.state = 'shutoff'
    this.id = Math.floor(Math.random() * 1000)
  }

  async create() {
    this.state = 'running'
    return true
  }

  async destroy() {
    this.state = 'shutoff'
    return true
  }

  async getInfo() {
    return {
      state: this.state === 'running' ? 1 : 5,
      maxMem: 8388608,
      memory: 4194304,
      nrVirtCpu: 4,
      cpuTime: 1000000000
    }
  }

  // ... more methods
}

module.exports = {
  Hypervisor: MockHypervisor,
  __setLibvirtMockState: (state) => Object.assign(mockState, state),
  __getLibvirtMockState: () => mockState,
  __resetLibvirtMockState: () => {
    mockState.domains.clear()
    mockState.networks.clear()
    mockState.storagePools.clear()
    mockState.nwFilters.clear()
  }
}
```

### Prisma Mock Factory

```typescript
// tests/setup/mock-factories.ts
import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended'

export const prismaMock = mockDeep<PrismaClient>()

beforeEach(() => {
  mockReset(prismaMock)
})

export type MockPrisma = DeepMockProxy<PrismaClient>
```

### Test Data Factories

```typescript
// tests/setup/test-helpers.ts
import { User, Machine, MachineTemplate } from '@prisma/client'

export const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  password: 'hashed-password',
  firstName: 'Test',
  lastName: 'User',
  role: 'USER',
  deleted: false,
  token: 'null',
  userImage: null,
  createdAt: new Date()
}

export const mockMachine: Machine = {
  id: 'machine-1',
  name: 'Test Machine',
  internalName: 'test-machine-internal',
  status: 'off',
  userId: 'user-1',
  templateId: 'template-1',
  os: 'UBUNTU',
  cpuCores: 2,
  ramGB: 4,
  diskSizeGB: 50,
  gpuPciAddress: null,
  departmentId: null,
  createdAt: new Date(),
  updatedAt: new Date()
}

export const mockTemplate: MachineTemplate = {
  id: 'template-1',
  name: 'Test Template',
  description: 'Test template',
  cores: 2,
  ram: 4,
  storage: 50,
  categoryId: null,
  createdAt: new Date()
}

export const mockContext = {
  prisma: prismaMock,
  req: {} as any,
  res: {} as any,
  user: mockUser,
  setupMode: false
}

// Factory functions
export const createMockUser = (overrides: Partial<User> = {}): User => ({
  ...mockUser,
  ...overrides
})

export const createMockMachine = (overrides: Partial<Machine> = {}): Machine => ({
  ...mockMachine,
  ...overrides
})
```

### Socket.io Mock

```typescript
// tests/setup/socket-mock.ts
export const mockSocketService = {
  sendToUser: jest.fn(),
  sendToAdmins: jest.fn(),
  emitToRoom: jest.fn(),
  getStats: jest.fn(() => ({ connectedUsers: 0, userIds: [] }))
}
```

## Test Configuration

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  moduleNameMapping: {
    '^@utils/(.*)$': '<rootDir>/app/utils/$1',
    '^@services/(.*)$': '<rootDir>/app/services/$1',
    '^@graphql/(.*)$': '<rootDir>/app/graphql/$1',
    '^libvirt-node$': '<rootDir>/__mocks__/libvirt-node.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  collectCoverageFrom: [
    'app/**/*.ts',
    '!app/**/*.d.ts',
    '!app/index.ts'
  ],
  testTimeout: 30000,
  clearMocks: true,
  restoreMocks: true
}
```

### Test Setup

```typescript
// tests/setup/jest.setup.ts
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'

// Mock libvirt-node before any imports
jest.mock('libvirt-node')

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/infinibay_test'
process.env.TOKENKEY = 'test-secret-key'

// Global test utilities
global.beforeEach(() => {
  // Reset all mocks before each test
  jest.clearAllMocks()
})

// Extend Jest matchers
expect.extend({
  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const pass = uuidRegex.test(received)
    
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid UUID`,
      pass
    }
  }
})
```

## Coverage & Reporting

### Coverage Configuration

```json
{
  "collectCoverageFrom": [
    "app/**/*.ts",
    "!app/**/*.d.ts",
    "!app/index.ts",
    "!app/schema.graphql"
  ],
  "coverageDirectory": "coverage",
  "coverageReporters": ["text", "lcov", "html"],
  "coverageThreshold": {
    "global": {
      "branches": 70,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

### Running Coverage

```bash
# Generate coverage report
npm test -- --coverage

# Coverage with specific threshold
npm test -- --coverage --coverageThreshold='{"global":{"lines":90}}'

# Watch mode with coverage
npm test -- --watch --coverage
```

### Coverage Reports

Coverage reports are generated in multiple formats:
- **Terminal**: Immediate feedback during development
- **HTML**: Detailed visual reports in `coverage/lcov-report/`
- **LCOV**: Machine-readable format for CI/CD integration

## Best Practices

### Test Organization

1. **Group Related Tests**: Use `describe` blocks to group related functionality
2. **Clear Test Names**: Use descriptive test names that explain the scenario
3. **AAA Pattern**: Arrange, Act, Assert structure for clear test flow
4. **One Assertion Per Test**: Focus on testing one specific behavior

### Test Data Management

```typescript
// Good: Use factory functions
const user = createMockUser({ role: 'ADMIN' })
const machine = createMockMachine({ userId: user.id })

// Bad: Inline object creation
const user = { id: '1', email: 'test@test.com', ... }
```

### Async Testing

```typescript
// Good: Proper async/await usage
it('should create machine', async () => {
  const result = await service.createMachine(input)
  expect(result).toBeDefined()
})

// Good: Testing rejected promises
await expect(service.createMachine(invalidInput)).rejects.toThrow('Invalid input')
```

### Mock Verification

```typescript
// Verify interactions
expect(prismaMock.machine.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    name: 'Test Machine'
  })
})

// Verify call count
expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(1)
```

### Error Testing

```typescript
// Test error conditions
it('should handle database connection failure', async () => {
  prismaMock.machine.create.mockRejectedValue(new Error('Connection failed'))
  
  const result = await service.createMachine(input)
  
  expect(result.success).toBe(false)
  expect(result.message).toContain('Connection failed')
})
```

## Continuous Integration

### Test Commands

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- tests/unit/resolvers/

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run tests matching pattern
npm test -- --testNamePattern="should create machine"
```

### CI/CD Integration

```yaml
# GitHub Actions example
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:13
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: infinibay_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/infinibay_test
          
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

### Quality Gates

- **Minimum Coverage**: 80% line coverage required
- **Test Execution**: All tests must pass
- **Linting**: ESLint checks must pass
- **Type Checking**: TypeScript compilation must succeed

This comprehensive testing strategy ensures Infinibay maintains high code quality, reliability, and maintainability while supporting rapid development and deployment cycles.