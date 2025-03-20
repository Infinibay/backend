# Implementation Patterns

This document outlines common implementation patterns used in the Infinibay security service implementation. These patterns provide consistent approaches to common tasks and can be used as reference when extending or modifying the system.

## 1. Service Status Checking Pattern

When checking service status across multiple configuration levels (VM, Department, Global), use this pattern to apply inheritance correctly:

```typescript
/**
 * Retrieves effective service configuration by applying inheritance
 */
private getEffectiveServiceConfig(
  vmConfig: VMServiceConfig | null,
  deptConfig: DepartmentServiceConfig | null,
  globalConfig: GlobalServiceConfig | null
): { useEnabled: boolean; provideEnabled: boolean } {
  // Apply inheritance pattern for settings
  const useEnabled = vmConfig?.useEnabled !== undefined
    ? vmConfig.useEnabled
    : deptConfig?.useEnabled !== undefined
      ? deptConfig.useEnabled
      : globalConfig?.useEnabled ?? false;

  const provideEnabled = vmConfig?.provideEnabled !== undefined
    ? vmConfig.provideEnabled
    : deptConfig?.provideEnabled !== undefined
      ? deptConfig.provideEnabled
      : globalConfig?.provideEnabled ?? false;

  return { useEnabled, provideEnabled };
}
```

This pattern ensures that:
- VM-level settings take precedence if they exist
- Department-level settings are used as fallback
- Global settings are used as the default

## 2. Service Rule Management Pattern

When applying service rules to a filter, use this pattern to ensure clean rule management:

```typescript
/**
 * Apply service rules to a filter
 */
async applyServiceRules(
  filterId: string,
  service: ServiceDefinition,
  action: 'use' | 'provide',
  enabled: boolean
): Promise<void> {
  // First remove any existing rules for this service
  await this.removeServiceRules(filterId, service, action);

  // Then add new rules if enabled
  if (enabled) {
    await this.addServiceRules(filterId, service, action);
  }

  // Update filter timestamp to trigger synchronization
  await this.prisma.nWFilter.update({
    where: { id: filterId },
    data: { updatedAt: new Date() }
  });
}
```

This pattern ensures that:
- Existing rules are always removed first to prevent duplication
- New rules are only added if the service is enabled
- The filter's timestamp is updated to trigger synchronization

## 3. Port Record Management Pattern

When updating port records for service visibility, use this pattern:

```typescript
/**
 * Update VM port records for service visibility
 */
async updateVmPortRecords(
  vmId: string,
  service: ServiceDefinition,
  enabled: boolean
): Promise<void> {
  // For each port in the service definition
  for (const port of service.ports) {
    // Check if port record exists
    const existingPort = await this.prisma.vmPort.findFirst({
      where: {
        vmId,
        protocol: port.protocol,
        portStart: port.portStart,
        portEnd: port.portEnd
      }
    });

    if (existingPort) {
      // Update existing port record
      await this.prisma.vmPort.update({
        where: { id: existingPort.id },
        data: {
          enabled,
          toEnable: enabled,
          lastSeen: new Date()
        }
      });
    } else if (enabled) {
      // Create new port record if enabling
      await this.prisma.vmPort.create({
        data: {
          vmId,
          protocol: port.protocol,
          portStart: port.portStart,
          portEnd: port.portEnd,
          running: false,
          enabled: true,
          toEnable: true,
          lastSeen: new Date()
        }
      });
    }
  }
}
```

This pattern ensures that:
- Existing port records are updated rather than duplicated
- New port records are only created when needed
- Port records are kept in sync with service configuration

## 4. Service Running Detection Pattern

For checking if services are running, use this pattern:

```typescript
/**
 * Detects if a service is running by analyzing open ports
 */
private isServiceRunning(vmPorts: VmPort[], serviceDefinition: ServiceDefinition): boolean {
  return serviceDefinition.ports.some(servicePort =>
    vmPorts.some(vmPort =>
      vmPort.protocol === servicePort.protocol &&
      // Check for port range overlap
      vmPort.portStart <= servicePort.portEnd &&
      vmPort.portEnd >= servicePort.portStart &&
      // The port must be marked as running
      vmPort.running
    )
  );
}
```

This pattern:
- Checks if any port in the service definition matches a running port
- Handles port ranges correctly
- Only considers ports that are marked as running

## 5. Error Handling Patterns

### 5.1 Entity Existence Check

Always check if entities exist before operating on them:

```typescript
// Service existence check
const service = getServiceById(serviceId);
if (!service) {
  throw new Error(`Service with ID ${serviceId} not found`);
}

// VM existence check
const vm = await this.prisma.machine.findUnique({
  where: { id: vmId },
  include: { /* ... */ }
});

if (!vm) {
  throw new Error(`VM with ID ${vmId} not found`);
}

// Filter existence check
const vmFilter = await this.getVmFilter(vmId);
if (!vmFilter) {
  throw new Error(`Filter for VM ${vmId} not found`);
}
```

### 5.2 Batch Operation Error Handling

When performing batch operations, track successes and failures separately:

```typescript
const results = {
  resetVmCount: vmIds.length,
  successfulResets: [] as { vmId: string; vmName: string }[],
  failedResets: [] as { vmId: string; error: string }[]
};

for (const vmId of vmIds) {
  try {
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true, name: true }
    });
    
    if (!vm) {
      results.failedResets.push({ vmId, error: 'VM not found' });
      continue;
    }
    
    // Perform operation...
    
    results.successfulResets.push({ vmId: vm.id, vmName: vm.name });
  } catch (error) {
    results.failedResets.push({ 
      vmId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

return results;
```

This pattern:
- Continues processing even if some operations fail
- Provides detailed information about successes and failures
- Allows the caller to handle partial success appropriately

## 6. Database Query Optimization Patterns

### 6.1 Efficient Data Loading

Load only what's needed in database queries:

```typescript
// Only load what's needed
const vm = await this.prisma.machine.findUnique({
  where: { id: vmId },
  include: {
    serviceConfigs: {
      where: serviceId ? { serviceId } : undefined
    },
    ports: {
      where: {
        OR: [
          { running: true },
          { enabled: true },
          { toEnable: true }
        ]
      }
    },
    department: {
      include: {
        serviceConfigs: {
          where: serviceId ? { serviceId } : undefined
        }
      }
    }
  }
});
```

### 6.2 Batch Database Operations

Get global settings for inheritance in a single query:

```typescript
// Get all global configs in one query
const globalConfigs = await this.prisma.globalServiceConfig.findMany({
  where: serviceId ? { serviceId } : undefined
});

// Process all services in a single pass
return servicesToCheck.map(service => {
  // Find configs using in-memory data instead of separate queries
  const vmConfig = vm.serviceConfigs.find(c => c.serviceId === service.id);
  const deptConfig = vm.department?.serviceConfigs.find(c => c.serviceId === service.id);
  const globalConfig = globalConfigs.find(c => c.serviceId === service.id);
  
  // Apply inheritance...
});
```

### 6.3 Minimizing Redundant Filter Updates

Only update filter timestamp once after making multiple rule changes:

```typescript
// Make all rule changes
for (const port of service.ports) {
  await this.networkFilterService.createRule(/* ... */);
  await this.networkFilterService.createRule(/* ... */);
}

// Only update filter timestamp once
await this.prisma.nWFilter.update({
  where: { id: filterId },
  data: { updatedAt: new Date() }
});
```

## 7. GraphQL Integration Patterns

### 7.1 Resolver Implementation

```typescript
@Resolver()
export class SecurityResolver {
  private firewallService: FirewallService | null = null;

  private getFirewallService(prisma: PrismaClient): FirewallService {
    if (!this.firewallService) {
      this.firewallService = new FirewallService(prisma);
    }
    return this.firewallService;
  }

  // Query for listing services
  @Query(() => [ServiceDefinition])
  @Authorized(['ADMIN'])
  async listServices(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ServiceDefinition[]> {
    return this.getFirewallService(prisma).getServices();
  }
  
  // Mutation for toggling VM service
  @Mutation(() => VmServiceStatus)
  @Authorized(['ADMIN'])
  async toggleVmService(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: ToggleVmServiceInput
  ): Promise<VmServiceStatus> {
    return this.getFirewallService(prisma).toggleVmService(
      input.vmId,
      input.serviceId,
      input.action.toLowerCase() as 'use' | 'provide',
      input.enabled
    );
  }
}
```

### 7.2 Input Type Definition

```typescript
@InputType()
export class ToggleServiceInput {
  @Field()
  serviceId: string;
  
  @Field(() => ServiceAction)
  action: ServiceAction;
  
  @Field()
  enabled: boolean;
}

@InputType()
export class ToggleVmServiceInput extends ToggleServiceInput {
  @Field()
  vmId: string;
}

@InputType()
export class ToggleDepartmentServiceInput extends ToggleServiceInput {
  @Field()
  departmentId: string;
}
```

## 8. Testing Patterns

### 8.1 Service Configuration Testing

```typescript
describe('FirewallService', () => {
  let prisma: PrismaClient;
  let firewallService: FirewallService;
  
  beforeEach(() => {
    prisma = new PrismaClient();
    firewallService = new FirewallService(prisma);
  });
  
  describe('toggleVmService', () => {
    it('should enable a service for a VM', async () => {
      // Arrange
      const vmId = 'test-vm-id';
      const serviceId = 'http';
      
      // Act
      const result = await firewallService.toggleVmService(
        vmId,
        serviceId,
        'provide',
        true
      );
      
      // Assert
      expect(result.provideEnabled).toBe(true);
      expect(result.serviceId).toBe(serviceId);
      
      // Verify database state
      const vmConfig = await prisma.vMServiceConfig.findFirst({
        where: { vmId, serviceId }
      });
      expect(vmConfig).not.toBeNull();
      expect(vmConfig?.provideEnabled).toBe(true);
    });
  });
});
```

### 8.2 Filter Rule Verification

```typescript
describe('NetworkFilterService', () => {
  it('should generate correct XML for a filter with rules', async () => {
    // Arrange
    const filterId = 'test-filter-id';
    const filter = await prisma.nWFilter.findUnique({
      where: { id: filterId },
      include: { rules: true }
    });
    
    // Act
    const xml = await networkFilterService.generateXML(filter);
    
    // Assert
    expect(xml).toContain('<filter');
    expect(xml).toContain(`<uuid>${filter.uuid}</uuid>`);
    
    // Check for rule elements
    for (const rule of filter.rules) {
      expect(xml).toContain(`<rule action='${rule.action}' direction='${rule.direction}'`);
    }
  });
});
```

## 9. Common Pitfalls and Solutions

### 9.1 Filter Reference Cycles

**Problem**: Creating circular references between filters can cause issues.

**Solution**: Validate filter references to prevent cycles:

```typescript
async validateFilterReference(sourceId: string, targetId: string): Promise<boolean> {
  // Direct cycle check
  if (sourceId === targetId) {
    return false;
  }
  
  // Check if target references source indirectly
  const targetReferences = await this.prisma.filterReference.findMany({
    where: { sourceFilterId: targetId },
    select: { targetFilterId: true }
  });
  
  for (const ref of targetReferences) {
    if (ref.targetFilterId === sourceId) {
      return false;
    }
    
    // Recursive check for indirect cycles
    const isValid = await this.validateFilterReference(sourceId, ref.targetFilterId);
    if (!isValid) {
      return false;
    }
  }
  
  return true;
}
```

### 9.2 Orphaned Port Records

**Problem**: Port records may become orphaned if services are disabled.

**Solution**: Implement a cleanup routine:

```typescript
async cleanupOrphanedPorts(): Promise<number> {
  const result = await this.prisma.vmPort.deleteMany({
    where: {
      enabled: false,
      toEnable: false,
      running: false,
      lastSeen: {
        lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
      }
    }
  });
  
  return result.count;
}
```

### 9.3 Inconsistent Service State

**Problem**: Service configuration and actual running state may become inconsistent.

**Solution**: Implement a reconciliation process:

```typescript
async reconcileServiceState(vmId: string): Promise<void> {
  const vm = await this.prisma.machine.findUnique({
    where: { id: vmId },
    include: {
      ports: true,
      serviceConfigs: true
    }
  });
  
  if (!vm) {
    throw new Error(`VM with ID ${vmId} not found`);
  }
  
  // For each service
  for (const service of KNOWN_SERVICES) {
    const vmConfig = vm.serviceConfigs.find(c => c.serviceId === service.id);
    
    // If service is configured to be provided
    if (vmConfig?.provideEnabled) {
      // Ensure port records exist
      await this.updateVmPortRecords(vmId, service, true);
    }
  }
}
```
