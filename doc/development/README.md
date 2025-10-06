# Developer Guide

This comprehensive developer guide provides everything you need to know to develop, maintain, and extend the Infinibay backend system.

## Table of Contents

- [Getting Started](#getting-started)
- [Environment Setup](#environment-setup)
- [Development Workflow](#development-workflow)
- [Code Organization](#code-organization)
- [API Development](#api-development)
- [Database Management](#database-management)
- [Testing Guidelines](#testing-guidelines)
- [Debugging & Logging](#debugging--logging)
- [Performance Optimization](#performance-optimization)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ with npm
- **PostgreSQL** 12+
- **Libvirt/KVM** hypervisor
- **Rust** (for libvirt-node bindings)
- **Git** for version control

### Quick Setup

```bash
# Clone the repository
git clone <repository-url>
cd infinibay/backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your configuration

# Set up database
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

### Verification

```bash
# Check server is running
curl http://localhost:4000/health

# Access GraphQL playground (development only)
open http://localhost:4000/graphql
```

## Environment Setup

### Required Environment Variables

```bash
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/infinibay?schema=public"

# Authentication
TOKENKEY="your-jwt-secret-key"

# Server Configuration
PORT=4000
FRONTEND_URL="http://localhost:3000"

# Virtualization
RPC_URL="http://localhost:9090"
VIRTIO_WIN_ISO_PATH="/var/lib/libvirt/driver/virtio-win-0.1.229.iso"
APP_HOST="192.168.1.100"
INFINIBAY_BASE_DIR="/opt/infinibay"
INFINIBAY_STORAGE_POOL_NAME="infinibay"
GRAPHIC_HOST="192.168.1.100"
LIBVIRT_NETWORK_NAME="default"

# Security
BCRYPT_ROUNDS=10
```

### Development vs Production

#### Development Configuration
```bash
NODE_ENV=development
DEBUG=infinibay:*
LOG_LEVEL=debug
```

#### Production Configuration
```bash
NODE_ENV=production
DEBUG=infinibay:error
LOG_LEVEL=info
```

### Database Setup

#### Local Development Database

```bash
# Create database
createdb infinibay

# Run migrations
npm run db:migrate

# Seed with test data
npm run db:seed

# Reset database (development only)
npm run db:reset
```

#### Test Database

```bash
# Create test database
createdb infinibay_test

# Set test environment
export NODE_ENV=test
export DATABASE_URL="postgresql://username:password@localhost:5432/infinibay_test"

# Run tests
npm test
```

## Development Workflow

### Daily Development Process

1. **Start Development Environment**
   ```bash
   # Terminal 1: Backend server
   npm run dev
   
   # Terminal 2: Database (if needed)
   sudo systemctl start postgresql
   
   # Terminal 3: Test watcher (optional)
   npm test -- --watch
   ```

2. **Make Changes**
   - Follow TypeScript strict mode
   - Write tests for new functionality
   - Update documentation as needed

3. **Test Changes**
   ```bash
   # Run all tests
   npm test
   
   # Run specific test file
   npm test -- machine.test.ts
   
   # Run with coverage
   npm test -- --coverage
   ```

4. **Lint and Format**
   ```bash
   # Check linting
   npm run lint
   
   # Fix linting issues
   npm run lint:fix
   ```

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/new-vm-management

# Make commits with clear messages
git commit -m "feat: add VM hardware update functionality"

# Push and create pull request
git push origin feature/new-vm-management
```

### Commit Message Convention

Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code formatting
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Build/configuration changes

## Code Organization

### Directory Structure

```
app/
├── config/           # Server and Apollo configuration
├── crons/            # Scheduled tasks
├── graphql/          # GraphQL schema and resolvers
│   └── resolvers/    # Type-specific resolvers
├── middleware/       # Express middleware
├── routes/           # REST endpoints
├── services/         # Business logic services
├── templates/        # EJS templates
└── utils/            # Utility functions and helpers
```

### TypeScript Configuration

The project uses strict TypeScript configuration:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Import Path Aliases

Use configured path aliases for cleaner imports:

```typescript
// Good
import { VirtManager } from '@utils/VirtManager'
import { EventManager } from '@services/EventManager'
import { MachineResolver } from '@resolvers/machine/resolver'

// Avoid
import { VirtManager } from '../../../utils/VirtManager'
```

### Code Style Guidelines

#### Function Organization

```typescript
// Good: Small, focused functions
export class MachineService {
  async createMachine(input: CreateMachineInput): Promise<Machine> {
    await this.validateInput(input)
    const template = await this.loadTemplate(input.templateId)
    return this.performCreate(input, template)
  }

  private async validateInput(input: CreateMachineInput): Promise<void> {
    // Validation logic
  }

  private async loadTemplate(templateId: string): Promise<MachineTemplate> {
    // Template loading logic
  }
}
```

#### Error Handling

```typescript
// Good: Specific error types and messages
export class MachineService {
  async createMachine(input: CreateMachineInput): Promise<Machine> {
    try {
      return await this.performCreate(input)
    } catch (error) {
      if (error instanceof LibvirtError) {
        throw new VirtualizationError(`Failed to create VM: ${error.message}`)
      }
      throw new InternalServerError('Unexpected error during VM creation')
    }
  }
}
```

#### Async/Await Usage

```typescript
// Good: Proper async/await
async function processVMs(vmIds: string[]): Promise<ProcessResult[]> {
  const results = await Promise.all(
    vmIds.map(id => this.processVM(id))
  )
  return results
}

// Good: Error handling with async/await
async function safeProcessVM(vmId: string): Promise<ProcessResult> {
  try {
    return await this.processVM(vmId)
  } catch (error) {
    console.error(`Failed to process VM ${vmId}:`, error)
    return { success: false, error: error.message }
  }
}
```

## API Development

### Creating GraphQL Resolvers

#### 1. Define Types

```typescript
// app/graphql/resolvers/newResource/type.ts
import { ObjectType, Field, ID, InputType } from 'type-graphql'

@ObjectType()
export class NewResource {
  @Field(() => ID)
  id: string

  @Field()
  name: string

  @Field({ nullable: true })
  description?: string

  @Field()
  createdAt: Date
}

@InputType()
export class CreateNewResourceInput {
  @Field()
  name: string

  @Field({ nullable: true })
  description?: string
}
```

#### 2. Implement Resolver

```typescript
// app/graphql/resolvers/newResource/resolver.ts
import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { NewResource, CreateNewResourceInput } from './type'
import { InfinibayContext } from '@main/utils/context'

@Resolver()
export class NewResourceResolver {
  @Query(() => [NewResource])
  @Authorized('USER')
  async newResources(@Ctx() { prisma }: InfinibayContext): Promise<NewResource[]> {
    return prisma.newResource.findMany()
  }

  @Mutation(() => NewResource)
  @Authorized('ADMIN')
  async createNewResource(
    @Arg('input') input: CreateNewResourceInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<NewResource> {
    return prisma.newResource.create({
      data: {
        ...input,
        createdBy: user?.id
      }
    })
  }
}
```

#### 3. Register Resolver

```typescript
// app/graphql/resolvers/index.ts
import { NewResourceResolver } from './newResource/resolver'

export const resolvers = [
  // ... existing resolvers
  NewResourceResolver
] as const
```

### Service Layer Development

#### Creating a New Service

```typescript
// app/services/NewResourceService.ts
import { PrismaClient } from '@prisma/client'
import { EventManager } from './EventManager'

export class NewResourceService {
  constructor(
    private prisma: PrismaClient,
    private eventManager: EventManager
  ) {}

  async createResource(data: CreateResourceData): Promise<Resource> {
    // 1. Validate input
    await this.validateInput(data)

    // 2. Perform business logic
    const resource = await this.prisma.newResource.create({ data })

    // 3. Trigger events
    await this.eventManager.dispatchEvent('newResources', 'create', resource)

    return resource
  }

  private async validateInput(data: CreateResourceData): Promise<void> {
    if (!data.name || data.name.trim().length === 0) {
      throw new UserInputError('Name is required')
    }

    const existing = await this.prisma.newResource.findFirst({
      where: { name: data.name }
    })

    if (existing) {
      throw new UserInputError('Resource with this name already exists')
    }
  }
}
```

### Real-time Events

#### Adding Event Support

```typescript
// app/services/NewResourceEventManager.ts
import { ResourceEventManager, EventAction } from './EventManager'
import { SocketService } from './SocketService'
import { PrismaClient } from '@prisma/client'

export class NewResourceEventManager implements ResourceEventManager {
  constructor(
    private socketService: SocketService,
    private prisma: PrismaClient
  ) {}

  async handleEvent(action: EventAction, data: any, triggeredBy?: string): Promise<void> {
    switch (action) {
      case 'create':
        await this.handleResourceCreated(data, triggeredBy)
        break
      case 'update':
        await this.handleResourceUpdated(data, triggeredBy)
        break
      case 'delete':
        await this.handleResourceDeleted(data, triggeredBy)
        break
    }
  }

  private async handleResourceCreated(data: any, triggeredBy?: string): Promise<void> {
    // Fetch fresh data
    const resource = await this.prisma.newResource.findUnique({
      where: { id: data.id }
    })

    if (!resource) return

    // Broadcast to relevant users
    this.socketService.sendToAdmins('newResources', 'create', {
      status: 'success',
      data: resource
    })

    if (triggeredBy) {
      this.socketService.sendToUser(triggeredBy, 'newResources', 'create', {
        status: 'success',
        data: resource
      })
    }
  }
}
```

## Database Management

### Schema Changes

#### 1. Update Prisma Schema

```prisma
// prisma/schema.prisma
model NewResource {
  id          String   @id @default(uuid())
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relations
  createdBy   String?
  creator     User?    @relation(fields: [createdBy], references: [id])
}
```

#### 2. Generate Migration

```bash
# Create migration
npx prisma migrate dev --name add_new_resource_model

# Apply migration
npx prisma migrate dev
```

#### 3. Update Seed Data

```typescript
// prisma/seed.ts
async function seedNewResources() {
  const resources = [
    { name: 'Default Resource', description: 'Initial resource' },
    { name: 'Test Resource', description: 'For testing purposes' }
  ]

  for (const resource of resources) {
    await prisma.newResource.upsert({
      where: { name: resource.name },
      update: {},
      create: resource
    })
  }
}
```

### Database Queries

#### Best Practices

```typescript
// Good: Use include for related data
const machine = await prisma.machine.findUnique({
  where: { id },
  include: {
    user: true,
    template: true,
    department: true
  }
})

// Good: Use select for specific fields
const users = await prisma.user.findMany({
  select: {
    id: true,
    email: true,
    firstName: true,
    lastName: true
  }
})

// Good: Pagination for large datasets
const machines = await prisma.machine.findMany({
  skip: page * pageSize,
  take: pageSize,
  orderBy: { createdAt: 'desc' }
})
```

#### Avoiding N+1 Queries

```typescript
// Bad: N+1 query
const machines = await prisma.machine.findMany()
for (const machine of machines) {
  machine.user = await prisma.user.findUnique({ where: { id: machine.userId } })
}

// Good: Single query with include
const machines = await prisma.machine.findMany({
  include: { user: true }
})
```

## Testing Guidelines

### Writing Unit Tests

```typescript
// tests/unit/services/newResourceService.test.ts
import { NewResourceService } from '../../../app/services/NewResourceService'
import { prismaMock } from '../../setup/mock-factories'
import { mockEventManager } from '../../setup/test-helpers'

describe('NewResourceService', () => {
  let service: NewResourceService

  beforeEach(() => {
    service = new NewResourceService(prismaMock, mockEventManager)
  })

  describe('createResource', () => {
    it('should create resource successfully', async () => {
      // Arrange
      const input = { name: 'Test Resource', description: 'Test description' }
      const expectedResource = { id: 'resource-1', ...input, createdAt: new Date() }

      prismaMock.newResource.findFirst.mockResolvedValue(null)
      prismaMock.newResource.create.mockResolvedValue(expectedResource)

      // Act
      const result = await service.createResource(input)

      // Assert
      expect(result).toEqual(expectedResource)
      expect(prismaMock.newResource.create).toHaveBeenCalledWith({
        data: input
      })
    })

    it('should throw error for duplicate name', async () => {
      // Arrange
      const input = { name: 'Existing Resource' }
      prismaMock.newResource.findFirst.mockResolvedValue({ id: 'existing-1' } as any)

      // Act & Assert
      await expect(service.createResource(input)).rejects.toThrow('already exists')
    })
  })
})
```

### Writing Integration Tests

```typescript
// tests/integration/newResource.test.ts
import { PrismaClient } from '@prisma/client'
import { NewResourceService } from '../../app/services/NewResourceService'
import { setupTestDatabase, cleanupTestDatabase } from '../setup/test-helpers'

describe('NewResource Integration', () => {
  let prisma: PrismaClient
  let service: NewResourceService

  beforeAll(async () => {
    prisma = await setupTestDatabase()
    service = new NewResourceService(prisma, mockEventManager)
  })

  afterAll(async () => {
    await cleanupTestDatabase(prisma)
  })

  beforeEach(async () => {
    await prisma.newResource.deleteMany()
  })

  it('should persist resource to database', async () => {
    // Arrange
    const input = { name: 'Integration Test Resource' }

    // Act
    const result = await service.createResource(input)

    // Assert
    const saved = await prisma.newResource.findUnique({
      where: { id: result.id }
    })
    expect(saved).toBeDefined()
    expect(saved?.name).toBe(input.name)
  })
})
```

## Debugging & Logging

### Debug Configuration

Infinibay uses the `debug` package for categorized logging:

```typescript
// Enable specific debug categories
DEBUG=infinibay:virt-manager npm run dev

// Enable all infinibay debug output
DEBUG=infinibay:* npm run dev

// Enable error-level debugging only
DEBUG=infinibay:*:error npm run dev
```

### Creating Debug Loggers

```typescript
// app/services/NewResourceService.ts
import { Debugger } from '@utils/debug'

export class NewResourceService {
  private debug = new Debugger('new-resource-service')

  async createResource(data: CreateResourceData): Promise<Resource> {
    this.debug.log('Creating new resource', data.name)

    try {
      const resource = await this.performCreate(data)
      this.debug.log('Resource created successfully', resource.id)
      return resource
    } catch (error) {
      this.debug.error('Failed to create resource', error)
      throw error
    }
  }
}
```

### Structured Logging

```typescript
// app/utils/logger.ts
import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
})

// Usage in services
logger.info('Resource created', { resourceId: resource.id, userId: user.id })
logger.error('Database connection failed', { error: error.message })
```

### Error Tracking

```typescript
// app/utils/errorHandler.ts
export class ErrorHandler {
  static handle(error: Error, context: string): void {
    // Log error with context
    logger.error('Unhandled error', {
      error: error.message,
      stack: error.stack,
      context
    })

    // Send to monitoring service (e.g., Sentry)
    if (process.env.NODE_ENV === 'production') {
      // Sentry.captureException(error)
    }
  }
}
```

## Performance Optimization

### Database Optimization

#### Query Optimization

```typescript
// Good: Use indexes for frequent queries
await prisma.machine.findMany({
  where: {
    status: 'running',    // Should have index
    userId: user.id       // Should have index
  }
})

// Good: Limit results for large datasets
await prisma.systemMetrics.findMany({
  where: { machineId },
  orderBy: { timestamp: 'desc' },
  take: 100  // Limit results
})
```

#### Connection Pooling

```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Connection pooling is handled by Prisma automatically
}
```

### Memory Management

```typescript
// Good: Stream large datasets
async function* streamMachines(): AsyncGenerator<Machine, void, unknown> {
  let cursor: string | undefined
  const batchSize = 100

  while (true) {
    const machines = await prisma.machine.findMany({
      take: batchSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' }
    })

    if (machines.length === 0) break

    for (const machine of machines) {
      yield machine
    }

    cursor = machines[machines.length - 1].id
  }
}
```

### Caching Strategies

```typescript
// app/utils/cache.ts
import NodeCache from 'node-cache'

class CacheService {
  private cache = new NodeCache({ stdTTL: 300 }) // 5 minutes default

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key)
  }

  set(key: string, value: any, ttl?: number): void {
    this.cache.set(key, value, ttl)
  }

  del(key: string): void {
    this.cache.del(key)
  }
}

export const cache = new CacheService()
```

## Deployment

### Production Build

```bash
# Build TypeScript
npm run build

# Install production dependencies only
npm ci --only=production

# Run database migrations
npm run db:migrate

# Start production server
npm start
```

### Environment Setup

```bash
# Production environment variables
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://user:pass@prod-db:5432/infinibay"
TOKENKEY="secure-production-secret"
DEBUG=infinibay:error
```

### Health Checks

```typescript
// app/routes/health.ts
export const healthCheck = async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`

    // Check libvirt connection
    const connection = Connection.open('qemu:///system')
    const isAlive = connection.isAlive()
    connection.close()

    if (!isAlive) {
      throw new Error('Libvirt connection failed')
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}
```

## Troubleshooting

### Common Issues

#### Database Connection Issues

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection string
psql $DATABASE_URL

# Reset database (development only)
npm run db:reset
```

#### Libvirt Connection Issues

```bash
# Check libvirt daemon
sudo systemctl status libvirtd

# Test libvirt connection
virsh list --all

# Check permissions
sudo usermod -aG libvirt $USER
```

#### GraphQL Schema Issues

```bash
# Regenerate schema
npm run build

# Check for TypeGraphQL errors
npm run lint
```

### Debug Information

```typescript
// Get comprehensive debug info
const debugInfo = {
  nodeVersion: process.version,
  environment: process.env.NODE_ENV,
  uptime: process.uptime(),
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage(),
  databaseConnected: await checkDatabaseConnection(),
  libvirtConnected: await checkLibvirtConnection()
}
```

### Performance Monitoring

```typescript
// Monitor query performance
const startTime = Date.now()
const result = await prisma.machine.findMany()
const queryTime = Date.now() - startTime

if (queryTime > 1000) {
  logger.warn('Slow query detected', { queryTime, operation: 'findManyMachines' })
}
```

This developer guide provides the foundation for effective development on the Infinibay backend system. Follow these guidelines to maintain code quality, performance, and reliability while building new features and maintaining existing functionality.