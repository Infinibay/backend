# AGENTS.md
This file provides guidance to AI coding assistants working in this repository.

**Note:** CLAUDE.md, .clinerules, .cursorrules, .windsurfrules, and other AI config files are symlinks to AGENTS.md in this project.

# Infinibay Backend

GraphQL API server for Infinibay - a virtualization management platform built with a microservices architecture. The backend manages virtual machines through libvirt, provides real-time updates via WebSocket, and handles VM lifecycle, networking, and security.

## Architecture Overview

- **GraphQL API**: Apollo Server with TypeGraphQL for type-safe schema generation
- **Database**: PostgreSQL with Prisma ORM for type-safe database operations
- **Real-time**: Socket.io for WebSocket communication and real-time VM events
- **Virtualization**: Custom libvirt Node.js bindings (Rust-based) for VM management
- **Security**: Network filters, firewall rules, and department-based VM organization
- **Services**: Event managers, cleanup services, and background tasks via cron
- **InfiniService**: Rust-based VM data collection service (separate repo at /opt/infinibay/infiniservice)

## Build & Commands

### Development
```bash
npm run dev             # Start dev server with DEBUG=* (port 4000)
npm run dev:verbose     # Dev server with virtio-socket debug logs
npm start              # Start server without debug logs
```

### Testing
```bash
npm test               # Run all Jest tests
npm test -- tests/unit/             # Unit tests only
npm test -- tests/integration/       # Integration tests only
npm test -- --coverage              # Generate coverage report
npm test -- tests/unit/services/FirewallService.test.ts  # Run specific test file
```

### Linting & Type Checking
```bash
npm run lint           # Run ESLint on .ts,.tsx files
npm run lint:fix       # Auto-fix linting issues
npm run tsc            # Run TypeScript compiler check
npm run build          # Compile TypeScript to dist/
```

### Database Management
```bash
npm run db:migrate     # Run Prisma migrations
npm run db:reset       # Reset database
npm run db:generate    # Generate Prisma client
npm run db:seed        # Seed database with initial data
npm run seed           # Alternative seed command
```

### Setup & Maintenance
```bash
npm run setup          # Initial system setup (downloads ISOs, configures libvirt)
npm run cleanup:nwfilters        # Clean orphaned network filters
npm run cleanup:nwfilters:force  # Force clean all orphaned filters
npm run cleanup:temp-isos        # Clean temporary ISO files
npm run migrate:isos             # Migrate ISO storage
npm run download:windows         # Download Windows ISO
```

### Script Command Consistency
**Important**: When modifying npm scripts in package.json, ensure all references are updated:
- GitHub Actions workflows (.github/workflows/*.yml)
- README.md documentation
- Docker configuration files
- Contributing guides
- Setup/installation scripts

## Code Style

### TypeScript Standards
- **Strict mode**: All TypeScript strict options enabled
- **No any types**: NEVER use `any` type - use proper interfaces, union types, or `unknown`
- **Path aliases**: Use `@main`, `@services`, `@graphql`, `@utils`, `@resolvers` for imports
- **Decorators**: Use TypeGraphQL decorators for GraphQL schema
- **Async/Await**: Prefer async/await over callbacks or raw promises


### Naming Conventions
- **Files**: camelCase for files (e.g., `machineLifecycleService.ts`)
- **Classes**: PascalCase (e.g., `FirewallService`)
- **Functions/Methods**: camelCase (e.g., `getVmFilter()`)
- **Variables**: camelCase (e.g., `vmEventManager`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `KNOWN_SERVICES`)
- **Interfaces/Types**: PascalCase with descriptive names

### Coding notes
- **libvirt-node**: Use app/utils/libvirt.ts instead of anything else for libvirt
- **Executing commands in vm**: To Execute commands in the vm, use infiniservice interface/library instead of qemu quest tools.
- **Documentacion**: We hace some documentations in the docs/ directory. Please update them as needed.

### Import Organization
```typescript
// 1. External imports
import 'reflect-metadata'
import { describe, it, expect } from '@jest/globals'

// 2. Internal absolute imports (using path aliases)
import { FirewallService } from '@services/firewallService'
import { VirtManager } from '@utils/VirtManager'

// 3. Relative imports
import { withTimestamps } from './test-utils'

// 4. Type imports
import type { Machine, User } from '@prisma/client'
```

### Error Handling
- Use custom error classes extending Error
- Always handle promise rejections
- Log errors with appropriate debug levels
- Provide meaningful error messages for GraphQL

### Function Guidelines
- Keep functions short and focused (10-20 lines ideal)
- Single responsibility principle
- Use early returns to reduce nesting
- Document complex logic with comments explaining "why"

## Testing

### Testing Framework
- **Framework**: Jest with ts-jest for TypeScript support
- **Test files**: Located in `tests/` directory
- **Patterns**: `*.test.ts` or `*.spec.ts`
- **Mocking**: jest-mock-extended for type-safe mocks
- **Coverage**: Target high coverage but prioritize meaningful tests

### Testing Philosophy
**When tests fail, and the test is correct, fix the code, not the test.** 

Key principles:
- **Tests should be meaningful** - Avoid tests that always pass regardless of behavior
- **Test actual functionality** - Call the functions being tested, don't just check side effects
- **Failing tests are valuable** - They reveal bugs or missing features
- **Fix the root cause** - When a test fails, fix the underlying issue, don't hide the test
- **Mock external dependencies** - Always mock libvirt-node and external services
- **Use mock factories** - Located in `tests/setup/mock-factories.ts`

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/services/FirewallService.test.ts

# Run with coverage
npm test -- --coverage

# Run only unit tests
npm test -- tests/unit/

# Run only integration tests  
npm test -- tests/integration/

# Run tests matching pattern
npm test -- -t "should create VM"
```

### Test Structure
```typescript
import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { createMockMachine, createMockUser } from '../../setup/mock-factories'
import { mockPrisma } from '../../setup/jest.setup'

describe('ServiceName', () => {
  let service: ServiceClass
  
  beforeEach(() => {
    jest.clearAllMocks()
    service = new ServiceClass(mockPrisma)
  })
  
  describe('methodName', () => {
    it('should perform expected behavior', async () => {
      // Arrange
      const mockData = createMockMachine()
      mockPrisma.machine.findUnique.mockResolvedValue(mockData)
      
      // Act
      const result = await service.method()
      
      // Assert
      expect(result).toBeDefined()
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith(...)
    })
  })
})
```

## Security

### Authentication & Authorization
- JWT-based authentication with jsonwebtoken
- Role-based access control (USER, ADMIN)
- Auth middleware for protected routes
- Context-based authorization in GraphQL resolvers

### Network Security
- Network filters via libvirt for VM isolation
- Department-based security policies
- Firewall rules management per VM
- Service-level access control (use/provide permissions)

### Data Protection
- Password hashing with bcrypt (10 rounds)
- Environment variables for sensitive configuration
- No secrets in code or logs
- Secure VM communication via virtio sockets

### Security Best Practices
- Input validation on all GraphQL mutations
- SQL injection prevention via Prisma parameterized queries
- XSS prevention in GraphQL responses
- Rate limiting considerations for API endpoints

## Directory Structure & File Organization

### Backend Structure
```
backend/
├── app/                      # Main application code
│   ├── config/              # Configuration files
│   ├── crons/               # Background tasks
│   ├── graphql/             # GraphQL schema and resolvers
│   │   ├── resolvers/       # Individual resolvers
│   │   └── types/           # GraphQL type definitions
│   ├── middleware/          # Express middleware
│   ├── routes/              # REST endpoints
│   ├── services/            # Business logic services
│   ├── templates/           # Templates for unattended installs
│   ├── utils/               # Utility functions
│   │   └── VirtManager/     # VM management utilities
│   └── index.ts            # Entry point
├── prisma/                  # Database schema and migrations
├── tests/                   # Test files
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── setup/              # Test utilities and mocks
├── scripts/                 # Utility scripts
├── docs/                    # Documentation
├── reports/                 # Generated reports (DO NOT COMMIT)
└── temp/                    # Temporary files (DO NOT COMMIT)
```

### Reports Directory
ALL project reports and documentation should be saved to the `reports/` directory:

```
backend/
├── reports/              # All project reports and documentation
│   └── *.md             # Various report types
├── temp/                # Temporary files and debugging
└── [other directories]
```

### Report Generation Guidelines
**Important**: ALL reports should be saved to the `reports/` directory with descriptive names:

**Implementation Reports:**
- Phase validation: `PHASE_X_VALIDATION_REPORT.md`
- Implementation summaries: `IMPLEMENTATION_SUMMARY_[FEATURE].md`
- Feature completion: `FEATURE_[NAME]_REPORT.md`

**Testing & Analysis Reports:**
- Test results: `TEST_RESULTS_[DATE].md`
- Coverage reports: `COVERAGE_REPORT_[DATE].md`
- Performance analysis: `PERFORMANCE_ANALYSIS_[SCENARIO].md`
- Security scans: `SECURITY_SCAN_[DATE].md`

**Quality & Validation:**
- Code quality: `CODE_QUALITY_REPORT.md`
- Dependency analysis: `DEPENDENCY_REPORT.md`
- API compatibility: `API_COMPATIBILITY_REPORT.md`

**Report Naming Conventions:**
- Use descriptive names: `[TYPE]_[SCOPE]_[DATE].md`
- Include dates: `YYYY-MM-DD` format
- Group with prefixes: `TEST_`, `PERFORMANCE_`, `SECURITY_`
- Markdown format: All reports end in `.md`

### Temporary Files & Debugging
All temporary files, debugging scripts, and test artifacts should be organized in a `/temp` folder:

**Temporary File Organization:**
- **Debug scripts**: `temp/debug-*.js`, `temp/analyze-*.py`
- **Test artifacts**: `temp/test-results/`, `temp/coverage/`
- **Generated files**: `temp/generated/`, `temp/build-artifacts/`
- **Logs**: `temp/logs/debug.log`, `temp/logs/error.log`

**Guidelines:**
- Never commit files from `/temp` directory
- Use `/temp` for all debugging and analysis scripts created during development
- Clean up `/temp` directory regularly or use automated cleanup
- Include `/temp/` in `.gitignore` to prevent accidental commits

## Configuration

### Environment Variables
Required environment variables (see .env.example):
```bash
DATABASE_URL          # PostgreSQL connection string
FRONTEND_URL         # CORS origin for frontend
TOKENKEY            # JWT secret key
PORT                # Server port (default: 4000)
BCRYPT_ROUNDS       # Password hashing rounds (default: 10)
RPC_URL             # InfiniService RPC URL
VIRTIO_WIN_ISO_PATH # Path to VirtIO drivers ISO
APP_HOST            # Application host IP
INFINIBAY_BASE_DIR  # Base directory for Infinibay files
INFINIBAY_STORAGE_POOL_NAME # Libvirt storage pool name
GRAPHIC_HOST        # VNC/SPICE graphics host
BRIDGE_NAME         # Network bridge name
```

### Database Setup
1. Install PostgreSQL
2. Create database and user
3. Configure connection in .env
4. Run migrations: `npm run db:migrate`
5. Seed initial data: `npm run db:seed`

### Libvirt Configuration
- Requires KVM/QEMU installed
- Network bridge configured
- Storage pool created
- Proper permissions for libvirt socket

## Key Development Patterns

### GraphQL Resolver Pattern
```typescript
@Resolver(of => Machine)
export class MachineResolver {
  @Query(returns => [Machine])
  async machines(@Ctx() ctx: InfinibayContext) {
    return ctx.prisma.machine.findMany()
  }
  
  @Mutation(returns => Machine)
  async createMachine(
    @Arg('input') input: CreateMachineInput,
    @Ctx() ctx: InfinibayContext
  ) {
    // Implementation
  }
}
```

### Service Pattern
```typescript
export class ServiceName {
  constructor(private prisma: PrismaClient) {}
  
  async methodName(params: ParamsType): Promise<ReturnType> {
    // Business logic
  }
}
```

### Event Manager Pattern
```typescript
export class EventManager extends EventEmitter {
  private static instance: EventManager
  
  static getInstance(): EventManager {
    if (!this.instance) {
      this.instance = new EventManager()
    }
    return this.instance
  }
}
```

## Important Notes

1. **Libvirt Mocking**: Always mock libvirt-node in tests (see `__mocks__/libvirt-node.js`)
2. **VM Management**: Core VM operations are in `app/utils/VirtManager/`
3. **Real-time Updates**: Use appropriate EventManager for real-time updates
4. **Security**: All VM operations go through security service checks
5. **InfiniService**: VM metrics collection service at `/opt/infinibay/infiniservice`
6. **Department Organization**: VMs organized by departments with security policies
7. **GraphQL Schema**: Auto-generated from TypeGraphQL decorators to `app/schema.graphql`
8. **Socket Communication**: VirtioSocketWatcherService handles VM communication
9. **Testing**: Never modify tests to pass - fix the underlying code
10. **Type Safety**: NEVER use `any` type - enforced by git hooks

## Troubleshooting

### Common Issues
1. **Libvirt connection errors**: Check permissions and socket availability
2. **Database connection**: Verify PostgreSQL is running and credentials are correct
3. **Port conflicts**: Ensure port 4000 is available
4. **Test failures**: Mock libvirt-node properly, use mock factories
5. **TypeScript errors**: Run `npm run tsc` to check types

### Debug Commands
```bash
# Enable all debug logs
DEBUG=* npm start

# Debug specific module
DEBUG=infinibay:virtio-socket:* npm start

# Check libvirt connection
virsh list --all

# Check PostgreSQL
psql -U username -d database_name
```

## Contributing

1. Follow existing code patterns and conventions
2. Write meaningful tests for new features
3. Ensure all tests pass before committing
4. Use proper TypeScript types (no `any`)
5. Update documentation when adding features
6. Follow SOLID principles and clean code practices
7. Use existing mock factories for tests

## External Dependencies

- **libvirt-node**: Custom Rust bindings at `lib/libvirt-node/`
- **InfiniService**: VM agent at `/opt/infinibay/infiniservice`
- **PostgreSQL**: Database server
- **KVM/QEMU**: Virtualization backend
- **Socket directories**: `/opt/infinibay/sockets`

## Agent Delegation & Tool Execution

### ⚠️ MANDATORY: Always Execute Tools in Parallel

**When performing multiple operations, send all tool calls in a single message to execute them concurrently for optimal performance.**

#### Critical: Always Use Parallel Tool Calls

**IMPORTANT: Send all tool calls in a single message to execute them in parallel.**

**These cases MUST use parallel tool calls:**
- Multiple file reads or searches
- Running multiple test files
- Database queries that don't depend on each other
- Multiple GraphQL resolver checks
- Service initialization checks

**Example of parallel execution:**
```typescript
// Execute multiple operations simultaneously
Promise.all([
  prisma.machine.findMany(),
  prisma.user.findMany(),
  service.getStats()
])
```

**Performance Impact:** Parallel execution is 3-5x faster than sequential calls, significantly improving development speed.

**Remember:** This is not just an optimization—it's the expected behavior for efficient development.