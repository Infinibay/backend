# Backend Development Guidelines

This document provides comprehensive guidelines for developing, extending, and maintaining the Infinibay backend system. It covers application architecture, service patterns, integration points, and best practices.

## Technology Stack

- **Node.js**: >=18.18.0
- **TypeScript**: 5.3.3
- **Prisma ORM**: 6.16.3 (PostgreSQL)
- **Apollo Server**: GraphQL API
- **Socket.io**: Real-time communication
- **libvirt-node**: Native libvirt bindings (imported from `@infinibay/libvirt-node`)

### Important Notes

- **Prisma 6**: Uses `Uint8Array` for `Bytes` type fields (previously `Buffer` in Prisma 5)
- **libvirt-node imports**: Always use `@infinibay/libvirt-node` instead of relative paths

## Table of Contents

- [Application Initialization](#application-initialization)
- [Integration with Other Repositories](#integration-with-other-repositories)
- [Real-time Event System](#real-time-event-system)
- [Services Overview](#services-overview)
- [Callback System](#callback-system)
- [Additional Routes](#additional-routes)
- [Design Patterns](#design-patterns)
- [Directory Schema](#directory-schema)
- [Utilities](#utilities)
- [Best Practices](#best-practices)

---

## Application Initialization

### Bootstrap Process

The application initialization follows a strict sequence to ensure all dependencies are ready before the server starts accepting requests. The entire process is orchestrated in `app/index.ts`.

```typescript
// app/index.ts - Bootstrap sequence
async function bootstrap(): Promise<void> {
  // 1. Clean up stale GPU assignments
  await checkGpuAffinity(prisma)

  // 2. Initialize Express and HTTP server
  const app = express()
  const httpServer = http.createServer(app)

  // 3. Configure base server settings (CORS, body parser, timeout, etc.)
  configureServer(app, httpServer)

  // 4. Configure REST routes (/health, /isoUpload, /infiniservice, etc.)
  configureRoutes(app)

  // 5. Initialize VirtioSocketWatcher early (for GraphQL context)
  const virtioSocketWatcher = createVirtioSocketWatcherService(prisma)

  // 6. Initialize Apollo GraphQL Server
  const apolloServer = await createApolloServer()
  await apolloServer.start()

  // 7. Apply Apollo middleware with context creation
  app.use('/graphql', cors(...), expressMiddleware(apolloServer, { context: ... }))

  // 8. Install Prisma callbacks (lifecycle hooks)
  installCallbacks(prisma)

  // 9. Initialize Socket.io and Event Management
  const socketService = createSocketService(prisma)
  socketService.initialize(httpServer)
  const eventManager = createEventManager(socketService, prisma)

  // 10. Initialize Error Handler
  ErrorHandler.initialize(prisma, eventManager)

  // 11. Register resource event managers
  eventManager.registerResourceManager('vms', new VmEventManager(...))
  eventManager.registerResourceManager('users', new UserEventManager(...))
  eventManager.registerResourceManager('departments', new DepartmentEventManager(...))
  eventManager.registerResourceManager('applications', new ApplicationEventManager(...))

  // 12. Initialize health monitoring system
  const healthQueueManager = new VMHealthQueueManager(prisma, eventManager)
  const backgroundHealthService = new BackgroundHealthService(...)
  backgroundHealthService.start()

  // 13. Start VirtioSocketWatcherService
  await virtioSocketWatcher.start()

  // 14. Start cron jobs
  await startCrons()

  // 15. Start HTTP server
  httpServer.listen({ port, host })
}
```

### Initialization Order Rationale

**Why this specific order?**

1. **GPU Cleanup First**: Prevents resource conflicts before any VM operations
2. **Server Infrastructure**: HTTP server must exist before any services attach to it
3. **VirtioSocketWatcher Early**: Needed in GraphQL context for real-time VM communication
4. **Apollo After Routes**: GraphQL endpoint is just another route, but requires more setup
5. **Callbacks Before Operations**: Prisma middleware must be registered before any database operations
6. **Socket.io Before Events**: EventManager depends on SocketService for broadcasting
7. **Event Managers Before Services**: Services will trigger events during initialization
8. **Monitoring Services Last**: They depend on all previous infrastructure being ready
9. **Crons After All**: Background jobs should only start when the system is fully initialized

### Key Configuration Files

#### `app/config/server.ts`

Configures Express server with middleware:

```typescript
export function configureServer(app: Express, httpServer: Server): void {
  // Body parsing
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true, limit: '50mb' }))

  // CORS configuration
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }))

  // Request timeout (10 minutes for long-running operations)
  app.use(connectTimeout('600s'))

  // Static file serving
  app.use('/public', express.static('public'))
}
```

#### `app/config/apollo.ts`

Creates Apollo GraphQL server with TypeGraphQL:

```typescript
export const createApolloServer = async (): Promise<ApolloServer> => {
  const schema = await buildSchema({
    resolvers,                    // All GraphQL resolvers
    emitSchemaFile: 'schema.graphql',  // Auto-generate schema file
    authChecker                   // Authorization checker for @Authorized decorators
  })

  return new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    formatError: (error) => {
      // Custom error formatting for GraphQL responses
      // Handles UNAUTHORIZED, FORBIDDEN, NOT_FOUND codes
    }
  })
}
```

#### `app/config/routes.ts`

Registers all REST endpoints:

```typescript
export const configureRoutes = (app: Express): void => {
  app.get('/health', (req, res) => res.status(200).send('OK'))
  app.use('/isoUpload', isoUploadRouter)
  app.use('/infiniservice', infiniserviceRouter)
  app.use('/api/wallpapers', wallpapersRouter)
  app.use('/api/avatars', avatarsRouter)
}
```

### GraphQL Context Creation

Every GraphQL request creates a context with authenticated user and services:

```typescript
// In app/index.ts - Apollo middleware configuration
context: async ({ req, res }): Promise<InfinibayContext> => {
  // 1. Verify JWT token
  const authResult = await verifyRequestAuth(req, { method: 'context', debugAuth })

  // 2. Create user validation helpers
  const userHelpers = createUserValidationHelpers(authResult.user, authResult.meta)

  // 3. Return context with all dependencies
  return {
    prisma,                    // Database client
    req, res,                  // Express request/response
    user: authResult.user,     // Authenticated user (or null)
    setupMode: false,          // Whether in initial setup mode
    virtioSocketWatcher,       // VM communication service
    auth: authResult.meta,     // Authentication metadata
    userHelpers                // Convenience methods for auth checks
  }
}
```

**Context Usage in Resolvers:**

```typescript
@Resolver()
export class MachineResolver {
  @Query(() => [Machine])
  @Authorized('USER')  // Requires authentication
  async machines(@Ctx() ctx: InfinibayContext): Promise<Machine[]> {
    // Access authenticated user
    const userId = ctx.user?.id

    // Use Prisma client
    return ctx.prisma.machine.findMany({
      where: { userId }
    })
  }
}
```

### Graceful Shutdown

The application handles shutdown signals properly:

```typescript
async function shutdown(): Promise<void> {
  console.log('🛑 Shutting down gracefully...')

  // 1. Stop VirtioSocketWatcherService
  if (virtioSocketWatcherService) {
    await virtioSocketWatcherService.stop()
  }

  // 2. Disconnect Prisma
  await prisma.$disconnect()

  // 3. Exit process
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

---

## Integration with Other Repositories

### libvirt-node Integration

**What it is**: Rust-based NAPI bindings that provide Node.js access to libvirt's C API for hypervisor control.

**Location**: `node_modules/@infinibay/libvirt-node` (published package) or `lib/libvirt-node` (local development)

#### LibvirtConnectionPool Service

The backend doesn't use libvirt-node directly. Instead, it uses a connection pool for efficiency:

```typescript
// app/services/LibvirtConnectionPool.ts
export class LibvirtConnectionPool extends SingletonService {
  private pool: PooledConnection[] = []

  constructor(config: ServiceConfig) {
    super(config)
    this.poolConfig = {
      minConnections: 2,
      maxConnections: 10,
      acquireTimeout: 30000,
      idleTimeout: 60000,
      connectionUri: 'qemu:///system'
    }
  }

  // Get a connection from the pool
  async acquire(): Promise<Connection> {
    // 1. Find available connection
    const available = this.pool.find(c => !c.inUse)
    if (available) {
      available.inUse = true
      return available.connection
    }

    // 2. Create new connection if pool not full
    if (this.pool.length < this.poolConfig.maxConnections) {
      return this.createConnection()
    }

    // 3. Wait for connection to become available
    return this.waitForConnection()
  }

  // Release connection back to pool
  release(connection: Connection): void {
    const pooled = this.pool.find(c => c.connection === connection)
    if (pooled) {
      pooled.inUse = false
      pooled.lastUsed = Date.now()
    }
  }
}
```

**Usage Pattern:**

```typescript
// In VirtManager or other libvirt-dependent services
import { Connection } from '@infinibay/libvirt-node'
import { LibvirtConnectionPool } from '@services/LibvirtConnectionPool'

export class VirtManager {
  async createMachine(...): Promise<void> {
    // 1. Get connection from pool
    const pool = LibvirtConnectionPool.getPoolInstance(prisma)
    const connection = await pool.acquire()

    try {
      // 2. Perform libvirt operations
      const domain = VirtualMachine.defineXML(connection, xmlConfig)
      domain.create()

      // 3. Return connection to pool
      pool.release(connection)
    } catch (error) {
      pool.release(connection)
      throw error
    }
  }
}
```

**Why Connection Pooling?**

- **Performance**: Reuses existing connections instead of opening new ones
- **Resource Management**: Limits concurrent connections to hypervisor
- **Stability**: Prevents connection exhaustion under high load
- **Automatic Cleanup**: Removes idle connections after timeout

#### Common libvirt-node Operations

```typescript
import { Connection, VirtualMachine, Network, StoragePool } from '@infinibay/libvirt-node'

// 1. VM Lifecycle Operations
const connection = Connection.open('qemu:///system')
const domain = VirtualMachine.lookupByName(connection, 'my-vm')

domain.create()          // Start VM
domain.shutdown()        // Graceful shutdown
domain.destroy()         // Force power off
domain.suspend()         // Pause VM
domain.resume()          // Resume VM
domain.undefine()        // Delete VM definition

// 2. VM Information
const info = domain.getInfo()
const state = domain.getState()
const xmlDesc = domain.getXMLDesc()

// 3. Network Operations
const network = Network.lookupByName(connection, 'default')
network.create()         // Start network
network.destroy()        // Stop network

// 4. Storage Operations
const pool = StoragePool.lookupByName(connection, 'default')
const volume = pool.createVolume(xmlConfig)
volume.delete()          // Remove volume

connection.close()
```

### infiniservice Integration

**What it is**: Rust-based guest agent that runs inside VMs to collect system metrics and communicate via VirtIO serial channel.

**Communication Channel**: VirtIO serial device (`org.infinibay.agent`)

#### VirtioSocketWatcherService

This service monitors VirtIO serial connections from guest VMs:

```typescript
// app/services/VirtioSocketWatcherService.ts
export class VirtioSocketWatcherService extends EventEmitter {
  private connections: Map<string, VirtioConnection> = new Map()
  private watcher?: chokidar.FSWatcher

  async start(): Promise<void> {
    // 1. Watch for new VirtIO serial sockets
    const socketDir = '/var/lib/libvirt/qemu/channel/target'
    this.watcher = chokidar.watch(`${socketDir}/*.sock`, {
      persistent: true,
      ignoreInitial: false
    })

    // 2. Handle new socket connections
    this.watcher.on('add', (path) => {
      this.handleNewSocket(path)
    })

    // 3. Handle socket removal
    this.watcher.on('unlink', (path) => {
      this.handleSocketRemoved(path)
    })
  }

  private handleNewSocket(socketPath: string): void {
    // Extract VM ID from socket path
    const vmId = this.extractVmIdFromPath(socketPath)

    // Connect to socket
    const socket = net.connect(socketPath)

    // Handle incoming metrics data
    socket.on('data', (data) => {
      const message = this.parseMessage(data)
      this.processMessage(vmId, message)
    })

    this.connections.set(vmId, { socket, socketPath })
  }

  private async processMessage(vmId: string, message: BaseMessage): Promise<void> {
    switch (message.type) {
      case 'metrics':
        await this.handleMetrics(vmId, message as MetricsMessage)
        break
      case 'handshake':
        await this.handleHandshake(vmId, message)
        break
      case 'error':
        await this.handleError(vmId, message as ErrorMessage)
        break
    }
  }

  private async handleMetrics(vmId: string, message: MetricsMessage): Promise<void> {
    // 1. Store metrics in database
    await this.prisma.systemMetrics.create({
      data: {
        machineId: vmId,
        cpuUsage: message.data.system.cpu.usage_percent,
        memoryUsage: message.data.system.memory.used_kb,
        diskUsage: message.data.system.disk.usage_stats,
        networkStats: message.data.system.network.interfaces,
        timestamp: new Date(message.timestamp)
      }
    })

    // 2. Emit real-time update
    this.emit('metricsUpdated', { vmId, metrics: message.data })

    // 3. Trigger health check if needed
    if (this.healthQueueManager) {
      await this.healthQueueManager.enqueueHealthCheck(vmId, 'metrics_based')
    }
  }
}
```

**Message Format from infiniservice:**

```typescript
// Metrics message structure
interface MetricsMessage {
  type: 'metrics'
  timestamp: string
  data: {
    system: {
      cpu: {
        usage_percent: number
        cores_usage: number[]
        temperature?: number
      }
      memory: {
        total_kb: number
        used_kb: number
        available_kb: number
        swap_total_kb?: number
        swap_used_kb?: number
      }
      disk: {
        usage_stats: Array<{
          mount_point: string
          total_gb: number
          used_gb: number
          available_gb: number
        }>
        io_stats: {
          read_bytes_per_sec: number
          write_bytes_per_sec: number
        }
      }
      network: {
        interfaces: Array<{
          name: string
          bytes_received: number
          bytes_sent: number
          packets_received: number
          packets_sent: number
          ip_addresses?: string[]
        }>
      }
      uptime_seconds: number
    }
    processes?: Array<{
      pid: number
      name: string
      cpu_percent: number
      memory_kb: number
    }>
  }
}
```

**Debug Control:**

```bash
# See all VirtIO socket messages
DEBUG=infinibay:virtio-socket:* npm run dev

# See only errors/warnings
DEBUG=infinibay:virtio-socket:error,infinibay:virtio-socket:warn npm run dev

# Disable VirtIO logging
npm run dev
```

### Frontend Integration

The backend communicates with the frontend through two channels:

#### 1. GraphQL API

**Endpoint**: `http://localhost:4000/graphql`

**Frontend Code Generation Workflow:**

1. Backend changes GraphQL schema (TypeGraphQL resolvers)
2. Schema auto-generated at `app/schema.graphql`
3. Frontend defines operations in `.graphql` files
4. Frontend runs `npm run codegen` to generate TypeScript hooks
5. Frontend uses generated hooks from `@/gql/hooks`

**Example Backend Resolver:**

```typescript
// app/graphql/resolvers/machine/resolver.ts
@Resolver()
export class MachineResolver {
  @Query(() => Machine)
  @Authorized('USER')
  async machine(
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<Machine | null> {
    return prisma.machine.findUnique({
      where: { id },
      include: {
        user: true,
        template: true,
        department: true
      }
    })
  }

  @Mutation(() => Machine)
  @Authorized('ADMIN')
  async createMachine(
    @Arg('input') input: CreateMachineInput,
    @Ctx() { prisma, user, eventManager }: InfinibayContext
  ): Promise<Machine> {
    // Create machine
    const machine = await prisma.machine.create({ data: input })

    // Trigger real-time event
    await eventManager?.vmCreated(machine, user?.id)

    return machine
  }
}
```

**Frontend Usage (auto-generated):**

```typescript
// Frontend: src/gql/queries/vm.graphql
query GetMachine($id: ID!) {
  machine(id: $id) {
    id
    name
    status
    user { id email }
    template { id name }
  }
}

// Frontend: Component usage
import { useGetMachineQuery } from '@/gql/hooks'

const { data, loading, error } = useGetMachineQuery({
  variables: { id: vmId }
})
```

#### 2. Socket.io Real-time Events

**Endpoint**: `http://localhost:4000` (WebSocket upgrade)

**Authentication**: JWT token in handshake

**Event Format:**

```typescript
// Event name pattern: {namespace}:{resource}:{action}
// Example: "user_a1b2c3d4:vms:create"

// Event payload structure
interface EventPayload {
  status: 'success' | 'error'
  error: string | null
  data: any | null
  timestamp: string
}
```

**Backend Event Broadcasting:**

```typescript
// In a service or resolver
const eventManager = getEventManager()

// Broadcast VM creation to relevant users
await eventManager.vmCreated({
  id: newVm.id,
  name: newVm.name,
  status: newVm.status,
  userId: newVm.userId,
  departmentId: newVm.departmentId
}, triggeredByUserId)
```

**Event Flow:**

1. Service triggers event via `EventManager.dispatchEvent()`
2. EventManager routes to appropriate ResourceEventManager (e.g., VmEventManager)
3. ResourceEventManager determines target users based on permissions
4. SocketService broadcasts to each target user's namespace
5. Frontend receives event and updates Redux state automatically

**Frontend Integration (RealTimeReduxService):**

```typescript
// Frontend automatically receives and processes events
// Socket.io event: "user_a1b2c3d4:vms:create"
// → Dispatched to Redux: dispatch(realTimeVmCreated(payload.data))
// → UI updates automatically via Redux selectors
```

---

## Real-time Event System

### Architecture Overview

```
┌─────────────────┐
│   GraphQL API   │
│   Resolver      │
└────────┬────────┘
         │ Triggers
         ▼
┌─────────────────────────────────────┐
│      EventManager                   │
│  ┌──────────────────────────────┐   │
│  │ dispatchEvent(resource,      │   │
│  │   action, data, triggeredBy) │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼───────────────────┘
                  │ Routes to
                  ▼
┌─────────────────────────────────────┐
│  Resource Event Managers            │
│  ┌──────────────────────────────┐   │
│  │ VmEventManager               │   │
│  │ UserEventManager             │   │
│  │ DepartmentEventManager       │   │
│  │ ApplicationEventManager      │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼───────────────────┘
                  │ Determines target users
                  ▼
┌─────────────────────────────────────┐
│      SocketService                  │
│  ┌──────────────────────────────┐   │
│  │ sendToUser(userId,           │   │
│  │   resource, action, payload) │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼───────────────────┘
                  │ Broadcasts via WebSocket
                  ▼
┌─────────────────────────────────────┐
│       Frontend Clients              │
│  ┌──────────────────────────────┐   │
│  │ RealTimeReduxService         │   │
│  │ → Dispatches to Redux        │   │
│  │ → UI updates automatically   │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

### EventManager

**Purpose**: Central event coordination and routing

**Location**: `app/services/EventManager.ts`

```typescript
export class EventManager {
  private resourceManagers: Map<string, ResourceEventManager> = new Map()
  private socketService: SocketService

  constructor(socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Register resource-specific event handlers
  registerResourceManager(resource: string, manager: ResourceEventManager): void {
    this.resourceManagers.set(resource, manager)
  }

  // Main event dispatch method
  async dispatchEvent(
    resource: string,      // 'vms', 'users', 'departments', etc.
    action: EventAction,   // 'create', 'update', 'delete', etc.
    data: EventData,       // Event payload
    triggeredBy?: string   // User ID who triggered the event
  ): Promise<void> {
    // 1. Get appropriate resource manager
    const manager = this.resourceManagers.get(resource)
    if (!manager) {
      console.warn(`No event manager found for resource: ${resource}`)
      return
    }

    // 2. Let resource manager handle the event
    await manager.handleEvent(action, data, triggeredBy)
  }

  // Convenience methods for common events
  async vmCreated(vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'create', vmData, triggeredBy)
  }

  async vmUpdated(vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'update', vmData, triggeredBy)
  }

  async vmDeleted(vmData: EventData, triggeredBy?: string): Promise<void> {
    await this.dispatchEvent('vms', 'delete', vmData, triggeredBy)
  }
}
```

**Event Actions:**

```typescript
export type EventAction =
  | 'create' | 'update' | 'delete'
  | 'power_on' | 'power_off' | 'suspend' | 'resume'
  | 'registered' | 'removed' | 'validated'
  | 'progress' | 'status_changed'
  | 'health_check' | 'health_status_change' | 'remediation'
  | 'autocheck_issue_detected' | 'autocheck_remediation_available' | 'autocheck_remediation_completed'
  | 'round_started' | 'round_completed' | 'round_failed'
  | 'task_started' | 'task_completed' | 'task_failed'
  | 'maintenance_completed' | 'maintenance_failed'
  | 'started' | 'completed' | 'failed'
```

### Resource Event Managers

Each resource type has a dedicated event manager that implements `ResourceEventManager`:

```typescript
export interface ResourceEventManager {
  handleEvent(action: EventAction, data: EventData, triggeredBy?: string): Promise<void>
}
```

#### VmEventManager

**Location**: `app/services/VmEventManager.ts`

**Responsibilities:**
- Determine which users should receive VM events
- Fetch fresh VM data from database
- Apply permission-based filtering
- Broadcast to relevant users

```typescript
export class VmEventManager implements ResourceEventManager {
  constructor(
    private socketService: SocketService,
    private prisma: PrismaClient
  ) {}

  async handleEvent(action: EventAction, vmData: EventData, triggeredBy?: string): Promise<void> {
    // 1. Handle delete events specially (VM might not exist in DB)
    if (action === 'delete') {
      await this.handleVmDeleted(vmData, triggeredBy)
      return
    }

    // 2. Get fresh VM data from database
    const vm = await this.getVmData(vmData)
    if (!vm) {
      console.warn(`VM not found for event: ${vmData?.id}`)
      return
    }

    // 3. Determine target users based on permissions
    const targetUsers = await this.getTargetUsers(vm, action)

    // 4. Create event payload
    const payload: EventPayload = {
      status: 'success',
      data: vm
    }

    // 5. Send event to each target user
    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'vms', action, payload)
    }
  }

  // Permission-based targeting
  private async getTargetUsers(vm: VMData, action: EventAction): Promise<string[]> {
    const targetUsers: Set<string> = new Set()

    // 1. Always include VM owner
    if (vm.userId) {
      targetUsers.add(vm.userId)
    }

    // 2. Include all admin users
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deleted: false },
      select: { id: true }
    })
    adminUsers.forEach(admin => targetUsers.add(admin.id))

    // 3. Include users in same department
    if (vm.departmentId) {
      const departmentUsers = await this.prisma.user.findMany({
        where: {
          deleted: false,
          VM: { some: { departmentId: vm.departmentId } }
        },
        select: { id: true }
      })
      departmentUsers.forEach(user => targetUsers.add(user.id))
    }

    // 4. For 'create' events, broadcast to all users
    if (action === 'create') {
      const allActiveUsers = await this.prisma.user.findMany({
        where: { deleted: false },
        select: { id: true }
      })
      allActiveUsers.forEach(user => targetUsers.add(user.id))
    }

    return Array.from(targetUsers)
  }
}
```

#### UserEventManager

**Location**: `app/services/UserEventManager.ts`

**Key Differences:**
- Always broadcasts to all admin users
- Includes the affected user themselves
- Sensitive data (password, token) is excluded

```typescript
export class UserEventManager implements ResourceEventManager {
  async handleEvent(action: EventAction, userData: EventData, triggeredBy?: string): Promise<void> {
    // Get fresh user data (without sensitive fields)
    const user = await this.prisma.user.findUnique({
      where: { id: userData.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        deleted: true,
        // NEVER include: password, token
      }
    })

    if (!user) return

    // Broadcast to all admins
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deleted: false },
      select: { id: true }
    })

    const payload = { status: 'success', data: user }

    for (const admin of adminUsers) {
      this.socketService.sendToUser(admin.id, 'users', action, payload)
    }

    // Also send to the user themselves (for profile updates)
    if (action === 'update' && user.id) {
      this.socketService.sendToUser(user.id, 'users', action, payload)
    }
  }
}
```

#### DepartmentEventManager

**Location**: `app/services/DepartmentEventManager.ts`

**Key Features:**
- Broadcasts to all department members
- Includes admins
- Triggers related VM updates

```typescript
export class DepartmentEventManager implements ResourceEventManager {
  async handleEvent(action: EventAction, deptData: EventData, triggeredBy?: string): Promise<void> {
    const department = await this.prisma.department.findUnique({
      where: { id: deptData.id },
      include: {
        machines: { select: { userId: true } }
      }
    })

    if (!department) return

    // Get all users with VMs in this department
    const departmentUserIds = new Set(
      department.machines.map(m => m.userId).filter(Boolean)
    )

    // Add admins
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'ADMIN', deleted: false },
      select: { id: true }
    })
    adminUsers.forEach(admin => departmentUserIds.add(admin.id))

    // Broadcast to all relevant users
    const payload = { status: 'success', data: department }

    for (const userId of departmentUserIds) {
      this.socketService.sendToUser(userId, 'departments', action, payload)
    }
  }
}
```

### SocketService

**Location**: `app/services/SocketService.ts`

**Purpose**: Manages WebSocket connections and message broadcasting

```typescript
export class SocketService {
  private io: SocketIOServer | null = null
  private connectedUsers: Map<string, AuthenticatedSocket> = new Map()

  initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    })

    this.setupAuthentication()
    this.setupConnectionHandlers()
  }

  // JWT authentication middleware
  private setupAuthentication(): void {
    this.io?.use(async (socket: any, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization

        if (!token) {
          return next(new Error('Authentication token required'))
        }

        // Verify JWT
        const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as any

        // Fetch user
        const user = await this.prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, email: true, firstName: true, lastName: true, role: true }
        })

        if (!user) {
          return next(new Error('User not found'))
        }

        // Generate user namespace
        const userNamespace = `user_${user.id.substring(0, 8)}`

        // Attach to socket
        socket.userId = user.id
        socket.userRole = user.role
        socket.userNamespace = userNamespace
        socket.user = user

        next()
      } catch (error) {
        next(new Error('Authentication failed'))
      }
    })
  }

  // Connection handlers
  private setupConnectionHandlers(): void {
    this.io?.on('connection', (socket: any) => {
      console.log(`🔌 User connected: ${socket.user.email}`)

      // Store connected user
      this.connectedUsers.set(socket.userId, socket)

      // Join user to their namespace room
      socket.join(socket.userNamespace)

      // Join admins to admin room
      if (socket.userRole === 'ADMIN') {
        socket.join('admin')
      }

      // Handle disconnect
      socket.on('disconnect', (reason: string) => {
        console.log(`🔌 User disconnected: ${socket.user.email} (${reason})`)
        this.connectedUsers.delete(socket.userId)
      })

      // Send welcome message
      socket.emit('connected', {
        message: 'Real-time connection established',
        namespace: socket.userNamespace,
        user: socket.user,
        timestamp: new Date().toISOString()
      })
    })
  }

  // Send event to specific user
  sendToUser(userId: string, resource: string, action: string, payload: any): void {
    const connectedUser = this.connectedUsers.get(userId)
    if (connectedUser) {
      const eventName = `${connectedUser.userNamespace}:${resource}:${action}`

      this.io?.to(connectedUser.userNamespace).emit(eventName, {
        status: payload.status || 'success',
        error: payload.error || null,
        data: payload.data || null,
        timestamp: new Date().toISOString()
      })

      console.log(`📡 Sent event ${eventName} to user ${userId}`)
    }
  }

  // Send to all admins
  sendToAdmins(resource: string, action: string, payload: any): void {
    if (!this.io) return

    const eventName = `admin:${resource}:${action}`

    this.io.to('admin').emit(eventName, {
      status: payload.status || 'success',
      error: payload.error || null,
      data: payload.data || null,
      timestamp: new Date().toISOString()
    })
  }

  // Emit to specific room
  emitToRoom(room: string, eventName: string, payload: any): void {
    this.io?.to(room).emit(eventName, payload)
  }
}
```

### Using the Event System

#### In GraphQL Resolvers

```typescript
@Resolver()
export class MachineResolver {
  @Mutation(() => Machine)
  @Authorized('ADMIN')
  async createMachine(
    @Arg('input') input: CreateMachineInput,
    @Ctx() { prisma, user, eventManager }: InfinibayContext
  ): Promise<Machine> {
    // 1. Perform operation
    const machine = await this.machineService.createMachine(input)

    // 2. Trigger real-time event
    await eventManager?.vmCreated(machine, user?.id)

    return machine
  }
}
```

#### In Services

```typescript
export class MachineLifecycleService {
  constructor(
    private prisma: PrismaClient,
    private user: User | null,
    private eventManager?: EventManager
  ) {
    // Get global event manager if not provided
    this.eventManager = eventManager || getEventManager()
  }

  async updateMachineHardware(input: UpdateMachineHardwareInput): Promise<Machine> {
    // 1. Update machine
    const updatedMachine = await this.prisma.machine.update({
      where: { id: input.id },
      data: { cpu: input.cpu, ram: input.memory, storage: input.storage }
    })

    // 2. Broadcast update event
    await this.eventManager?.vmUpdated(updatedMachine, this.user?.id)

    return updatedMachine
  }
}
```

#### Special Event Types

**Health Check Events:**

```typescript
// In VMHealthQueueManager or health-related services
await vmEventManager.handleHealthStatusChange(
  vmId,
  'critical',  // 'healthy' | 'warning' | 'critical'
  checkResults,
  triggeredByUserId
)
```

**Auto-check Events:**

```typescript
// Issue detected
await eventManager.autocheckIssueDetected({
  id: vmId,
  checkType: 'disk_space',
  severity: 'critical',
  description: 'Disk usage above 90%',
  details: { currentUsage: 95, threshold: 90 }
}, userId)

// Remediation available
await eventManager.autocheckRemediationAvailable({
  id: vmId,
  checkType: 'disk_space',
  remediationType: 'cleanup_temp_files',
  description: 'Clean up temporary files',
  isAutomatic: true,
  estimatedTime: '30 seconds'
}, userId)

// Remediation completed
await eventManager.autocheckRemediationCompleted({
  id: vmId,
  checkType: 'disk_space',
  remediationType: 'cleanup_temp_files',
  success: true,
  description: 'Freed 5GB of disk space',
  executionTime: '28 seconds'
}, userId)
```

---

## Services Overview

### Service Architecture

Services in Infinibay follow a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────┐
│     GraphQL Resolvers               │  ← Presentation Layer
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│     Service Layer                   │  ← Business Logic Layer
│  ┌──────────────────────────────┐   │
│  │ MachineLifecycleService      │   │
│  │ NetworkService               │   │
│  │ FirewallService              │   │
│  │ VMHealthQueueManager         │   │
│  │ ... etc                      │   │
│  └──────────────────────────────┘   │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│  Infrastructure Services            │  ← Infrastructure Layer
│  ┌──────────────────────────────┐   │
│  │ LibvirtConnectionPool        │   │
│  │ EventManager                 │   │
│  │ SocketService                │   │
│  │ VirtioSocketWatcherService   │   │
│  └──────────────────────────────┘   │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│  External Systems                   │  ← External Layer
│  ┌──────────────────────────────┐   │
│  │ Prisma (Database)            │   │
│  │ libvirt-node (Hypervisor)    │   │
│  │ infiniservice (Guest VMs)    │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Core Infrastructure Services

#### LibvirtConnectionPool

**Location**: `app/services/LibvirtConnectionPool.ts`

**Purpose**: Manages connection pooling for libvirt hypervisor connections

**Extends**: `SingletonService`

**Configuration:**

```typescript
export interface PoolConfig {
  minConnections: number      // Minimum connections to maintain (default: 2)
  maxConnections: number      // Maximum concurrent connections (default: 10)
  acquireTimeout: number      // Timeout when waiting for connection (default: 30000ms)
  idleTimeout: number         // Time before closing idle connection (default: 60000ms)
  connectionUri?: string      // Libvirt URI (default: 'qemu:///system')
}
```

**Key Methods:**

```typescript
// Get singleton instance
static getPoolInstance(prisma: PrismaClient, config?: Partial<PoolConfig>): LibvirtConnectionPool

// Acquire connection from pool
async acquire(): Promise<Connection>

// Release connection back to pool
release(connection: Connection): void

// Get pool statistics
getStats(): PoolStats
```

**Usage Example:**

```typescript
const pool = LibvirtConnectionPool.getPoolInstance(prisma, {
  minConnections: 3,
  maxConnections: 15
})

await pool.initialize()

const connection = await pool.acquire()
try {
  // Perform libvirt operations
  const domain = VirtualMachine.lookupByName(connection, vmName)
  domain.create()
} finally {
  pool.release(connection)
}
```

#### EventManager

**Location**: `app/services/EventManager.ts`

**Purpose**: Central event coordination and routing

**When to Use:**
- Triggering real-time updates to connected clients
- Broadcasting resource changes (VM created, user updated, etc.)
- Coordinating cross-service communication

**Usage Pattern:**

```typescript
const eventManager = getEventManager()

// Generic event dispatch
await eventManager.dispatchEvent('vms', 'create', vmData, userId)

// Convenience methods
await eventManager.vmCreated(vmData, userId)
await eventManager.vmUpdated(vmData, userId)
await eventManager.vmDeleted(vmData, userId)
await eventManager.userCreated(userData, adminId)
await eventManager.departmentUpdated(deptData, adminId)
```

#### SocketService

**Location**: `app/services/SocketService.ts`

**Purpose**: WebSocket connection management and broadcasting

**When to Use:**
- **Don't use directly in most cases** - Use EventManager instead
- Only use directly for custom real-time features not covered by EventManager
- Use `emitToRoom()` for VM-specific rooms (e.g., metrics updates)

**Direct Usage Example (Rare):**

```typescript
const socketService = getSocketService()

// Send custom event to specific user
socketService.sendToUser(userId, 'notifications', 'custom', {
  status: 'success',
  data: { message: 'Custom notification' }
})

// Emit to VM-specific room (e.g., for metrics)
socketService.emitToRoom(`vm:${vmId}`, 'metricsUpdate', { vmId, metrics })
```

#### VirtioSocketWatcherService

**Location**: `app/services/VirtioSocketWatcherService.ts`

**Purpose**: Monitor VirtIO serial connections from guest VMs running infiniservice

**Features:**
- Automatic socket discovery via filesystem watcher
- Message parsing and validation
- Metrics storage
- Real-time metrics broadcasting
- Health check triggers

**Lifecycle:**

```typescript
// Initialization (in app/index.ts)
const virtioSocketWatcher = createVirtioSocketWatcherService(prisma)
virtioSocketWatcher.initialize(vmEventManager, healthQueueManager)

// Subscribe to metrics updates
virtioSocketWatcher.on('metricsUpdated', ({ vmId, metrics }) => {
  socketService.emitToRoom(`vm:${vmId}`, 'metricsUpdate', { vmId, metrics })
})

// Start watching
await virtioSocketWatcher.start()

// Stop watching (on shutdown)
await virtioSocketWatcher.stop()
```

**When to Use:**
- **Automatically initialized** - you don't need to manage it
- Access via GraphQL context if needed: `ctx.virtioSocketWatcher`
- Subscribe to events if implementing custom metrics handling

### VM Management Services

#### MachineLifecycleService

**Location**: `app/services/machineLifecycleService.ts`

**Purpose**: Complete VM lifecycle management (create, update, destroy)

**When to Use:**
- Creating new VMs
- Updating VM hardware (CPU, RAM, storage)
- Destroying VMs with cleanup
- Cloning VMs

**Usage Pattern:**

```typescript
const lifecycleService = new MachineLifecycleService(prisma, user)

// Create VM
const newMachine = await lifecycleService.createMachine({
  name: 'Dev Server',
  templateId: 'template-uuid',
  username: 'admin',
  password: 'secure-password',
  os: MachineOs.UBUNTU,
  departmentId: 'dept-uuid'
})

// Update hardware
const updatedMachine = await lifecycleService.updateMachineHardware({
  id: machineId,
  cpu: 4,
  memory: 8192,
  storage: 100
})

// Destroy VM
await lifecycleService.destroyMachine(machineId)
```

#### VMOperationsService

**Location**: `app/services/VMOperationsService.ts` (if exists, or operations are in resolvers)

**Purpose**: VM power state operations

**When to Use:**
- Starting/stopping VMs
- Pausing/resuming VMs
- Rebooting VMs

**Usage Pattern:**

```typescript
// Operations are typically in resolvers or lifecycle service
const connection = await pool.acquire()
try {
  const domain = VirtualMachine.lookupByName(connection, vmName)

  // Power operations
  domain.create()      // Start
  domain.shutdown()    // Graceful shutdown
  domain.destroy()     // Force power off
  domain.suspend()     // Pause
  domain.resume()      // Resume
  domain.reboot()      // Restart
} finally {
  pool.release(connection)
}
```

### Security Services

#### FirewallService

**Location**: `app/services/firewallService.ts`

**Purpose**: Low-level firewall rule management using libvirt nwfilter

**When to Use:**
- Creating custom firewall rules
- Advanced network filtering
- Direct nwfilter XML manipulation

**Key Features:**
- XML-based firewall rule generation
- Rule validation
- Filter application to VMs
- Filter flushing (apply to libvirt)

**Usage Pattern:**

```typescript
const firewallService = new FirewallService(prisma)

// Create filter
const filter = await firewallService.createFilter({
  name: 'custom-filter',
  description: 'Custom firewall rules',
  type: 'custom'
})

// Add rule
const rule = await firewallService.addRule(filter.id, {
  priority: 500,
  action: 'accept',
  direction: 'out',
  protocol: 'tcp',
  dstportstart: 443,
  dstportend: 443
})

// Apply filter to VM
await firewallService.applyFilterToVM(vmId, filter.id)

// Flush filters (apply to libvirt)
await firewallService.flushFilters()
```

#### FirewallSimplifierService

**Location**: `app/services/FirewallSimplifierService.ts`

**Purpose**: High-level, user-friendly firewall rule creation

**When to Use:**
- Creating simple allow/deny rules
- Service-based rules (allow HTTP, SSH, etc.)
- User-facing firewall management

**Key Features:**
- Simplified rule syntax
- Automatic rule validation
- Service-to-port mapping
- Automatic filter creation

**Usage Pattern:**

```typescript
const simplifierService = new FirewallSimplifierService(prisma)

// Create simplified rule
const rule = await simplifierService.createSimplifiedRule({
  vmId: 'vm-uuid',
  serviceId: 'service-uuid',  // e.g., 'http', 'ssh', 'mysql'
  action: 'allow',
  direction: 'inbound',
  sourceIp: '192.168.1.0/24',  // Optional
  description: 'Allow HTTP from local network'
})

// Or use generic filter
const genericRule = await simplifierService.createFromGenericFilter({
  vmId: 'vm-uuid',
  genericFilterId: 'generic-filter-uuid'
})
```

#### DepartmentFirewallService

**Location**: `app/services/departmentFirewallService.ts`

**Purpose**: Department-level firewall policy management

**When to Use:**
- Applying firewall policies to all VMs in a department
- Creating department-wide security templates
- Managing inter-department communication rules

**Usage Pattern:**

```typescript
const deptFirewallService = new DepartmentFirewallService(prisma)

// Create department filter template
const template = await deptFirewallService.createDepartmentTemplate({
  departmentId: 'dept-uuid',
  name: 'Engineering Department Policy',
  rules: [
    { action: 'deny', protocol: 'all', direction: 'in', priority: 1000 },
    { action: 'accept', protocol: 'tcp', dstportstart: 22, direction: 'in', priority: 500 },
    { action: 'accept', protocol: 'tcp', dstportstart: 443, direction: 'out', priority: 500 }
  ]
})

// Apply template to all VMs in department
await deptFirewallService.applyTemplateToDepartment('dept-uuid', template.id)
```

### Health Monitoring Services

#### VMHealthQueueManager

**Location**: `app/services/VMHealthQueueManager.ts`

**Purpose**: Queue and coordinate VM health checks

**When to Use:**
- Enqueuing health checks for VMs
- Processing health check results
- Managing health check priorities

**Key Features:**
- Priority-based queue
- Concurrent check limiting
- Retry mechanism
- Health status tracking

**Usage Pattern:**

```typescript
const healthQueueManager = new VMHealthQueueManager(prisma, eventManager)

// Enqueue health check
await healthQueueManager.enqueueHealthCheck(vmId, 'scheduled')

// Enqueue with priority
await healthQueueManager.enqueueHealthCheck(vmId, 'user_requested', { priority: 10 })

// Process queue (called by cron)
await healthQueueManager.processQueue()

// Get VM health status
const status = await healthQueueManager.getVMHealthStatus(vmId)
```

#### BackgroundHealthService

**Location**: `app/services/BackgroundHealthService.ts`

**Purpose**: Automated background health monitoring

**When to Use:**
- **Automatically started on server init** - you don't need to manage it
- Performs periodic health checks
- Triggers remediation actions

**Features:**
- Scheduled health scans
- Automatic issue detection
- Remediation recommendations
- Health history tracking

**Configuration:**

```typescript
// In app/index.ts - automatically initialized
const backgroundHealthService = new BackgroundHealthService(
  prisma,
  backgroundTaskService,
  eventManager,
  healthQueueManager
)
backgroundHealthService.start()
```

### Utility Services

#### ISOService

**Location**: `app/services/ISOService.ts`

**Purpose**: ISO file management (Windows, Linux distros)

**When to Use:**
- Registering uploaded ISOs
- Retrieving available ISOs
- Managing ISO metadata

**Usage Pattern:**

```typescript
const isoService = ISOService.getInstance()

// Register new ISO
const iso = await isoService.registerISO(
  'windows11.iso',
  'windows11',
  fileSize,
  '/opt/infinibay/iso/windows11.iso'
)

// Get ISO for OS type
const windowsISO = await isoService.getISOForOS('windows11')

// List all ISOs
const allISOs = await isoService.listISOs()
```

#### QemuGuestAgentService

**Location**: `app/services/QemuGuestAgentService.ts`

**Purpose**: QEMU Guest Agent communication (older alternative to infiniservice)

**When to Use:**
- Executing commands in guest VMs
- Querying guest OS information
- File operations in guest
- **Note**: Prefer VirtioSocketWatcher + infiniservice for metrics

**Usage Pattern:**

```typescript
const guestAgentService = new QemuGuestAgentService()

// Execute command in guest
const result = await guestAgentService.executeCommand(vmId, 'guest-info')

// Get guest OS info
const osInfo = await guestAgentService.getGuestInfo(vmId)

// Get guest network interfaces
const interfaces = await guestAgentService.getNetworkInterfaces(vmId)
```

#### SnapshotService

**Location**: `app/services/SnapshotService.ts`

**Purpose**: VM snapshot management

**When to Use:**
- Creating VM snapshots
- Restoring from snapshots
- Deleting snapshots
- Listing VM snapshots

**Usage Pattern:**

```typescript
const snapshotService = new SnapshotService(prisma)

// Create snapshot
const snapshot = await snapshotService.createSnapshot({
  vmId: 'vm-uuid',
  name: 'Before Update',
  description: 'Snapshot before system update'
})

// Restore snapshot
await snapshotService.restoreSnapshot(snapshotId)

// Delete snapshot
await snapshotService.deleteSnapshot(snapshotId)

// List VM snapshots
const snapshots = await snapshotService.listSnapshots(vmId)
```

#### MaintenanceService

**Location**: `app/services/MaintenanceService.ts`

**Purpose**: Scheduled maintenance operations

**When to Use:**
- Scheduling VM maintenance windows
- Coordinating maintenance tasks
- Tracking maintenance history

**Usage Pattern:**

```typescript
const maintenanceService = new MaintenanceService(prisma, eventManager)

// Schedule maintenance
const task = await maintenanceService.scheduleMaintenance({
  vmId: 'vm-uuid',
  type: 'update',
  scheduledFor: new Date('2024-01-15T02:00:00Z'),
  description: 'System updates and reboot',
  estimatedDuration: 30 // minutes
})

// Execute maintenance task
await maintenanceService.executeMaintenance(taskId)

// Cancel maintenance
await maintenanceService.cancelMaintenance(taskId)
```

#### DataLoaderService

**Location**: `app/services/DataLoaderService.ts`

**Purpose**: Efficient batch loading and caching for GraphQL resolvers (prevents N+1 queries)

**When to Use:**
- Loading related data in GraphQL field resolvers
- Batching database queries
- Caching frequently accessed data

**Usage Pattern:**

```typescript
// In GraphQL resolver
@FieldResolver(() => User)
async user(
  @Root() machine: Machine,
  @Ctx() ctx: InfinibayContext
): Promise<User | null> {
  // DataLoaders are typically created per-request in context
  return ctx.dataloaders.userLoader.load(machine.userId)
}
```

### Service Selection Guide

**When creating a new VM:**
→ Use `MachineLifecycleService.createMachine()`

**When updating VM hardware:**
→ Use `MachineLifecycleService.updateMachineHardware()`

**When managing firewall rules:**
- Simple rules → `FirewallSimplifierService`
- Advanced rules → `FirewallService`
- Department-wide → `DepartmentFirewallService`

**When monitoring VM health:**
→ Health checks are automatic via `BackgroundHealthService`
→ Enqueue priority checks via `VMHealthQueueManager`

**When working with VM metrics:**
→ Metrics are automatic via `VirtioSocketWatcherService`
→ Access in context: `ctx.virtioSocketWatcher`

**When triggering real-time events:**
→ Always use `EventManager`, never `SocketService` directly

**When managing ISOs:**
→ Use `ISOService.getInstance()`

**When working with libvirt:**
→ Always use `LibvirtConnectionPool`, never raw connections

---

## Callback System

### Overview

Infinibay uses Prisma middleware to implement lifecycle callbacks for database models. This allows executing logic before or after database operations.

**Location**: `app/utils/modelsCallbacks.ts`

### Architecture

```typescript
// Callback registration system
class ModelsCallbackManager {
  private callbacks = {
    before: {},  // Callbacks executed before DB operation
    after: {}    // Callbacks executed after DB operation
  }

  registerCallback(
    type: 'before' | 'after',
    action: string,      // 'create', 'update', 'delete', etc.
    model: string,       // 'Machine', 'Department', etc.
    callback: Function
  ): void

  async runsBeforeCallback(action: string, model: string, params: any): Promise<void>
  async runsAfterCallback(action: string, model: string, params: any, result: any): Promise<void>
}
```

### Installation

Callbacks are installed during application bootstrap:

```typescript
// In app/index.ts
import installCallbacks from './utils/modelsCallbacks'

async function bootstrap() {
  // ... other initialization

  // Install Prisma callbacks
  installCallbacks(prisma)

  // ... continue initialization
}
```

### Registered Callbacks

#### Machine Callbacks

**Location**: `app/utils/modelCallbacks/machine.ts`

**Before Create:**

```typescript
export async function beforeCreateMachine(
  prisma: PrismaClient,
  params: any
): Promise<void> {
  // 1. Generate internal name if not provided
  if (!params.args.data.internalName) {
    params.args.data.internalName = generateInternalName(params.args.data.name)
  }

  // 2. Validate template exists
  if (params.args.data.templateId) {
    const template = await prisma.machineTemplate.findUnique({
      where: { id: params.args.data.templateId }
    })
    if (!template) {
      throw new Error('Template not found')
    }
  }

  // 3. Set default values
  if (!params.args.data.status) {
    params.args.data.status = 'creating'
  }
}
```

**After Create:**

```typescript
export async function afterCreateMachine(
  prisma: PrismaClient,
  params: any,
  result: Machine
): Promise<void> {
  console.log(`Machine created: ${result.name} (${result.id})`)

  // 1. Create default firewall filter if in department
  if (result.departmentId) {
    const deptFirewall = await prisma.nWFilter.findFirst({
      where: {
        departmentId: result.departmentId,
        type: 'department'
      }
    })

    if (deptFirewall) {
      // Apply department firewall to new machine
      await applyFirewallToMachine(result.id, deptFirewall.id)
    }
  }

  // 2. Initialize health monitoring
  await prisma.vMHealthTask.create({
    data: {
      machineId: result.id,
      status: 'pending',
      taskType: 'initial_scan'
    }
  })

  // 3. Trigger real-time event (if EventManager is available)
  const eventManager = getEventManager()
  await eventManager.vmCreated(result, params.args.data.userId)
}
```

#### Department Callbacks

**Location**: `app/utils/modelCallbacks/department.ts`

**After Create:**

```typescript
export async function afterCreateDepartment(
  prisma: PrismaClient,
  params: any,
  result: Department
): Promise<void> {
  console.log(`Department created: ${result.name} (${result.id})`)

  // 1. Create default firewall filter for department
  const defaultFilter = await prisma.nWFilter.create({
    data: {
      name: `dept-${result.name}-default`,
      internalName: `infinibay-dept-${result.id}-default`,
      type: 'department',
      description: `Default firewall for ${result.name} department`,
      departmentId: result.id
    }
  })

  // 2. Add default rules (deny all, then allow specific)
  await prisma.fWRule.createMany({
    data: [
      {
        filterId: defaultFilter.id,
        priority: 1000,
        action: 'drop',
        direction: 'in',
        protocol: 'all'
      },
      {
        filterId: defaultFilter.id,
        priority: 500,
        action: 'accept',
        direction: 'out',
        protocol: 'all'
      }
    ]
  })

  // 3. Flush filter to apply to libvirt
  const firewallService = new FirewallService(prisma)
  await firewallService.flushFilter(defaultFilter.id)

  // 4. Trigger event
  const eventManager = getEventManager()
  await eventManager.departmentCreated(result)
}
```

#### NWFilter Callbacks

**Location**: `app/utils/modelCallbacks/nwfilter.ts`

**After Create:**

```typescript
export async function afterCreateNWfilter(
  prisma: PrismaClient,
  params: any,
  result: NWFilter
): Promise<void> {
  console.log(`Network filter created: ${result.name} (${result.id})`)

  // Automatically flush filter to libvirt
  const firewallService = new FirewallService(prisma)
  await firewallService.flushFilter(result.id)
}
```

### Prisma Middleware Integration

The callback system integrates with Prisma middleware:

```typescript
// In app/utils/modelsCallbacks.ts
export default async function installCallbacks(prisma: PrismaClient) {
  const mcbm = new ModelsCallbackManager(prisma)

  // Register callbacks
  mcbm.registerCallback('before', 'create', 'Machine', beforeCreateMachine)
  mcbm.registerCallback('after', 'create', 'Machine', afterCreateMachine)
  mcbm.registerCallback('after', 'create', 'Department', afterCreateDepartment)
  mcbm.registerCallback('after', 'create', 'NWFilter', afterCreateNWfilter)

  // Install Prisma middleware
  prisma.$use(async (params, next) => {
    // 1. Run before callbacks
    await mcbm.runsBeforeCallback(params.action, params.model, params)

    // 2. Execute database operation
    const result = await next(params)

    // 3. Run after callbacks
    await mcbm.runsAfterCallback(params.action, params.model, params, result)

    return result
  })
}
```

### Adding New Callbacks

**Step 1: Create callback file**

```typescript
// app/utils/modelCallbacks/myModel.ts
import { PrismaClient, MyModel } from '@prisma/client'

export async function beforeCreateMyModel(
  prisma: PrismaClient,
  params: any
): Promise<void> {
  // Validation, defaults, etc.
  console.log('Before creating MyModel:', params.args.data)
}

export async function afterCreateMyModel(
  prisma: PrismaClient,
  params: any,
  result: MyModel
): Promise<void> {
  // Post-creation logic, events, related records
  console.log('After creating MyModel:', result)
}
```

**Step 2: Register callback**

```typescript
// In app/utils/modelsCallbacks.ts
import { beforeCreateMyModel, afterCreateMyModel } from './modelCallbacks/myModel'

export default async function installCallbacks(prisma: PrismaClient) {
  const mcbm = new ModelsCallbackManager(prisma)

  // ... existing callbacks

  mcbm.registerCallback('before', 'create', 'MyModel', beforeCreateMyModel)
  mcbm.registerCallback('after', 'create', 'MyModel', afterCreateMyModel)

  // Install middleware
  prisma.$use(async (params, next) => {
    // ... same as before
  })
}
```

### Use Cases

**When to use callbacks:**

1. **Automatic defaults**: Setting computed values, generating IDs
2. **Validation**: Checking constraints before save
3. **Related records**: Creating associated records automatically
4. **Event triggering**: Broadcasting changes to real-time clients
5. **Side effects**: Applying configuration to external systems (libvirt, filesystem)

**When NOT to use callbacks:**

1. **Complex business logic**: Use services instead
2. **Async operations that might fail**: Handle in services with proper error handling
3. **Operations requiring user context**: Use services with user parameter
4. **Conditional logic based on request**: Use resolvers or services

---

## Additional Routes

Beyond the GraphQL endpoint, the backend provides several REST routes for specific use cases.

**Configuration**: `app/config/routes.ts`

### Health Check Endpoint

**Route**: `GET /health`

**Purpose**: Simple health check for monitoring and load balancers

**Response:**

```json
"OK"
```

**Usage:**

```bash
curl http://localhost:4000/health
# Response: OK (200)
```

### ISO Upload Endpoint

**Route**: `POST /isoUpload`

**Location**: `app/routes/isoUpload.ts`

**Purpose**: Upload large ISO files for OS installation

**Authentication**: Admin only (via `adminAuthMiddleware`)

**Middleware:**
- CORS enabled
- Multer for multipart upload
- 30-minute timeout
- 100GB file size limit

**Request:**

```typescript
POST /isoUpload
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>

{
  file: <binary data>,
  os: 'windows10' | 'windows11' | 'ubuntu' | 'fedora'
}
```

**Response:**

```json
{
  "message": "File uploaded successfully",
  "bytesReceived": 5368709120,
  "fileName": "windows11.iso",
  "os": "windows11",
  "isoId": "iso-uuid"
}
```

**Implementation Details:**

```typescript
// app/routes/isoUpload.ts
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const baseDir = process.env.INFINIBAY_BASE_DIR
    const tempDir = path.join(baseDir, 'temp')
    await ensureDirectoryExists(tempDir)
    cb(null, tempDir)
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 * 100 } // 100GB
})

router.post('/',
  cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }),
  (req, res, next) => {
    req.setTimeout(30 * 60 * 1000)  // 30 minutes
    res.setTimeout(30 * 60 * 1000)
    next()
  },
  adminAuthMiddleware,
  upload.single('file'),
  async (req, res) => {
    // 1. Validate metadata
    const metadata = await validateMetadata(
      req.file.originalname,
      req.body.os,
      req.file.size
    )

    // 2. Move to target location
    const isoDir = path.join(process.env.INFINIBAY_BASE_DIR, 'iso')
    const targetPath = path.join(isoDir, `${metadata.os}.iso`)
    await fs.rename(req.file.path, targetPath)

    // 3. Register in database
    const isoService = ISOService.getInstance()
    const iso = await isoService.registerISO(
      `${metadata.os}.iso`,
      metadata.os,
      req.file.size,
      targetPath
    )

    res.status(200).json({
      message: 'File uploaded successfully',
      bytesReceived: req.file.size,
      fileName: metadata.fileName,
      os: metadata.os,
      isoId: iso.id
    })
  }
)
```

**Valid OS Types:**

- `windows10`
- `windows11`
- `ubuntu`
- `fedora`

### InfiniService Distribution Endpoint

**Route**: `GET /infiniservice/*`

**Location**: `app/routes/infiniservice.ts`

**Purpose**: Serve infiniservice binaries and installation scripts to VMs

**Available Files:**

```
GET /infiniservice/windows/infiniservice.exe
GET /infiniservice/windows/install.ps1
GET /infiniservice/linux/infiniservice
GET /infiniservice/linux/install.sh
```

**Implementation:**

```typescript
// app/routes/infiniservice.ts
const router = express.Router()

// Serve static files from infiniservice build directory
const infiniserviceDir = path.join(
  process.env.INFINIBAY_BASE_DIR || '/opt/infinibay',
  'infiniservice'
)

router.use(express.static(infiniserviceDir))

// Add CORS for cross-origin access from VMs
router.use(cors({
  origin: '*',  // Allow all origins (VMs may have various IPs)
  methods: ['GET']
}))

export default router
```

**Usage from VM:**

```bash
# Linux VM
curl http://<host>:4000/infiniservice/linux/install.sh | sudo bash

# Windows VM (PowerShell)
Invoke-WebRequest -Uri "http://<host>:4000/infiniservice/windows/install.ps1" -OutFile "install.ps1"
.\install.ps1
```

### Wallpapers API

**Route**: `GET /api/wallpapers`

**Location**: `app/routes/wallpapers.ts`

**Purpose**: List available wallpaper images for UI customization

**Response:**

```json
{
  "wallpapers": [
    {
      "id": "wallpaper-1",
      "name": "default.jpg",
      "url": "/public/wallpapers/default.jpg"
    },
    {
      "id": "wallpaper-2",
      "name": "dark-abstract.jpg",
      "url": "/public/wallpapers/dark-abstract.jpg"
    }
  ]
}
```

**Implementation:**

```typescript
// app/routes/wallpapers.ts
router.get('/', async (req, res) => {
  const wallpapersDir = path.join(process.env.PUBLIC_DIR || 'public', 'wallpapers')

  try {
    const files = await fs.readdir(wallpapersDir)

    const wallpapers = files
      .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .map((file, index) => ({
        id: `wallpaper-${index + 1}`,
        name: file,
        url: `/public/wallpapers/${file}`
      }))

    res.json({ wallpapers })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list wallpapers' })
  }
})
```

### Avatars API

**Route**: `GET /api/avatars`

**Location**: `app/routes/avatars.ts`

**Purpose**: List available avatar images for user profiles

**Response:**

```json
{
  "avatars": [
    {
      "id": "avatar-1",
      "name": "default.svg",
      "url": "/public/images/avatars/default.svg"
    },
    {
      "id": "avatar-2",
      "name": "user-1.svg",
      "url": "/public/images/avatars/user-1.svg"
    }
  ]
}
```

**Implementation:**

```typescript
// app/routes/avatars.ts
router.get('/', async (req, res) => {
  const avatarsDir = path.join('public', 'images', 'avatars')

  try {
    const files = await fs.readdir(avatarsDir)

    const avatars = files
      .filter(file => /\.(svg|png|jpg)$/i.test(file))
      .map((file, index) => ({
        id: `avatar-${index + 1}`,
        name: file,
        url: `/public/images/avatars/${file}`
      }))

    res.json({ avatars })
  } catch (error) {
    res.status(500).json({ error: 'Failed to list avatars' })
  }
})
```

---

## Design Patterns

### 1. Singleton Pattern

**Purpose**: Ensure only one instance of a service exists throughout the application lifecycle

**Base Class**: `app/services/base/SingletonService.ts`

```typescript
export abstract class SingletonService extends BaseService {
  private static instances = new Map<string, SingletonService>()

  protected constructor(config: ServiceConfig) {
    super(config)
  }

  static getInstance<T extends SingletonService>(
    this: new (config: ServiceConfig) => T,
    config: ServiceConfig
  ): T {
    const key = config.name

    if (!SingletonService.instances.has(key)) {
      SingletonService.instances.set(key, new this(config))
    }

    return SingletonService.instances.get(key) as T
  }

  static async destroyInstance(name: string): Promise<void> {
    const instance = SingletonService.instances.get(name)
    if (instance) {
      await instance.shutdown()
      SingletonService.instances.delete(name)
    }
  }
}
```

**Usage:**

```typescript
// Service implementation
export class LibvirtConnectionPool extends SingletonService {
  constructor(config: ServiceConfig) {
    super(config)
  }

  static getPoolInstance(prisma: PrismaClient, config?: Partial<PoolConfig>): LibvirtConnectionPool {
    const serviceConfig: ServiceConfig = {
      name: 'libvirt-connection-pool',
      dependencies: { prisma },
      options: config
    }
    return LibvirtConnectionPool.getInstance(serviceConfig)
  }
}

// Consumer code
const pool = LibvirtConnectionPool.getPoolInstance(prisma)
// Always returns the same instance
```

**When to use:**
- Connection pools
- Configuration services
- Cache services
- Event managers

### 2. Repository Pattern (via Prisma)

**Purpose**: Abstraction layer between data access and business logic

**Implementation**: Prisma Client acts as repository

```typescript
// Prisma Client is the repository
export class MachineService {
  constructor(private prisma: PrismaClient) {}

  async findMachine(id: string): Promise<Machine | null> {
    return this.prisma.machine.findUnique({
      where: { id },
      include: { user: true, template: true }
    })
  }

  async createMachine(data: CreateMachineData): Promise<Machine> {
    return this.prisma.machine.create({
      data
    })
  }
}
```

**When to use:**
- All database access
- Data queries
- CRUD operations

### 3. Event-Driven Architecture

**Purpose**: Decouple components through asynchronous event communication

**Implementation**: EventManager + ResourceEventManagers

```typescript
// Publisher (Service)
export class MachineLifecycleService {
  async createMachine(input: CreateMachineInput): Promise<Machine> {
    const machine = await this.prisma.machine.create({ data: input })

    // Publish event
    await this.eventManager.vmCreated(machine, this.user?.id)

    return machine
  }
}

// Subscriber (VmEventManager)
export class VmEventManager implements ResourceEventManager {
  async handleEvent(action: EventAction, data: EventData, triggeredBy?: string): Promise<void> {
    // React to event
    const targetUsers = await this.getTargetUsers(data)
    for (const userId of targetUsers) {
      this.socketService.sendToUser(userId, 'vms', action, { status: 'success', data })
    }
  }
}
```

**When to use:**
- Real-time updates
- Cross-service communication
- Audit logging
- Notification systems

### 4. Dependency Injection

**Purpose**: Pass dependencies to classes rather than hardcoding them

**Implementation**: Constructor injection

```typescript
export class MachineLifecycleService {
  constructor(
    private prisma: PrismaClient,        // Injected
    private user: User | null,           // Injected
    private eventManager?: EventManager, // Optional injection
    private virtManager?: VirtManager    // Optional injection
  ) {
    // Default dependencies if not provided
    this.eventManager = eventManager || getEventManager()
    this.virtManager = virtManager || new VirtManager()
  }
}

// Usage
const service = new MachineLifecycleService(
  prisma,
  currentUser,
  customEventManager,
  customVirtManager
)
```

**When to use:**
- All services
- Testable code
- Swappable implementations

### 5. Factory Pattern

**Purpose**: Centralize object creation logic

**Implementation**: Service factories

```typescript
// Factory function
export const createSocketService = (prisma: PrismaClient): SocketService => {
  if (!socketService) {
    socketService = new SocketService(prisma)
  }
  return socketService
}

// Factory method
export class ISOService {
  private static instance: ISOService | null = null

  static getInstance(): ISOService {
    if (!this.instance) {
      this.instance = new ISOService()
    }
    return this.instance
  }
}
```

**When to use:**
- Complex object initialization
- Singleton creation
- Configuration-based creation

### 6. Strategy Pattern

**Purpose**: Define family of algorithms, encapsulate each one, make them interchangeable

**Implementation**: CPU pinning strategies

```typescript
// Strategy interface
export abstract class BasePinningStrategy {
  abstract assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[]
}

// Concrete strategies
export class BasicStrategy extends BasePinningStrategy {
  assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[] {
    return hostCPUs.slice(0, numCPUs)
  }
}

export class HybridRandomStrategy extends BasePinningStrategy {
  assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[] {
    // Complex hybrid allocation logic
    return selectedCPUs
  }
}

// Context
export class CPUPinningService {
  constructor(private strategy: BasePinningStrategy) {}

  pinVM(vmId: string, numCPUs: number): number[] {
    const hostCPUs = this.getAvailableCPUs()
    return this.strategy.assignCPUs(vmId, numCPUs, hostCPUs)
  }
}
```

**When to use:**
- Multiple algorithms for same task
- Configurable behavior
- Extensible systems

### 7. Observer Pattern (EventEmitter)

**Purpose**: One-to-many dependency where observers are notified of state changes

**Implementation**: VirtioSocketWatcherService

```typescript
export class VirtioSocketWatcherService extends EventEmitter {
  private async processMetrics(vmId: string, metrics: MetricsData): Promise<void> {
    // Store in database
    await this.storeMetrics(vmId, metrics)

    // Emit event for observers
    this.emit('metricsUpdated', { vmId, metrics })
  }
}

// Observer
virtioSocketWatcher.on('metricsUpdated', ({ vmId, metrics }) => {
  // React to metrics update
  socketService.emitToRoom(`vm:${vmId}`, 'metricsUpdate', { vmId, metrics })
})
```

**When to use:**
- Asynchronous notifications
- Multiple subscribers to same event
- Loose coupling between components

### 8. Middleware Pattern

**Purpose**: Chain processing logic in a pipeline

**Implementation**: Prisma middleware, Express middleware

```typescript
// Prisma middleware
prisma.$use(async (params, next) => {
  // 1. Pre-processing
  await runBeforeCallbacks(params)

  // 2. Execute operation
  const result = await next(params)

  // 3. Post-processing
  await runAfterCallbacks(params, result)

  return result
})

// Express middleware
app.use(cors({ origin: allowedOrigins }))
app.use(express.json())
app.use(adminAuthMiddleware)
app.use('/graphql', graphqlMiddleware)
```

**When to use:**
- Request processing pipeline
- Cross-cutting concerns (auth, logging)
- Data transformation

---

## Directory Schema

### Application Structure

```
backend/
├── app/
│   ├── config/              # Server and Apollo configuration
│   │   ├── apollo.ts        # Apollo Server setup (TypeGraphQL)
│   │   ├── server.ts        # Express server configuration
│   │   ├── routes.ts        # REST routes registration
│   │   └── knownServices.ts # Predefined network services
│   │
│   ├── constants/           # Application constants
│   │   └── machine-status.ts
│   │
│   ├── crons/               # Scheduled background jobs
│   │   ├── all.ts           # Cron orchestrator
│   │   ├── UpdateVmStatus.ts
│   │   ├── CheckRunningServices.ts
│   │   ├── UpdateGraphicsInformation.ts
│   │   ├── ProcessHealthQueue.ts
│   │   ├── ScheduleOverallScans.ts
│   │   ├── MetricsWatchdog.ts
│   │   ├── CleanupOrphanedHealthTasks.ts
│   │   ├── ProcessMaintenanceQueue.ts
│   │   └── flushFirewall.ts
│   │
│   ├── graphql/             # GraphQL schema and resolvers
│   │   ├── resolvers/
│   │   │   ├── index.ts     # Resolver registration
│   │   │   ├── machine/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── user/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── department/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── application/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── machine_template/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── machine_template_category/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── firewall/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── types.ts
│   │   │   ├── networks/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── types.ts
│   │   │   ├── metrics/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── health/
│   │   │   │   └── BackgroundHealthResolver.ts
│   │   │   ├── security/
│   │   │   │   ├── resolver.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── inputs.ts
│   │   │   ├── setup/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── system/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── vmDiagnostics/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── type.ts
│   │   │   ├── vmManagement/
│   │   │   │   ├── resolver.ts
│   │   │   │   └── types.ts
│   │   │   ├── AdvancedFirewallResolver.ts
│   │   │   ├── AppSettingsResolver.ts
│   │   │   ├── AutoCheckResolver.ts
│   │   │   ├── DataVersionResolver.ts
│   │   │   ├── DepartmentFirewallResolver.ts
│   │   │   ├── GenericFilterResolver.ts
│   │   │   ├── ISOResolver.ts
│   │   │   ├── MaintenanceResolver.ts
│   │   │   ├── PackageResolver.ts
│   │   │   ├── ProcessResolver.ts
│   │   │   ├── ServiceResolver.ts
│   │   │   ├── SimplifiedFirewallResolver.ts
│   │   │   ├── SnapshotResolver.ts
│   │   │   ├── VMHealthHistoryResolver.ts
│   │   │   └── VMRecommendationResolver.ts
│   │   │
│   │   ├── types/           # Shared GraphQL types
│   │   │   ├── AppSettingsType.ts
│   │   │   ├── GenericFilterTypes.ts
│   │   │   ├── HealthCheckTypes.ts
│   │   │   ├── ISOType.ts
│   │   │   ├── MaintenanceTypes.ts
│   │   │   ├── PackageType.ts
│   │   │   ├── ProcessType.ts
│   │   │   ├── RecommendationTypes.ts
│   │   │   ├── ServiceType.ts
│   │   │   ├── SimplifiedFirewallType.ts
│   │   │   └── SnapshotType.ts
│   │   │
│   │   └── utils/           # GraphQL utilities
│   │       └── auth.ts      # Authorization utilities
│   │
│   ├── logger.ts            # Winston logger configuration
│   │
│   ├── middleware/          # Express middleware
│   │   └── adminAuth.ts     # Admin authentication middleware
│   │
│   ├── routes/              # REST endpoints
│   │   ├── avatars.ts       # Avatar list API
│   │   ├── infiniservice.ts # Guest agent binary distribution
│   │   ├── isoUpload.ts     # ISO file upload
│   │   └── wallpapers.ts    # Wallpaper list API
│   │
│   ├── services/            # Business logic services
│   │   ├── base/            # Base service classes
│   │   │   ├── BaseService.ts
│   │   │   └── SingletonService.ts
│   │   │
│   │   ├── cleanup/         # Cleanup utilities
│   │   │
│   │   ├── EventManagers/   # Specialized event managers
│   │   │   └── ISOEventManager.ts
│   │   │
│   │   ├── recommendations/ # Health recommendations
│   │   │
│   │   ├── vm/              # VM-specific services
│   │   │   └── hardwareUpdateService.ts
│   │   │
│   │   ├── ApplicationEventManager.ts
│   │   ├── AppSettingsService.ts
│   │   ├── BackgroundHealthService.ts
│   │   ├── BackgroundTaskService.ts
│   │   ├── DataLoaderService.ts
│   │   ├── DepartmentEventManager.ts
│   │   ├── departmentFirewallService.ts
│   │   ├── DirectPackageManager.ts
│   │   ├── EventManager.ts
│   │   ├── firewallService.ts
│   │   ├── FirewallSimplifierService.ts
│   │   ├── ISOService.ts
│   │   ├── LibvirtConnectionPool.ts
│   │   ├── machineLifecycleService.ts
│   │   ├── MaintenanceService.ts
│   │   ├── networkFilterService.ts
│   │   ├── networkService.ts
│   │   ├── PortValidationService.ts
│   │   ├── ProcessManager.ts
│   │   ├── QemuGuestAgentService.ts
│   │   ├── ServiceManager.ts
│   │   ├── SnapshotService.ts
│   │   ├── SocketService.ts
│   │   ├── UserEventManager.ts
│   │   ├── VirtioSocketWatcherService.ts
│   │   ├── VMDetailEventManager.ts
│   │   ├── VmEventManager.ts
│   │   ├── VMHealthQueueManager.ts
│   │   └── VMOperationsService.ts
│   │
│   ├── templates/           # EJS templates (for unattended installs)
│   │
│   ├── utils/               # Utility functions
│   │   ├── errors/          # Error handling
│   │   │   └── ErrorHandler.ts
│   │   │
│   │   ├── modelCallbacks/  # Prisma lifecycle callbacks
│   │   │   ├── machine.ts
│   │   │   ├── department.ts
│   │   │   └── nwfilter.ts
│   │   │
│   │   ├── SetupService/    # Initial setup utilities
│   │   │   └── index.ts
│   │   │
│   │   ├── VirtManager/     # Virtualization management
│   │   │   ├── CpuPinning/
│   │   │   │   ├── BasePinningStrategy.ts
│   │   │   │   ├── BasicStrategy.ts
│   │   │   │   └── HybridRandom.ts
│   │   │   ├── types/
│   │   │   │   └── network.ts
│   │   │   ├── createMachineService.ts
│   │   │   ├── graphicPortService.ts
│   │   │   ├── index.ts
│   │   │   ├── networkFirewallRules.ts
│   │   │   ├── xmlGenerator.ts
│   │   │   └── xmlNetworkGenerator.ts
│   │   │
│   │   ├── authChecker.ts   # GraphQL authorization
│   │   ├── avatarValidation.ts
│   │   ├── checkGpuAffinity.ts
│   │   ├── context.ts       # GraphQL context definition
│   │   ├── cronParser.ts
│   │   ├── database.ts      # Prisma client
│   │   ├── dateHelpers.ts
│   │   ├── debug.ts         # Debug logging utility
│   │   ├── errors.ts        # Error definitions
│   │   ├── jwtAuth.ts       # JWT utilities
│   │   ├── libvirt.ts       # Libvirt utilities
│   │   ├── modelsCallbacks.ts # Callback registration
│   │   ├── pagination.ts
│   │   └── password.ts      # Password hashing
│   │
│   └── index.ts             # Application entry point
│
├── doc/                     # Documentation
│   ├── development/
│   │   └── README.md
│   ├── features/
│   │   └── README.md
│   ├── realtime/
│   │   └── README.md
│   ├── services/
│   │   └── README.md
│   └── README.md
│
├── prisma/                  # Database schema and migrations
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
│
├── public/                  # Static assets
│   ├── images/
│   │   └── avatars/
│   └── wallpapers/
│
├── scripts/                 # Utility scripts
│   ├── cleanup/
│   │   └── orphanedNwfilters.ts
│   ├── cleanup-temp-isos.ts
│   ├── download-windows-v2.ts
│   ├── install.ts
│   └── migrate-isos.ts
│
├── .env                     # Environment variables
├── .env.example             # Environment template
├── package.json
├── tsconfig.json            # TypeScript configuration
└── jest.config.js           # Jest test configuration
```

### Key Directory Purposes

**`app/config/`**: Server initialization and configuration
- Apollo GraphQL setup
- Express server configuration
- Route registration
- Service definitions

**`app/crons/`**: Background scheduled tasks
- VM status monitoring
- Health checks
- Maintenance queue processing
- Firewall synchronization

**`app/graphql/resolvers/`**: GraphQL API implementation
- Query and Mutation resolvers
- TypeGraphQL types
- Authorization rules
- Business logic orchestration

**`app/services/`**: Core business logic
- VM lifecycle management
- Network and security services
- Event management
- Health monitoring
- Real-time communication

**`app/utils/`**: Helper functions and utilities
- Authentication
- Database access
- Error handling
- Debug logging
- Virtualization utilities

**`prisma/`**: Database management
- Schema definition
- Migrations
- Seed data

---

## Utilities

### Debug System

**Location**: `app/utils/debug.ts`

**Purpose**: Categorized debug logging using the `debug` package

```typescript
export class Debugger {
  private debuggers: { [key: string]: debug.Debugger } = {}

  constructor(private module: string) {
    this.debuggers.default = debug('infinibay:' + module)
  }

  public log(...args: string[]) {
    if (args.length === 1) {
      this.debuggers.default(args[0])
    } else if (args.length === 2) {
      const [subDebug, message] = args
      if (!this.debuggers[subDebug]) {
        this.debuggers[subDebug] = debug(`${this.module}:${subDebug}`)
      }
      this.debuggers[subDebug](message)
    }
  }
}
```

**Usage:**

```typescript
// In a service
import { Debugger } from '@utils/debug'

export class MyService {
  private debug = new Debugger('my-service')

  async performOperation(): Promise<void> {
    this.debug.log('Starting operation')
    this.debug.log('info', 'Processing data')
    this.debug.log('error', 'Operation failed')
  }
}
```

**Enable Debug Output:**

```bash
# Enable all debug output
DEBUG=infinibay:* npm run dev

# Enable specific module
DEBUG=infinibay:my-service npm run dev

# Enable specific level
DEBUG=infinibay:my-service:error npm run dev

# Multiple modules
DEBUG=infinibay:my-service,infinibay:other-service npm run dev
```

### Error Handling

**Location**: `app/utils/errors/ErrorHandler.ts`

**Purpose**: Centralized error handling and logging

```typescript
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message)
  }
}

export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  LIBVIRT_ERROR = 'LIBVIRT_ERROR'
}

export class ErrorHandler {
  static initialize(prisma: PrismaClient, eventManager: EventManager): void {
    // Initialize error tracking
  }

  async handleError(error: Error, context: Record<string, any>): Promise<void> {
    // Log error
    console.error('Error occurred:', error, context)

    // Store in database for analysis
    await this.prisma.errorLog.create({
      data: {
        message: error.message,
        stack: error.stack,
        context: JSON.stringify(context),
        timestamp: new Date()
      }
    })

    // Notify admins via real-time event
    this.eventManager.sendToAdmins('system', 'error', {
      status: 'error',
      error: error.message,
      context
    })
  }
}
```

**Usage:**

```typescript
// Throwing typed errors
throw new AppError(
  ErrorCode.NOT_FOUND,
  'VM not found',
  404,
  { vmId: 'vm-123' }
)

// Handling errors in services
try {
  await this.performOperation()
} catch (error) {
  await this.errorHandler.handleError(error as Error, {
    service: 'MachineService',
    operation: 'createMachine',
    userId: user?.id
  })
  throw error
}
```

### Authentication Utilities

**Location**: `app/utils/jwtAuth.ts`

**Purpose**: JWT token verification and user authentication

```typescript
export interface AuthResult {
  user: SafeUser | null
  meta: AuthenticationMetadata
}

export async function verifyRequestAuth(
  req: Request,
  options: {
    method: 'context' | 'fallback'
    debugAuth?: boolean
  }
): Promise<AuthResult> {
  try {
    // 1. Extract token from header
    const token = extractToken(req)

    if (!token) {
      return {
        user: null,
        meta: createAuthenticationMetadata('context', 'unauthenticated')
      }
    }

    // 2. Verify JWT
    const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as any

    // 3. Fetch user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        deleted: true
        // NEVER include: password, token
      }
    })

    if (!user) {
      return {
        user: null,
        meta: createAuthenticationMetadata('context', 'user_not_found')
      }
    }

    if (user.deleted) {
      return {
        user: null,
        meta: createAuthenticationMetadata('context', 'user_deleted')
      }
    }

    // 4. Return authenticated user
    return {
      user: user as SafeUser,
      meta: createAuthenticationMetadata('context', 'authenticated', {
        tokenExpiration: new Date(decoded.exp * 1000)
      })
    }
  } catch (error) {
    return {
      user: null,
      meta: createAuthenticationMetadata('context', 'token_invalid', {
        warnings: [error instanceof Error ? error.message : 'Unknown error']
      })
    }
  }
}

function extractToken(req: Request): string | null {
  // Try Authorization header
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }

  // Try cookies
  if (req.cookies?.token) {
    return req.cookies.token
  }

  return null
}
```

### Database Utilities

**Location**: `app/utils/database.ts`

**Purpose**: Prisma client initialization

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error']
})

export default prisma
```

### VirtManager Utilities

**Location**: `app/utils/VirtManager/`

**Purpose**: Virtualization management helpers

**Key Components:**

#### XML Generator

**Location**: `app/utils/VirtManager/xmlGenerator.ts`

**Purpose**: Generate libvirt domain XML

```typescript
export class XMLGenerator {
  generateDomainXML(config: DomainConfig): string {
    // Generate complete domain XML
    return `
      <domain type='kvm'>
        <name>${config.name}</name>
        <memory unit='KiB'>${config.memory}</memory>
        <vcpu placement='static'>${config.cpu}</vcpu>
        <!-- ... full XML structure ... -->
      </domain>
    `
  }
}
```

#### CPU Pinning

**Location**: `app/utils/VirtManager/CpuPinning/`

**Purpose**: Assign VM vCPUs to host pCPUs

```typescript
// Base strategy
export abstract class BasePinningStrategy {
  abstract assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[]
}

// Basic strategy - sequential assignment
export class BasicStrategy extends BasePinningStrategy {
  assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[] {
    return hostCPUs.slice(0, numCPUs)
  }
}

// Hybrid random strategy - balanced assignment
export class HybridRandomStrategy extends BasePinningStrategy {
  assignCPUs(vmId: string, numCPUs: number, hostCPUs: number[]): number[] {
    // Implement complex allocation logic
    // - Avoid oversubscription
    // - Balance across NUMA nodes
    // - Reserve cores for system
    return selectedCPUs
  }
}
```

#### Graphics Port Service

**Location**: `app/utils/VirtManager/graphicPortService.ts`

**Purpose**: Manage VNC/SPICE ports for VM display

```typescript
export class GraphicPortService {
  async allocatePort(vmId: string): Promise<number> {
    // Find available port
    const usedPorts = await prisma.machine.findMany({
      select: { graphicPort: true }
    })

    const availablePort = this.findAvailablePort(usedPorts)

    // Reserve port
    await prisma.machine.update({
      where: { id: vmId },
      data: { graphicPort: availablePort }
    })

    return availablePort
  }

  private findAvailablePort(usedPorts: number[]): number {
    const MIN_PORT = 5900
    const MAX_PORT = 6900

    for (let port = MIN_PORT; port < MAX_PORT; port++) {
      if (!usedPorts.includes(port)) {
        return port
      }
    }

    throw new Error('No available graphics ports')
  }
}
```

### Password Utilities

**Location**: `app/utils/password.ts`

**Purpose**: Password hashing and verification

```typescript
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 10

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
```

### Date Helpers

**Location**: `app/utils/dateHelpers.ts`

**Purpose**: Date manipulation and formatting

```typescript
export function formatTimestamp(date: Date): string {
  return date.toISOString()
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function getDaysDifference(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}
```

### Pagination Utilities

**Location**: `app/utils/pagination.ts`

**Purpose**: Paginate database queries

```typescript
export interface PaginationArgs {
  page?: number
  pageSize?: number
}

export interface PaginationInfo {
  currentPage: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export function calculatePagination(
  args: PaginationArgs,
  totalCount: number
): { skip: number; take: number; info: PaginationInfo } {
  const page = args.page || 1
  const pageSize = args.pageSize || 20

  const skip = (page - 1) * pageSize
  const take = pageSize

  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    skip,
    take,
    info: {
      currentPage: page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  }
}
```

---

## Best Practices

### 1. Service Development

**DO:**
- Use dependency injection
- Return typed results
- Handle errors gracefully
- Emit events for state changes
- Use Prisma transactions for multi-step operations
- Validate inputs
- Log important operations

**DON'T:**
- Create global state
- Use `console.log` (use Debugger instead)
- Hardcode configuration
- Ignore errors
- Perform heavy operations in constructors
- Mix business logic with data access

### 2. GraphQL Resolvers

**DO:**
- Use `@Authorized` decorators for protected endpoints
- Validate input with InputTypes
- Use context for user and dependencies
- Return typed results
- Trigger events after mutations
- Use DataLoaders for N+1 prevention

**DON'T:**
- Put business logic in resolvers
- Access database directly (use services)
- Ignore authorization
- Return sensitive data (password, token)
- Perform heavy operations

### 3. Real-time Events

**DO:**
- Use EventManager for all events
- Include triggeredBy user ID
- Determine target users properly
- Send complete data in events
- Handle event failures gracefully

**DON'T:**
- Use SocketService directly
- Broadcast to all users unnecessarily
- Send sensitive data
- Assume all users are connected
- Block on event sending

### 4. Error Handling

**DO:**
- Use typed errors (AppError)
- Log errors with context
- Return user-friendly messages
- Clean up resources on error
- Use try-finally for cleanup

**DON'T:**
- Swallow errors silently
- Expose internal errors to users
- Let resources leak
- Use generic error messages
- Catch without logging

### 5. Database Operations

**DO:**
- Use transactions for multi-step operations
- Use select/include to limit data
- Paginate large result sets
- Index frequently queried fields
- Use DataLoaders in GraphQL

**DON'T:**
- Fetch all records without limit
- Perform N+1 queries
- Update without WHERE clause
- Store sensitive data unencrypted
- Ignore database errors

### 6. Testing

**DO:**
- Write unit tests for services
- Mock external dependencies
- Test error conditions
- Use test database
- Clean up test data

**DON'T:**
- Test against production database
- Depend on test execution order
- Leave test data behind
- Skip error case testing
- Mock everything

### 7. Security

**DO:**
- Validate all inputs
- Use JWT for authentication
- Check authorization in resolvers
- Sanitize user input
- Use HTTPS in production
- Hash passwords with bcrypt

**DON'T:**
- Trust client input
- Store passwords in plain text
- Expose internal errors
- Skip authorization checks
- Log sensitive data
- Use weak secrets

---

## Conclusion

This guide provides a comprehensive overview of the Infinibay backend architecture, services, patterns, and best practices. Key takeaways:

1. **Application initializes in strict order** to ensure dependencies are ready
2. **Services are organized by domain** (VM management, security, health, etc.)
3. **Real-time events flow through EventManager** to decouple components
4. **GraphQL resolvers orchestrate services** and never contain business logic
5. **Callbacks handle model lifecycle hooks** for automatic behaviors
6. **Design patterns ensure maintainability** and testability

When adding new features:
- Create services for business logic
- Use EventManager for real-time updates
- Register callbacks for automatic behaviors
- Follow established patterns
- Write tests
- Update documentation

For questions or clarifications, refer to:
- Existing service implementations
- GraphQL resolver examples
- Test files
- Documentation in `doc/` directory
