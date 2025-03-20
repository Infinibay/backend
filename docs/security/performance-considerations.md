# Performance Considerations

This document outlines performance considerations for the Infinibay security service implementation, focusing on optimizing network filter operations, database interactions, and service management.

## 1. Network Filter Performance

### 1.1 Filter Complexity Impact

The complexity of network filters directly impacts VM network performance:

| Filter Complexity | Rules Count | Performance Impact |
|-------------------|-------------|-------------------|
| Low               | 1-10        | Negligible        |
| Medium            | 11-50       | Minor             |
| High              | 51-100      | Moderate          |
| Very High         | 100+        | Significant       |

**Recommendations:**
- Keep rule count below 50 per filter when possible
- Use filter references to organize and reuse rules
- Prioritize rules to ensure most common traffic patterns match early

### 1.2 Rule Prioritization

Rule priority affects packet processing efficiency:

```
Higher Priority (Lower Number)
┌─────────────────────────────┐
│ Critical Security Rules     │ Priority: 100-300
├─────────────────────────────┤
│ Common Traffic Patterns     │ Priority: 400-600
├─────────────────────────────┤
│ Fallback/Default Rules      │ Priority: 700-900
└─────────────────────────────┘
Lower Priority (Higher Number)
```

**Recommendations:**
- Place most frequently matched rules at higher priorities
- Group related rules with similar priorities
- Use priority ranges to organize rules by function

### 1.3 Filter Hierarchy Optimization

The filter reference hierarchy affects processing depth:

```
Shallow Hierarchy (Faster)
┌─────────┐
│ VM      │
│ Filter  │──┐
└─────────┘  │
             ├─► ┌─────────┐
             │   │ Generic │
             │   │ Filter  │
             │   └─────────┘
┌─────────┐  │
│ Dept    │──┘
│ Filter  │
└─────────┘

Deep Hierarchy (Slower)
┌─────────┐
│ VM      │
│ Filter  │──┐
└─────────┘  │
             ├─► ┌─────────┐    ┌─────────┐    ┌─────────┐
             │   │ Dept    │───►│ Generic │───►│ Generic │
             │   │ Filter  │    │ Filter1 │    │ Filter2 │
             │   └─────────┘    └─────────┘    └─────────┘
┌─────────┐  │
│ Other   │──┘
│ Filter  │
└─────────┘
```

**Recommendations:**
- Limit hierarchy depth to 2-3 levels
- Flatten hierarchies when possible
- Avoid circular references (these will be rejected by libvirt)

## 2. Database Query Optimization

### 2.1 Service Status Query Patterns

Fetching service status involves multiple database tables:

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────────┐
│ Machine      │────►│ VMServiceConfig   │     │ DepartmentService   │
└──────────────┘     └───────────────────┘     │ Config              │
       │                                        └─────────────────────┘
       │                                                 ▲
       │                                                 │
       └─────────────────────────────────────────────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │ GlobalService   │
                      │ Config          │
                      └─────────────────┘
```

**Recommendations:**
- Use Prisma's nested includes to fetch related data in a single query
- Create indexes on frequently queried fields
- Use selective includes to avoid fetching unnecessary data

### 2.2 Batch Operations

When updating multiple services or VMs:

**Inefficient Approach:**
```typescript
// Updating services one by one
for (const vmId of vmIds) {
  for (const serviceId of serviceIds) {
    await toggleVmService(vmId, serviceId, action, enabled);
  }
}
```

**Optimized Approach:**
```typescript
// Batch database operations
await prisma.$transaction(async (tx) => {
  // Create all records in a single operation
  await tx.vMServiceConfig.createMany({
    data: vmIds.flatMap(vmId => 
      serviceIds.map(serviceId => ({
        vmId,
        serviceId,
        useEnabled: action === 'use' ? enabled : undefined,
        provideEnabled: action === 'provide' ? enabled : undefined
      }))
    ),
    skipDuplicates: true
  });
  
  // Update filter timestamps in a single operation
  await tx.nWFilter.updateMany({
    where: {
      vMNWFilter: {
        some: {
          vmId: {
            in: vmIds
          }
        }
      }
    },
    data: {
      updatedAt: new Date()
    }
  });
});
```

### 2.3 Pagination for Large Datasets

When dealing with large numbers of VMs or services:

```typescript
async getDepartmentVmServiceStatus(
  departmentId: string,
  serviceId: string,
  page = 1,
  pageSize = 50
): Promise<PaginatedResult<VmServiceStatus>> {
  const skip = (page - 1) * pageSize;
  
  const [totalCount, items] = await Promise.all([
    // Count query
    this.prisma.machine.count({
      where: { departmentId }
    }),
    
    // Data query with pagination
    this.prisma.machine.findMany({
      where: { departmentId },
      skip,
      take: pageSize,
      include: {
        serviceConfigs: {
          where: { serviceId }
        },
        // Other includes...
      }
    })
  ]);
  
  // Process results...
  
  return {
    items: processedItems,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize)
  };
}
```

## 3. XML Generation and Application

### 3.1 XML Generation Optimization

XML generation can be resource-intensive for complex filters:

**Recommendations:**
- Cache generated XML for unchanged filters
- Use incremental XML updates when possible
- Implement XML generation rate limiting for large-scale updates

### 3.2 Filter Application Throttling

Applying filters to libvirt can impact hypervisor performance:

```typescript
// Rate-limited filter application
export class FilterApplier {
  private queue: Array<{ filterId: string, priority: number }> = [];
  private processing = false;
  private maxConcurrent = 5;
  private activeCount = 0;
  
  async queueFilterApplication(filterId: string, priority = 5): Promise<void> {
    this.queue.push({ filterId, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
    
    if (!this.processing) {
      this.processing = true;
      this.processQueue();
    }
  }
  
  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const { filterId } = this.queue.shift()!;
      this.activeCount++;
      
      try {
        // Apply filter asynchronously
        this.applyFilter(filterId).finally(() => {
          this.activeCount--;
        });
      } catch (error) {
        console.error(`Error applying filter ${filterId}:`, error);
        this.activeCount--;
      }
    }
    
    if (this.queue.length === 0 && this.activeCount === 0) {
      this.processing = false;
    } else {
      // Continue processing after a short delay
      setTimeout(() => this.processQueue(), 100);
    }
  }
  
  private async applyFilter(filterId: string): Promise<void> {
    // Filter application logic...
  }
}
```

## 4. Service Management Performance

### 4.1 Service Enablement Impact

Enabling services affects both database and filter operations:

| Operation | Database Impact | Filter Impact | VM Impact |
|-----------|----------------|---------------|-----------|
| Enable single service | Low | Low | Low |
| Disable single service | Low | Low | Low |
| Enable multiple services | Medium | Medium | Medium |
| Department-wide change | High | High | High |
| Global change | Very High | Very High | Very High |

**Recommendations:**
- Implement progressive loading for large-scale changes
- Use background jobs for department and global changes
- Provide status updates for long-running operations

### 4.2 Bulk Service Configuration

For bulk operations, use optimized approaches:

```typescript
async applyServiceToAllDepartmentVms(
  departmentId: string,
  serviceId: string,
  action: 'use' | 'provide',
  enabled: boolean
): Promise<DepartmentServiceStatus> {
  // Get all VMs in department
  const vms = await this.prisma.machine.findMany({
    where: { departmentId },
    select: { id: true }
  });
  
  // Process in batches
  const batchSize = 20;
  for (let i = 0; i < vms.length; i += batchSize) {
    const batch = vms.slice(i, i + batchSize);
    
    // Process batch in parallel
    await Promise.all(
      batch.map(vm => 
        this.toggleVmService(vm.id, serviceId, action, enabled)
      )
    );
  }
  
  // Update department config
  await this.toggleDepartmentService(
    departmentId,
    serviceId,
    action,
    enabled
  );
  
  // Return updated status
  return this.getDepartmentServiceStatus(departmentId, serviceId)
    .then(results => results[0]);
}
```

## 5. Caching Strategies

### 5.1 Service Definition Caching

Service definitions rarely change and can be cached:

```typescript
export class ServiceDefinitionCache {
  private cache: Map<string, ServiceDefinition> = new Map();
  private allServicesCache: ServiceDefinition[] | null = null;
  private lastRefresh: number = 0;
  private readonly TTL = 3600000; // 1 hour in milliseconds
  
  async getServiceById(id: string): Promise<ServiceDefinition | null> {
    await this.refreshIfNeeded();
    return this.cache.get(id) || null;
  }
  
  async getAllServices(): Promise<ServiceDefinition[]> {
    await this.refreshIfNeeded();
    return this.allServicesCache || [];
  }
  
  private async refreshIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefresh > this.TTL) {
      await this.refreshCache();
    }
  }
  
  private async refreshCache(): Promise<void> {
    // Load services from source
    const services = getKnownServices();
    
    // Update cache
    this.allServicesCache = services;
    this.cache.clear();
    for (const service of services) {
      this.cache.set(service.id, service);
    }
    
    this.lastRefresh = Date.now();
  }
}
```

### 5.2 Filter XML Caching

Cache generated XML to avoid regeneration:

```typescript
export class FilterXmlCache {
  private cache: Map<string, { xml: string, timestamp: number }> = new Map();
  
  getXml(filterId: string, filterTimestamp: number): string | null {
    const cached = this.cache.get(filterId);
    
    if (cached && cached.timestamp >= filterTimestamp) {
      return cached.xml;
    }
    
    return null;
  }
  
  setXml(filterId: string, xml: string, timestamp: number): void {
    this.cache.set(filterId, { xml, timestamp });
    
    // Prune cache if it gets too large
    if (this.cache.size > 1000) {
      this.pruneCache();
    }
  }
  
  private pruneCache(): void {
    // Remove oldest entries
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }
}
```

## 6. Monitoring and Optimization

### 6.1 Performance Metrics

Monitor key performance indicators:

| Metric | Description | Target |
|--------|-------------|--------|
| Filter Application Time | Time to apply a filter to libvirt | < 500ms |
| Service Toggle Response Time | Time to enable/disable a service | < 1s |
| Department-wide Change Time | Time to apply a change to all VMs | < 5s per 10 VMs |
| Database Query Time | Time for complex service status queries | < 200ms |
| XML Generation Time | Time to generate filter XML | < 100ms |

### 6.2 Query Analysis

Identify slow queries using Prisma middleware:

```typescript
// Add to Prisma client initialization
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;
  
  if (duration > 100) {
    console.warn(`Slow query (${duration}ms): ${params.model}.${params.action}`);
    // Log query details for analysis
  }
  
  return result;
});
```

### 6.3 Performance Tuning Recommendations

Based on system scale:

| Scale | VMs | Departments | Recommendations |
|-------|-----|-------------|----------------|
| Small | <50 | <5 | Default settings are sufficient |
| Medium | 50-200 | 5-20 | Enable caching, optimize queries |
| Large | 200-1000 | 20-100 | Implement batching, background processing |
| Very Large | 1000+ | 100+ | Distributed processing, aggressive caching |

## 7. Scaling Considerations

### 7.1 Horizontal Scaling

For large deployments:

- Implement a queue system for filter operations
- Use worker processes for batch operations
- Distribute filter application across multiple nodes

### 7.2 Database Scaling

As the system grows:

- Optimize indexes for service configuration tables
- Consider read replicas for status queries
- Implement database sharding for very large deployments

### 7.3 Cron Job Optimization

Optimize synchronization jobs:

```typescript
// Efficient filter synchronization
async syncUpdatedFilters(): Promise<void> {
  // Get filters that need updating
  const updatedFilters = await this.prisma.nWFilter.findMany({
    where: {
      OR: [
        { flushedAt: null },
        { updatedAt: { gt: { flushedAt: true } } }
      ]
    },
    orderBy: { updatedAt: 'asc' },
    take: 50 // Process in batches
  });
  
  // Process filters in parallel with concurrency limit
  await Promise.all(
    updatedFilters.map(filter => 
      this.processFilter(filter)
    )
  );
}

private async processFilter(filter: NWFilter): Promise<void> {
  try {
    await this.networkFilterService.syncFilter(filter.id);
    
    // Update flushedAt timestamp
    await this.prisma.nWFilter.update({
      where: { id: filter.id },
      data: { flushedAt: new Date() }
    });
  } catch (error) {
    console.error(`Error syncing filter ${filter.id}:`, error);
    // Increment error count for tracking
  }
}
```
