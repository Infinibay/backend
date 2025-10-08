# Infinibay Firewall System

## Overview

The Infinibay firewall system provides a hierarchical, 2-level firewall management solution for virtual machines. It leverages libvirt's nwfilter system to apply network filtering rules at the hypervisor level.

## Architecture

### Components

1. **FirewallRuleService** - CRUD operations for firewall rules and rule sets
2. **FirewallValidationService** - Validates rules for conflicts, overlaps, and inconsistencies
3. **NWFilterXMLGeneratorService** - Generates libvirt nwfilter XML from rule definitions
4. **LibvirtNWFilterService** - Interacts with libvirt to define/undefine filters
5. **FirewallOrchestrationService** - Main coordinator that ties all services together
6. **FirewallEventManager** - Handles real-time WebSocket events for firewall rule changes

### Hierarchy

```
Department Rules (Priority: 500 by default)
    ↓
VM Rules (Priority: varies)
    ↓
Effective Rules (merged, sorted by priority)
    ↓
libvirt nwfilter XML
    ↓
iptables/ebtables (applied to VM network interface)
```

## Data Model

### FirewallRuleSet

Represents a collection of firewall rules for either a department or a VM.

**Fields:**
- `id` - Unique identifier
- `name` - Human-readable name
- `internalName` - Libvirt filter name (format: `ibay-{type}-{hash}`)
- `entityType` - DEPARTMENT or VM
- `entityId` - ID of the associated department or VM
- `priority` - Default priority for rules in this set (lower = higher priority)
- `isActive` - Whether the rule set is active
- `libvirtUuid` - UUID of the filter in libvirt
- `xmlContent` - Cached XML content
- `lastSyncedAt` - Last time synced to libvirt

### FirewallRule

Represents an individual firewall rule.

**Fields:**
- `id` - Unique identifier
- `ruleSetId` - Parent rule set
- `name` - Human-readable name
- `description` - Optional description
- `action` - ACCEPT, DROP, or REJECT
- `direction` - IN, OUT, or INOUT
- `priority` - Rule priority (lower = higher priority)
- `protocol` - tcp, udp, icmp, or all
- `srcPortStart/srcPortEnd` - Source port range
- `dstPortStart/dstPortEnd` - Destination port range
- `srcIpAddr/srcIpMask` - Source IP address and mask
- `dstIpAddr/dstIpMask` - Destination IP address and mask
- `connectionState` - JSON object for stateful tracking (e.g., `{established: true, related: true}`)
- `overridesDept` - If true, this VM rule overrides matching department rules

## Rule Hierarchy and Override Behavior

### Department Rules

- Applied to all VMs in the department
- Lower priority by default (500)
- Cannot be overridden unless explicitly flagged

### VM Rules

- Applied only to the specific VM
- Can override department rules by setting `overridesDept: true`
- Must target the same traffic pattern to override

### Effective Rules Calculation

1. Get all department rules for the VM's department
2. Get all VM rules for the VM
3. Filter out department rules that are overridden by VM rules
4. Merge remaining department rules with VM rules
5. Sort by priority (ascending)

**Example:**

```
Department: Allow SSH (port 22) - Priority 500
VM: Block SSH (port 22, overridesDept: true) - Priority 100

Effective Rules:
  1. VM: Block SSH (priority 100) ← This takes precedence
  (Department SSH rule is filtered out)
```

## Naming Convention

All nwfilters created by Infinibay use the `ibay-` prefix:

- Department filters: `ibay-department-{hash}`
- VM filters: `ibay-vm-{hash}`

The hash is the first 8 characters of MD5(entityId), ensuring consistent naming.

**Why this matters:**
- Easy cleanup on uninstall (find all filters starting with `ibay-`)
- No conflicts with system or user-created filters
- Traceable back to Infinibay

## Validation

The system performs several validations before applying rules:

### Conflict Detection

**Contradictory Rules:**
- Same traffic pattern (protocol, ports, direction)
- Different actions (ACCEPT vs DROP)

**Port Overlaps:**
- Same protocol and direction
- Overlapping port ranges

**Duplicate Rules:**
- Identical configuration

### Priority Conflicts

Rules with the same priority that target the same traffic will be flagged.

## XML Generation

The system generates libvirt nwfilter XML following this structure:

```xml
<filter name="ibay-vm-abc12345" chain="root" priority="0">
  <uuid>generated-uuid</uuid>
  <rule action="accept" direction="in" priority="100">
    <tcp dstportstart="80" dstportend="80"/>
  </rule>
  <rule action="accept" direction="in" priority="200">
    <tcp dstportstart="443" dstportend="443"/>
  </rule>
</filter>
```

## GraphQL API

### Queries

```graphql
# Get department firewall rules
getDepartmentFirewallRules(departmentId: ID!): FirewallRuleSet

# Get VM firewall rules
getVMFirewallRules(vmId: ID!): FirewallRuleSet

# Get effective rules (merged dept + VM)
getEffectiveFirewallRules(vmId: ID!): EffectiveRuleSet!

# Validate rule before creating
validateFirewallRule(input: CreateFirewallRuleInput!): ValidationResult!

# List all Infinibay filters
listInfinibayFilters: [LibvirtFilterInfo!]!
```

### Mutations

```graphql
# Create department rule
createDepartmentFirewallRule(
  departmentId: ID!
  input: CreateFirewallRuleInput!
): FirewallRule!

# Create VM rule
createVMFirewallRule(
  vmId: ID!
  input: CreateFirewallRuleInput!
): FirewallRule!

# Update rule
updateFirewallRule(
  ruleId: ID!
  input: UpdateFirewallRuleInput!
): FirewallRule!

# Delete rule
deleteFirewallRule(ruleId: ID!): Boolean!

# Apply rules immediately
flushFirewallRules(vmId: ID!): FlushResult!

# Sync all rules to libvirt
syncFirewallToLibvirt: SyncResult!

# Cleanup on uninstall
cleanupInfinibayFirewall: CleanupResult!
```

## Usage Examples

### Creating a Department Rule

```graphql
mutation {
  createDepartmentFirewallRule(
    departmentId: "dept-123"
    input: {
      name: "Allow HTTPS"
      description: "Allow incoming HTTPS traffic"
      action: ACCEPT
      direction: IN
      priority: 100
      protocol: "tcp"
      dstPortStart: 443
      dstPortEnd: 443
    }
  ) {
    id
    name
    action
    priority
  }
}
```

### Creating a VM Override Rule

```graphql
mutation {
  createVMFirewallRule(
    vmId: "vm-456"
    input: {
      name: "Block SSH"
      description: "Override department rule to block SSH"
      action: DROP
      direction: IN
      priority: 50
      protocol: "tcp"
      dstPortStart: 22
      dstPortEnd: 22
      overridesDept: true  # This overrides department SSH rule
    }
  ) {
    id
    name
    overridesDept
  }
}
```

### Checking Effective Rules

```graphql
query {
  getEffectiveFirewallRules(vmId: "vm-456") {
    vmId
    departmentRules {
      id
      name
      priority
    }
    vmRules {
      id
      name
      priority
      overridesDept
    }
    effectiveRules {
      id
      name
      priority
      action
    }
    conflicts {
      type
      message
    }
  }
}
```

### Applying Rules Immediately

```graphql
mutation {
  flushFirewallRules(vmId: "vm-456") {
    success
    rulesApplied
    libvirtFilterName
    timestamp
  }
}
```

## Libvirt Integration

### Filter Application

When rules are applied:

1. Service calculates effective rules for the VM
2. Validates rules for conflicts
3. Generates nwfilter XML with `ibay-` prefix
4. Defines filter in libvirt using `NWFilter.defineXml()`
5. Updates VM domain XML to reference the filter
6. Filter is applied to VM network interface

### Dynamic Updates

- In libvirt >= 6.0, nwfilter changes apply dynamically to running VMs
- In libvirt < 6.0, VM restart may be required for changes to take effect

### Cleanup

On uninstall, the `cleanupInfinibayFirewall` mutation:

1. Lists all filters with `ibay-` prefix
2. Undefines each filter from libvirt
3. Returns list of removed filter names

## Testing

All services have comprehensive unit tests:

- `FirewallValidationService.test.ts` - Conflict detection, overlap validation
- `NWFilterXMLGeneratorService.test.ts` - XML generation, naming convention
- `LibvirtNWFilterService.test.ts` - Libvirt interaction (mocked)
- `FirewallRuleService.test.ts` - CRUD operations
- `FirewallOrchestrationService.test.ts` - End-to-end rule application

Run tests:

```bash
cd backend
npm test app/services/firewall
```

## Future Enhancements

- **Rule Templates**: Pre-defined rule sets for common scenarios (web server, database server, etc.)
- **Audit Logging**: Track all firewall rule changes with user attribution
- **Network Groups**: Group VMs across departments with shared firewall rules
- **Time-based Rules**: Rules that activate/deactivate based on schedule
- **Rate Limiting**: Integrate connection rate limiting
- **Geo-blocking**: Block traffic from specific countries/regions

## Troubleshooting

### Rules Not Applying

1. Check if rule set is active: `FirewallRuleSet.isActive`
2. Verify no validation conflicts
3. Check libvirt filter exists: `listInfinibayFilters`
4. Verify VM domain XML includes filterref

### Validation Errors

```graphql
query {
  validateFirewallRule(input: {
    # ... rule config
  }) {
    isValid
    conflicts {
      type
      message
      affectedRules { id name }
    }
    warnings
  }
}
```

### Cleanup Issues

If filters can't be removed, check if they're still referenced by running VMs:

```bash
virsh nwfilter-list
virsh domblklist <vm-name>
virsh dumpxml <vm-name> | grep filterref
```

## Performance Considerations

- Rules are cached in `FirewallRuleSet.xmlContent`
- Only regenerate XML when rules change
- Batch operations when applying department rules to multiple VMs
- Use priority ranges to avoid frequent re-sorting

## Security Considerations

- Validate all user inputs (port ranges, IP addresses)
- Prevent privilege escalation (users shouldn't override admin rules without permission)
- Audit all rule changes
- Default to deny (block) for safety
- Review effective rules before applying

## Real-Time Events

The firewall system emits WebSocket events when rules are created, updated, or deleted, enabling real-time UI updates without polling.

### Event Types

**Department Rules:**
- `firewall:rule:created:department` - When a department rule is created
- `firewall:rule:updated:department` - When a department rule is updated
- `firewall:rule:deleted:department` - When a department rule is deleted

**VM Rules:**
- `firewall:rule:created` - When a VM rule is created
- `firewall:rule:updated` - When a VM rule is updated
- `firewall:rule:deleted` - When a VM rule is deleted

### Event Payload Format

**Department Rule Events:**
```json
{
  "status": "success",
  "data": {
    "ruleId": "uuid",
    "ruleName": "Allow HTTPS",
    "departmentId": "dept-uuid"
  }
}
```

**VM Rule Events:**
```json
{
  "status": "success",
  "data": {
    "ruleId": "uuid",
    "ruleName": "Allow SSH",
    "vmId": "vm-uuid"
  }
}
```

### Event Recipients

**For Department Rules:**
- All admin users
- All users who own VMs in the affected department

**For VM Rules:**
- All admin users
- The owner of the affected VM

### Integration

Events are emitted by `FirewallEventManager` and dispatched through the central `EventManager`. The resolver mutations (`createDepartmentFirewallRule`, `createVMFirewallRule`, `updateFirewallRule`, `deleteFirewallRule`) automatically emit events after successful rule changes.

**Frontend Integration:**
The frontend listens to these events through the Redux real-time service and automatically refetches firewall data when changes are detected, eliminating the need for polling.
