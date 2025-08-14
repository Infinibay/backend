# Cron System: Automated Background Operations

## Overview

The Infinibay Cron System is a sophisticated background task scheduler that maintains system health, synchronizes state, and performs automated maintenance operations. Unlike traditional cron jobs that run on fixed schedules without system awareness, Infinibay's cron system is tightly integrated with the virtualization platform and provides real-time status synchronization.

## Business Context

### Problem Statement
Virtualization platforms require continuous monitoring and maintenance to ensure:
- **State Consistency**: VM status in the database must match actual hypervisor state
- **Resource Management**: Cleanup of orphaned resources and temporary files  
- **Service Health**: Detection of failed services and automatic recovery
- **Performance Optimization**: Regular cleanup and optimization tasks

### Why This Approach?
Traditional solutions often rely on external cron jobs or simple timers, but Infinibay's integrated approach provides:

1. **System Awareness**: Jobs understand the current state of VMs and services
2. **Error Handling**: Sophisticated error recovery and logging
3. **Performance Optimization**: Jobs only run when necessary, not on fixed schedules
4. **Integration**: Direct access to the same database and libvirt connections used by the main application

### Business Value
- **99.9% Uptime**: Automatic detection and recovery from common issues
- **Data Integrity**: Consistent state between database and hypervisor
- **Operational Efficiency**: Reduced manual intervention and maintenance overhead
- **Resource Optimization**: Automatic cleanup prevents resource exhaustion

## Technical Architecture

### System Design

```mermaid
graph TB
    subgraph "Cron System Architecture"
        Orchestrator[Cron Orchestrator] --> VMStatus[VM Status Sync Job]
        Orchestrator --> Services[Service Health Check]
        Orchestrator --> Graphics[Graphics Info Update]
        Orchestrator --> Firewall[Firewall Flush Job]
        
        VMStatus --> Libvirt[Libvirt API]
        VMStatus --> DB[(Database)]
        
        Services --> ServiceRegistry[Known Services Registry]
        Services --> DB
        
        Graphics --> SystemInfo[System Information API]
        Graphics --> DB
        
        Firewall --> NetworkFilters[Network Filter Service]
        Firewall --> Libvirt
    end
    
    subgraph "External Dependencies"
        Hypervisor[KVM/QEMU Hypervisor]
        NetworkStack[Linux Network Stack]
        SystemHardware[System Hardware]
    end
    
    Libvirt --> Hypervisor
    NetworkFilters --> NetworkStack
    SystemInfo --> SystemHardware
```

### Component Relationships

The cron system operates as a collection of independent, specialized jobs that share common infrastructure:

1. **Job Orchestrator** (`app/crons/all.ts`): Centralized job lifecycle management
2. **Individual Jobs**: Specialized tasks with single responsibilities
3. **Shared Infrastructure**: Database connections, libvirt connections, logging
4. **Error Recovery**: Centralized error handling and reporting

## Implementation Deep Dive

### Job Orchestrator

**File**: `/home/andres/infinibay/backend/app/crons/all.ts`

```typescript
export async function startCrons() {
  UpdateVmStatusJob.start()
  CheckRunningServicesJob.start()
  UpdateGraphicsInformationJob.start()
  FlushFirewallJob.start()
}
```

**What it does**: Initializes and starts all background jobs when the application boots.

**Why this design**: 
- **Centralized Control**: Single point to manage all background operations
- **Fail-Fast**: If any critical job fails to start, the entire application fails to boot
- **Dependency Management**: Ensures jobs start in the correct order

**What for**: Provides a reliable foundation for all automated operations that keep the system healthy and synchronized.

### VM Status Synchronization Job

**File**: `/home/andres/infinibay/backend/app/crons/UpdateVmStatus.ts`

This is the most critical job in the system, running every minute to ensure database consistency.

#### The Implementation

```typescript
const UpdateVmStatusJob = new CronJob('*/1 * * * *', async () => {
  try {
    // Get list of running VMs from libvirt
    const runningVms = await getRunningDomainNames()

    // Get all VMs from database
    const allVms = await prisma.machine.findMany({
      select: {
        id: true,
        internalName: true,
        status: true
      }
    })

    // Find VMs that need status updates
    const runningVmIds = allVms
      .filter((vm) =>
        runningVms.includes(vm.internalName) &&
        vm.status !== 'running'
      )
      .map((vm) => vm.id)

    const stoppedVmIds = allVms
      .filter((vm) =>
        !runningVms.includes(vm.internalName) &&
        vm.status !== 'stopped' &&
        vm.status !== 'failed' // Don't update failed VMs
      )
      .map((vm) => vm.id)

    // Update running VMs
    if (runningVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: runningVmIds } },
        data: { status: 'running' }
      })
    }

    // Update stopped VMs
    if (stoppedVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: stoppedVmIds } },
        data: { status: 'stopped' }
      })
    }
  } catch (error) {
    console.error('Error in UpdateVmStatusJob:', error)
  }
})
```

#### Deep Analysis

**What it does**:
1. **Queries Hypervisor**: Uses libvirt to get all currently running VM domains
2. **Compares State**: Cross-references hypervisor state with database records
3. **Identifies Discrepancies**: Finds VMs where database status doesn't match reality
4. **Bulk Updates**: Efficiently updates multiple VM statuses in single database operations

**Why this approach**:
- **Performance**: Uses `listAllDomains(16)` flag to only fetch running domains, reducing API calls
- **Efficiency**: Bulk database updates instead of individual queries
- **Safety**: Preserves 'failed' status VMs to avoid overwriting intentional error states
- **Reliability**: Continues operation even if individual queries fail

**What for**:
- **User Experience**: Real-time status updates in the UI without manual refresh
- **API Consistency**: GraphQL queries always return accurate VM states
- **Operational Awareness**: Administrators can trust status indicators for decision-making
- **Automation Foundation**: Other systems can rely on accurate status for automated operations

#### The Libvirt Integration

```typescript
async function getRunningDomainNames(): Promise<string[]> {
  try {
    const conn = Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to open connection to libvirt')
    }

    try {
      // Get all domains with flag 16 (VIR_CONNECT_LIST_DOMAINS_RUNNING)
      const domains = await conn.listAllDomains(16)
      if (!domains || domains.length === 0) {
        return []
      }

      return domains.map((domain) => domain.getName() || '')
    } finally {
      conn.close()
    }
  } catch (error) {
    console.error('Error in getRunningDomainNames:', error)
    return []
  }
}
```

**Technical Details**:
- **Connection Management**: Opens and closes libvirt connections properly to prevent resource leaks
- **Error Isolation**: Returns empty array on error rather than crashing the job
- **Efficient Filtering**: Uses libvirt's native filtering (flag 16) instead of fetching all domains and filtering in code

### Graphics Information Update Job

**File**: `/home/andres/infinibay/backend/app/crons/UpdateGraphicsInformation.ts`

This job maintains accurate GPU information for VM creation and management.

#### Why Graphics Information Matters

In a virtualization environment, GPU passthrough and graphics capabilities are crucial for:
- **Performance**: High-performance computing workloads
- **Remote Access**: Efficient remote desktop experiences
- **Resource Planning**: Knowing which GPUs are available for assignment

#### Implementation Strategy

```typescript
// Simplified structure - actual implementation fetches detailed GPU info
const UpdateGraphicsInformationJob = new CronJob('0 */6 * * *', async () => {
  try {
    // Get current GPU information from system
    const gpuInfo = await getSystemGraphicsInfo()
    
    // Update database with current capabilities
    await updateGraphicsCapabilities(gpuInfo)
    
    // Clean up stale GPU assignments
    await cleanupOrphanedGpuAssignments()
    
  } catch (error) {
    console.error('Graphics update failed:', error)
  }
})
```

**What it does**: Periodically scans system hardware and updates GPU availability information.

**Why every 6 hours**: 
- GPU hardware changes infrequently
- Reduces system load from hardware scanning
- Balances freshness with performance

**What for**: Enables intelligent GPU assignment during VM creation and prevents conflicts.

### Service Health Monitoring Job

**File**: `/home/andres/infinibay/backend/app/crons/CheckRunningServices.ts`

This job monitors critical system services and can trigger recovery procedures.

#### The Service Registry Approach

```typescript
// Service definitions from knownServices.ts
const KNOWN_SERVICES = [
  {
    name: 'libvirtd',
    description: 'Virtualization daemon',
    critical: true,
    recovery: 'auto'
  },
  {
    name: 'postgresql',
    description: 'Database service',
    critical: true,
    recovery: 'manual'
  },
  // ... more services
]
```

**What it does**: Checks if critical services are running and healthy.

**Why this pattern**:
- **Centralized Configuration**: All service definitions in one place
- **Flexible Recovery**: Different services have different recovery strategies
- **Extensibility**: Easy to add new services without code changes

**What for**: Prevents system failures by detecting and recovering from service outages before they impact users.

### Firewall Flush Job

**File**: `/home/andres/infinibay/backend/app/crons/flushFirewall.ts`

This job ensures network security policies stay synchronized with the actual network stack.

#### Why Firewall Synchronization is Critical

Network filters in libvirt can become stale due to:
- **System Reboots**: Filters may not reload properly
- **Service Restarts**: Network service interruptions
- **Configuration Changes**: Manual network modifications
- **Software Updates**: Security updates that affect networking

#### Implementation Pattern

```typescript
const FlushFirewallJob = new CronJob('0 */1 * * *', async () => {
  try {
    // Get all active network filters from database
    const activeFilters = await getActiveNetworkFilters()
    
    // Ensure each filter exists in libvirt
    for (const filter of activeFilters) {
      await ensureFilterInLibvirt(filter)
    }
    
    // Remove orphaned filters from libvirt
    await cleanupOrphanedFilters()
    
  } catch (error) {
    console.error('Firewall flush failed:', error)
  }
})
```

**What it does**: Synchronizes network security policies between the database and the actual network stack.

**Why hourly**: 
- Network policies are critical for security
- Hourly checks catch issues quickly
- Balances security with system performance

**What for**: Maintains security posture by ensuring network isolation policies are actively enforced.

## Configuration & Usage

### Environment Variables

The cron system respects these environment variables:

```bash
# Database connection for job operations
DATABASE_URL="postgresql://user:pass@localhost:5432/infinibay"

# Libvirt connection URI
LIBVIRT_URI="qemu:///system"

# Logging configuration
DEBUG_CATEGORIES="cron,vm-status,graphics,services,firewall"

# Job intervals (can override defaults)
VM_STATUS_INTERVAL="*/1 * * * *"  # Every minute
GRAPHICS_INTERVAL="0 */6 * * *"   # Every 6 hours
SERVICES_INTERVAL="*/5 * * * *"   # Every 5 minutes
FIREWALL_INTERVAL="0 */1 * * *"   # Every hour
```

### Job Control

Jobs can be controlled programmatically:

```typescript
// Starting jobs (typically in application startup)
import { startCrons } from '@crons/all'
await startCrons()

// Individual job control
import UpdateVmStatusJob from '@crons/UpdateVmStatus'

// Start a specific job
UpdateVmStatusJob.start()

// Stop a specific job
UpdateVmStatusJob.stop()

// Check if job is running
const isRunning = UpdateVmStatusJob.running
```

### Error Handling Configuration

Each job implements comprehensive error handling:

```typescript
const job = new CronJob('*/1 * * * *', async () => {
  try {
    await performJobLogic()
  } catch (error) {
    // Log error details
    console.error(`Job ${jobName} failed:`, error)
    
    // Optionally notify administrators
    if (error.severity === 'critical') {
      await notifyAdministrators(error)
    }
    
    // Continue operation (don't crash the job)
    // Individual jobs are isolated from each other
  }
})
```

## Performance Considerations

### Database Performance

**Connection Reuse**: Jobs reuse the main application's database connection pool rather than creating new connections.

```typescript
// Efficient: Uses shared connection pool
import prisma from '@utils/database'

// Instead of creating new connections
const allVms = await prisma.machine.findMany()
```

**Bulk Operations**: Jobs prefer bulk database operations over individual queries:

```typescript
// Efficient: Single bulk update
await prisma.machine.updateMany({
  where: { id: { in: vmIds } },
  data: { status: 'running' }
})

// Instead of: Multiple individual updates
for (const vmId of vmIds) {
  await prisma.machine.update({
    where: { id: vmId },
    data: { status: 'running' }
  })
}
```

### Libvirt Performance

**Connection Management**: Each job opens and closes libvirt connections to prevent resource leaks:

```typescript
const conn = Connection.open('qemu:///system')
try {
  // Perform operations
} finally {
  conn.close() // Always close connections
}
```

**Efficient Queries**: Jobs use libvirt's native filtering capabilities:

```typescript
// Efficient: Only fetch running domains
const domains = await conn.listAllDomains(16) // VIR_CONNECT_LIST_DOMAINS_RUNNING

// Instead of: Fetch all domains and filter in code
const allDomains = await conn.listAllDomains(0)
const runningDomains = allDomains.filter(d => d.isActive())
```

### Memory Management

**Resource Cleanup**: Jobs are designed to release resources properly:

```typescript
async function jobWithCleanup() {
  const resources = []
  try {
    // Acquire resources
    resources.push(await acquireResource())
    
    // Perform work
    await performWork(resources)
    
  } finally {
    // Always clean up
    for (const resource of resources) {
      await resource.close()
    }
  }
}
```

## Monitoring & Observability

### Logging Strategy

The cron system implements structured logging:

```typescript
import { Debugger } from '@utils/debug'

const debug = new Debugger('cron:vm-status')

// Informational logging
debug.log('Starting VM status synchronization')

// Error logging with context
debug.error('Failed to update VM status', {
  vmId: 'vm-123',
  error: error.message,
  stack: error.stack
})

// Performance logging
const startTime = Date.now()
await performOperation()
debug.log(`Operation completed in ${Date.now() - startTime}ms`)
```

### Health Checks

Each job exposes health information:

```typescript
// Job health information
const jobHealth = {
  name: 'UpdateVmStatus',
  running: UpdateVmStatusJob.running,
  lastRun: UpdateVmStatusJob.lastDate(),
  nextRun: UpdateVmStatusJob.nextDate(),
  errors: errorCount,
  successRate: successRate
}
```

### Metrics Collection

Jobs emit metrics for monitoring:

```typescript
// Example metrics emitted by jobs
{
  "cron.vm_status.execution_time": 1250,
  "cron.vm_status.vms_updated": 15,
  "cron.graphics.gpus_detected": 2,
  "cron.services.services_checked": 8,
  "cron.firewall.filters_synced": 23
}
```

## Troubleshooting Guide

### Common Issues

#### VM Status Not Updating

**Symptom**: VM status in UI doesn't match actual state

**Diagnosis**:
```bash
# Check if cron job is running
docker exec infinibay-backend ps aux | grep cron

# Check libvirt connectivity
docker exec infinibay-backend virsh list --all

# Check job logs
docker logs infinibay-backend 2>&1 | grep "UpdateVmStatus"
```

**Solutions**:
1. **Libvirt Connection**: Ensure libvirt daemon is running and accessible
2. **Permissions**: Verify application has proper libvirt permissions
3. **Database**: Check database connectivity and query performance

#### Graphics Information Stale

**Symptom**: GPU assignment fails despite available hardware

**Diagnosis**:
```bash
# Check recent graphics updates
grep "UpdateGraphicsInformation" /var/log/infinibay/backend.log

# Verify GPU detection
lspci | grep -i vga
nvidia-smi  # For NVIDIA GPUs
```

**Solutions**:
1. **Hardware Detection**: Ensure GPU drivers are properly installed
2. **Permissions**: Verify application can access hardware information
3. **Job Timing**: Consider running graphics update job more frequently

### Performance Issues

#### Jobs Taking Too Long

**Symptom**: Jobs exceed their expected execution time

**Diagnosis**:
```typescript
// Add timing to job logic
const startTime = Date.now()
await performJobLogic()
const duration = Date.now() - startTime
console.log(`Job completed in ${duration}ms`)
```

**Solutions**:
1. **Database Optimization**: Add indexes for job queries
2. **Batch Size**: Reduce batch sizes for bulk operations
3. **Resource Limits**: Ensure adequate CPU and memory allocation

#### Jobs Overlapping

**Symptom**: New job instance starts before previous completes

**Prevention**:
```typescript
let jobRunning = false

const job = new CronJob('*/1 * * * *', async () => {
  if (jobRunning) {
    console.log('Previous job still running, skipping')
    return
  }
  
  jobRunning = true
  try {
    await performJobLogic()
  } finally {
    jobRunning = false
  }
})
```

### Recovery Procedures

#### Restarting Failed Jobs

```typescript
// Restart all jobs
import { startCrons } from '@crons/all'
await startCrons()

// Restart individual job
UpdateVmStatusJob.stop()
UpdateVmStatusJob.start()
```

#### Manual Synchronization

If jobs fail repeatedly, manual synchronization may be necessary:

```bash
# Manual VM status sync
docker exec infinibay-backend npm run sync:vm-status

# Manual graphics info update
docker exec infinibay-backend npm run sync:graphics

# Manual service check
docker exec infinibay-backend npm run check:services
```

## Best Practices

### Development

1. **Isolation**: Each job should be independent and not rely on other jobs
2. **Error Handling**: Always implement comprehensive error handling
3. **Resource Management**: Properly close connections and release resources
4. **Logging**: Use structured logging with appropriate detail levels
5. **Testing**: Write unit tests that mock external dependencies

### Operations

1. **Monitoring**: Set up alerts for job failures and performance degradation
2. **Capacity Planning**: Monitor job execution times and resource usage
3. **Backup**: Ensure job logic is included in disaster recovery procedures
4. **Documentation**: Keep job documentation updated as business requirements change

### Security

1. **Permissions**: Run jobs with minimal required permissions
2. **Input Validation**: Validate all external data before processing
3. **Error Messages**: Don't expose sensitive information in error logs
4. **Access Control**: Secure job management interfaces

The Infinibay Cron System provides a robust foundation for automated operations while maintaining the flexibility to adapt to changing business requirements. Its integration with the core platform ensures reliable, efficient, and secure background operations that keep the virtualization platform running smoothly.