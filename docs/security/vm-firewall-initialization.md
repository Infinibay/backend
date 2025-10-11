# VM Firewall Initialization

## Overview

When a new VM is created in Infinibay, the firewall system is automatically initialized to ensure network security from the moment the VM starts. This document describes the automatic firewall initialization process.

## Architecture

The VM firewall initialization follows these key design principles:

- **Single Responsibility**: `VMFirewallSyncService` handles only firewall initialization logic
- **Dependency Injection**: Reuses existing firewall services (OrchestrationService, RuleService)
- **Graceful Degradation**: VM creation succeeds even if firewall init fails (manual sync available)
- **Separation of Concerns**: Firewall logic separated from VM creation logic

## Initialization Flow

### 1. VM Creation Trigger

When `CreateMachineService.create()` is called, the following sequence occurs:

```typescript
// In CreateMachineService
1. Create storage volume
2. Generate VM XML (without filterref initially)
3. Define and start VM in libvirt
4. **Initialize firewall** ← New step
5. Update VM status to 'running'
```

### 2. Firewall Initialization Steps

The `initializeVMFirewall()` method performs these operations:

```typescript
// Pseudo-code flow
async initializeVMFirewall(vmId) {
  1. Ensure department has FirewallRuleSet
     - Check if department.firewallRuleSet exists
     - Create if missing: `ibay-dept-{id}`

  2. Ensure VM has FirewallRuleSet
     - Check if vm.firewallRuleSet exists
     - Create if missing: `ibay-vm-{id}`

  3. Apply effective rules to libvirt
     - Calculate effective rules (dept + VM - overrides)
     - Generate nwfilter XML
     - Define filter in libvirt
     - Apply filter to VM's network interface
}
```

### 3. Network Interface Update

The `LibvirtNWFilterService.applyFilterToVM()` method:

1. Fetches current VM XML from libvirt
2. Parses XML to find network interfaces
3. Adds/updates `<filterref filter="ibay-vm-{id}"/>` to each interface
4. Redefines VM with updated XML

**Important**: This updates the *persistent* VM configuration. For running VMs, a restart may be needed for filter changes to take full effect (depending on libvirt version).

## Components

### VMFirewallSyncService

**Location**: `app/services/firewall/VMFirewallSyncService.ts`

**Responsibilities**:
- Ensure department has FirewallRuleSet
- Ensure VM has FirewallRuleSet
- Trigger firewall rule application via OrchestrationService

**Key Methods**:
```typescript
interface VMFirewallSyncService {
  // Initialize firewall for newly created VM
  initializeVMFirewall(vmId: string): Promise<VMFirewallInitResult>

  // Ensure department has base ruleset
  ensureDepartmentRuleSet(departmentId: string): Promise<void>
}
```

**Return Type**:
```typescript
interface VMFirewallInitResult {
  success: boolean
  ruleSetCreated: boolean
  departmentRulesInherited: number
  filterApplied: boolean
}
```

### Integration in CreateMachineService

**Location**: `app/utils/VirtManager/createMachineService.ts`

The `initializeVMFirewall()` private method:
- Called after `defineAndStartVM()` succeeds
- Logs errors but doesn't fail VM creation
- Allows manual firewall sync later if needed

```typescript
private async initializeVMFirewall(machineId: string): Promise<void> {
  try {
    const firewallService = new VMFirewallSyncService(this.prisma, this.libvirtUri)

    // Ensure department ruleset exists
    await firewallService.ensureDepartmentRuleSet(machine.department.id)

    // Initialize VM firewall
    const result = await firewallService.initializeVMFirewall(machineId)

    this.debug.log('info', `Firewall initialized: ${result.departmentRulesInherited} rules`)
  } catch (error) {
    // Log but don't fail VM creation
    this.debug.log('error', `Firewall init failed: ${error.message}`)
    this.debug.log('warn', 'Manual sync may be required')
  }
}
```

## Error Handling

### Graceful Degradation

If firewall initialization fails, the VM creation process **continues successfully**. This design choice ensures:

1. Users can create VMs even if firewall service is temporarily unavailable
2. Firewall can be manually synced later via GraphQL mutation
3. Critical VM creation workflow is not blocked by non-critical firewall issues

### Error Scenarios

| Scenario | Behavior | Recovery |
|----------|----------|----------|
| Department not found | Logs warning, skips init | Manual sync after dept assignment |
| Libvirt connection fails | Logs error, VM succeeds | Manual sync via `applyVMRules` mutation |
| RuleSet creation fails | Logs error, VM succeeds | Re-run `initializeVMFirewall` |
| Filter application fails | Logs error, VM succeeds | Manual sync via GraphQL |

## Manual Firewall Sync

If automatic initialization fails, administrators can manually sync firewall via GraphQL:

```graphql
mutation SyncVMFirewall {
  applyVMFirewallRules(vmId: "vm-abc123") {
    success
    filterName
    rulesApplied
  }
}
```

This mutation triggers the same `FirewallOrchestrationService.applyVMRules()` flow.

## Database Schema

### FirewallRuleSet

Each VM and Department has a `FirewallRuleSet`:

```prisma
model FirewallRuleSet {
  id             String       @id @default(uuid())
  name           String
  internalName   String       @unique  // "ibay-vm-{id}" or "ibay-dept-{id}"
  entityType     RuleSetType  // VM or DEPARTMENT
  entityId       String       @unique

  // Libvirt sync status
  libvirtUuid    String?
  lastSyncedAt   DateTime?

  rules          FirewallRule[]

  // Relations
  machine        Machine?     @relation(fields: [entityId])
  department     Department?  @relation(fields: [entityId])
}
```

### Naming Convention

- **Department RuleSet**: `ibay-dept-{first8charsOfId}`
- **VM RuleSet**: `ibay-vm-{first8charsOfId}`

This naming convention:
- Ensures uniqueness via entity ID
- Keeps filter names short for libvirt
- Indicates ownership (dept vs VM)

## Performance Considerations

### Initialization Timing

Firewall initialization adds **~500ms-1s** to VM creation time:
- RuleSet creation: ~50-100ms (database writes)
- nwfilter XML generation: ~100-200ms (template rendering)
- Libvirt filter definition: ~200-300ms (XML parsing + libvirt API)
- Interface update: ~200-400ms (VM XML reparse + redefine)

### Optimization Strategies

1. **Async execution**: Firewall init happens after VM is started (non-blocking)
2. **Connection pooling**: Reuses existing libvirt connection
3. **XML caching**: nwfilter templates are pre-compiled
4. **Batch operations**: Future enhancement for bulk VM creation

## Testing

### Unit Tests

**Location**: `tests/unit/services/firewall/VMFirewallSyncService.test.ts`

Tests cover:
- ✅ Successful initialization with department rules
- ✅ Skip ruleset creation if already exists
- ✅ Error handling for missing VM
- ✅ Error handling for missing department
- ✅ Graceful handling of department with no rules
- ✅ Orchestration service error propagation

### Integration Tests

**Recommended** (not yet implemented):
- End-to-end VM creation with firewall verification
- Verify filterref in actual VM XML
- Verify nwfilter exists in libvirt
- Test VM restart applies filter changes

## Troubleshooting

### VM created but no filterref in XML

**Check**:
1. Look for firewall init errors in logs: `grep "Firewall init failed" /var/log/infinibay.log`
2. Verify department has ruleset: Check `department.firewallRuleSet` in database
3. Manually trigger sync: Use `applyVMFirewallRules` mutation

**Resolution**:
```bash
# Check if filter exists in libvirt
virsh nwfilter-list | grep ibay-vm-

# If filter exists, manually add to VM
virsh edit <vm-name>
# Add: <filterref filter='ibay-vm-...'/>

# If filter doesn't exist, trigger GraphQL mutation
```

### Department has no rules

**Expected Behavior**: VM firewall still initializes, but with 0 inherited rules.

**Check**:
- Department should have empty `FirewallRuleSet` created
- VM can still have its own rules
- Future department rules will be inherited

## Future Enhancements

1. **Batch VM Creation**: Optimize firewall init for multiple VMs in one department
2. **Rule Templates**: Pre-defined rule templates for common scenarios (web server, database, etc.)
3. **Dynamic Updates**: Hot-reload filter changes without VM restart (libvirt 6.0+)
4. **Validation Hooks**: Pre-creation validation of firewall rules
5. **Audit Logging**: Track firewall changes for compliance

## See Also

- [Firewall Architecture Overview](./architecture-overview.md)
- [Network Filter System](./network-filter-system.md)
- [Implementation Patterns](./implementation-patterns.md)
- [Service Management API](./service-management-api.md)
