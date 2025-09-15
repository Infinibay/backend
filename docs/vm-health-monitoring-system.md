# VM Health Monitoring System

## Overview

The VM Health Monitoring System provides automated background health checks for virtual machines, queue management for offline VMs, and persistent storage of health data with GraphQL API access.

## Configuration

### Per-VM Health Check Intervals

The system supports per-VM configurable health check intervals through the `VMHealthConfig` model. Per-VM `VMHealthConfig.checkIntervalMinutes` overrides both the `OVERALL_SCAN_INTERVAL_MINUTES` environment variable and the default value.

#### Configuration Precedence

For overall scan intervals, the system uses the following precedence:

1. **Per-VM Configuration**: `VMHealthConfig.checkIntervalMinutes` (highest priority)
2. **Environment Variable**: `OVERALL_SCAN_INTERVAL_MINUTES` if set and valid
3. **Default Value**: 60 minutes (fallback)

#### Environment Variables

```bash
# Optional: Set global default scan interval (minutes)
OVERALL_SCAN_INTERVAL_MINUTES=60
```

## Architecture

### Components

1. **BackgroundHealthService** - Schedules daily health check rounds using cron
2. **VMHealthQueueManager** - Manages health check queues with priority and retry logic
3. **VMHealthHistoryResolver** - GraphQL API for accessing health data
4. **VirtioSocketWatcherService Integration** - Processes queues when VMs come online

### Database Schema

#### VMHealthSnapshot Table
Stores daily health check snapshots for each VM:
```sql
- id: String (Primary Key)
- machineId: String (Foreign Key)
- snapshotDate: DateTime
- overallStatus: String
- checksCompleted: Int
- checksFailed: Int
- executionTimeMs: Int?
- errorSummary: String?
- osType: String?
- diskSpaceInfo: Json?
- resourceOptInfo: Json?
- windowsUpdateInfo: Json?
- defenderStatus: Json?
- applicationInventory: Json?
- customCheckResults: Json?
```

#### VMHealthCheckQueue Table
Manages queued health checks with retry logic:
```sql
- id: String (Primary Key)
- machineId: String (Foreign Key)
- checkType: HealthCheckType
- priority: TaskPriority
- status: TaskStatus
- payload: Json?
- attempts: Int
- maxAttempts: Int
- scheduledFor: DateTime
- executedAt: DateTime?
- completedAt: DateTime?
- error: String?
- result: Json?
- executionTimeMs: Int?
```

#### Enums
```sql
HealthCheckType:
- OVERALL_STATUS
- DISK_SPACE
- RESOURCE_OPTIMIZATION
- WINDOWS_UPDATES
- WINDOWS_DEFENDER
- APPLICATION_INVENTORY

TaskStatus:
- PENDING
- RUNNING
- COMPLETED
- FAILED
- RETRY_SCHEDULED

TaskPriority:
- URGENT
- HIGH
- MEDIUM
- LOW
```

## Services

### BackgroundHealthService

**Purpose**: Schedules and coordinates daily health check rounds

**Key Methods**:
- `start()` - Starts cron job for daily execution at 2 AM
- `executeHealthCheckRound()` - Queues health checks for all active VMs
- `triggerHealthCheckRound()` - Manual trigger for testing

**Cron Schedule**: `0 2 * * *` (Daily at 2 AM)

### VMHealthQueueManager

**Purpose**: Manages health check execution with priority queuing and retry logic

**Key Features**:
- In-memory queues with database persistence
- Priority-based task execution (URGENT > HIGH > MEDIUM > LOW)
- Exponential backoff retry mechanism
- Concurrency limits (5 per VM, 50 system-wide)
- Automatic queue processing when VMs come online

**Key Methods**:
- `queueHealthCheck(machineId, checkType, priority?, payload?)` - Queue single check
- `queueHealthChecks(machineId)` - Queue all standard checks
- `processQueue(machineId)` - Process pending checks for VM
- `getQueueStatistics()` - Get queue stats

**Health Check Types**:
1. `OVERALL_STATUS` - Runs all health checks (5min timeout)
2. `DISK_SPACE` - Check disk space usage (1min timeout)
3. `RESOURCE_OPTIMIZATION` - Check optimization opportunities (2min timeout)
4. `WINDOWS_UPDATES` - Check for Windows updates (5min timeout)
5. `WINDOWS_DEFENDER` - Check antivirus status (1min timeout)
6. `APPLICATION_INVENTORY` - Get installed applications via WMI (3min timeout)

**Retry Logic**:
- Maximum 3 attempts per task
- Exponential backoff: 1s, 2s, 4s (max 30s)
- Failed tasks marked as RETRY_SCHEDULED
- Tasks exceeding max attempts marked as FAILED

### VMHealthHistoryResolver

**Purpose**: GraphQL API for accessing health data

**Queries**:
- `vmHealthHistory(machineId, limit?, offset?)` - Get health snapshots
- `latestVMHealthSnapshot(machineId)` - Get latest snapshot
- `vmHealthCheckQueue(machineId?, status?, limit?, offset?)` - Get queue items
- `vmHealthStats(machineId)` - Get health statistics
- `healthCheckQueueStats()` - Get system queue statistics (admin only)

**Authorization**: All queries require USER role, admin queries require ADMIN role

## Integration Points

### VirtioSocketWatcherService Integration

When a VM connects via virtio socket:
1. Connection established successfully
2. `processHealthCheckQueue(connection)` called
3. Any queued health checks for the VM are processed immediately

**Integration Code**:
```typescript
// In VirtioSocketWatcherService.initialize()
initialize(vmEventManager?: VmEventManager, queueManager?: VMHealthQueueManager)

// In socket 'connect' event handler
this.processHealthCheckQueue(connection)
```

### Application Startup Integration

**In `app/index.ts`**:
```typescript
// Initialize health monitoring system
const healthQueueManager = new VMHealthQueueManager(prisma, eventManager)

// Pass to VirtioSocketWatcherService
virtioSocketWatcher.initialize(vmEventManager, healthQueueManager)
```

## Data Flow

### Daily Health Check Round
1. **BackgroundHealthService** executes at 2 AM via cron
2. Retrieves all active VMs from database
3. For each VM, calls `VMHealthQueueManager.queueHealthChecks()`
4. Standard health checks queued with MEDIUM priority
5. Real-time events dispatched for queue status

### VM Connection Health Check Processing
1. VM comes online and connects via virtio socket
2. **VirtioSocketWatcherService** detects successful connection
3. Calls `VMHealthQueueManager.processQueue(vmId)`
4. Queued checks executed via InfiniService commands
5. Results stored in **VMHealthSnapshot** table
6. Queue items marked as COMPLETED or FAILED

### Health Data Storage
1. Health check executed via **VirtioSocketWatcherService**
2. Results passed to `storeHealthSnapshot()`
3. Daily snapshot created/updated with check results
4. JSON fields store detailed health data
5. Overall status calculated from individual checks

## Error Handling

### Queue Management Errors
- Connection timeouts: Task marked for retry with exponential backoff
- Command failures: Error logged, task marked as FAILED after max attempts
- VM not found: Error thrown, queue operation aborted

### Health Check Execution Errors
- InfiniService command timeout: Task retried up to 3 times
- Invalid response format: Error logged, task marked as FAILED
- Database errors: Transaction rolled back, error event dispatched

## Performance Considerations

### Concurrency Limits
- **Per-VM limit**: 5 concurrent health checks
- **System-wide limit**: 50 concurrent health checks
- **Queue size limit**: 100 pending checks per VM

### Database Optimization
- Indexes on `machineId` and `snapshotDate` for efficient queries
- Composite indexes for queue processing
- JSON field usage for flexible health data storage

### Memory Management
- In-memory queues cleared on VM disconnection
- Queue items removed after completion
- Periodic cleanup of old completed/failed records

## Monitoring and Observability

### Logging
- Health check execution timing
- Queue processing statistics
- Error rates and retry attempts
- VM connection events

### Events
Real-time events dispatched via Socket.io:
- `health.status_changed` - Queue/check status updates
- `health.round_started` - Daily round begins
- `health.round_completed` - Daily round complete
- `health.round_failed` - Daily round failed

### GraphQL Queries for Monitoring
- Queue statistics by status
- Health trend analysis
- Failed check investigation
- Performance metrics

## Configuration

### Environment Variables
- Standard Infinibay configuration applies
- No additional environment variables required

### Cron Schedule Configuration
```typescript
// Default: Daily at 2 AM
new CronJob('0 2 * * *', async () => {
  await this.executeHealthCheckRound()
})

// Can be updated via updateSchedule() method
updateSchedule('0 3 * * *') // Change to 3 AM
```

### Queue Limits Configuration
```typescript
private readonly MAX_QUEUE_SIZE_PER_VM = 100
private readonly MAX_CONCURRENT_CHECKS_PER_VM = 5  
private readonly MAX_SYSTEM_WIDE_CONCURRENT = 50
```

## Usage Examples

### GraphQL Queries

**Get Latest Health Status**:
```graphql
query GetVMHealth($machineId: ID!) {
  latestVMHealthSnapshot(machineId: $machineId) {
    id
    snapshotDate
    overallStatus
    checksCompleted
    checksFailed
    diskSpaceInfo
    windowsUpdateInfo
    defenderStatus
  }
}
```

**Get Health History**:
```graphql
query GetHealthHistory($machineId: ID!, $limit: Int) {
  vmHealthHistory(machineId: $machineId, limit: $limit) {
    snapshotDate
    overallStatus
    checksCompleted
    checksFailed
    executionTimeMs
  }
}
```

**Get Queue Status**:
```graphql
query GetQueueStatus($machineId: ID) {
  vmHealthCheckQueue(machineId: $machineId) {
    checkType
    priority
    status
    attempts
    scheduledFor
    error
  }
}
```

### Programmatic Usage

**Queue Health Checks**:
```typescript
// Queue all standard health checks
await queueManager.queueHealthChecks(machineId)

// Queue specific check with priority
await queueManager.queueHealthCheck(
  machineId, 
  'DISK_SPACE', 
  'HIGH',
  { warning_threshold: 80 }
)
```

**Get Queue Statistics**:
```typescript
const stats = queueManager.getQueueStatistics()
console.log(`Active checks: ${stats.activeChecks}`)
console.log(`Total queued: ${stats.totalQueued}`)
```

## Testing

### Unit Tests
- `VMHealthQueueManager.test.ts` - Queue operations and retry logic
- Mock VirtioSocketWatcherService for isolated testing
- Mock EventManager for event testing

### Integration Tests
- Health check end-to-end flow
- Database persistence verification
- Real-time event emission

## Future Enhancements

### Planned Features
1. **Custom Health Checks** - User-defined health check scripts
2. **Health Thresholds** - Configurable warning/critical thresholds
3. **Health Alerts** - Email/Slack notifications for critical issues
4. **Health Trends** - Machine learning for anomaly detection
5. **Cross-Platform Support** - Linux health checks via InfiniService

### Scalability Considerations
1. **Queue Sharding** - Distribute queues across multiple workers
2. **Health Check Plugins** - Extensible health check system
3. **Metric Collection** - Prometheus/Grafana integration
4. **API Rate Limiting** - Prevent queue flooding

## Troubleshooting

### Common Issues

**Health checks not executing**:
1. Verify VM is online and connected via virtio socket
2. Check queue status via GraphQL API
3. Verify InfiniService is responding to commands

**Queue items stuck in PENDING**:
1. Check VM connectivity
2. Verify system-wide concurrency limits
3. Review error logs for InfiniService timeouts

**High memory usage**:
1. Check in-memory queue sizes
2. Clear queues for deleted VMs
3. Review queue cleanup configuration

### Debug Commands

**Check Queue Status**:
```typescript
const stats = queueManager.getQueueStatistics()
const vmQueueSize = queueManager.getQueueSize(machineId)
```

**Clear VM Queue**:
```typescript
await queueManager.clearQueue(machineId)
```

**Manual Health Check Round**:
```typescript
await backgroundHealthService.triggerHealthCheckRound()
```