# Network Filter System

## 1. Overview

The Infinibay Network Filter System provides a comprehensive firewall solution that integrates with libvirt's nwfilter subsystem. It allows for hierarchical filter management at global, department, and VM levels.

## 2. Filter Hierarchy

The system implements a three-tier filter hierarchy:

```
┌─────────────────┐
│ Generic Filters │ (Base filters, reusable components)
└────────┬────────┘
         │
         │ Referenced by
         ▼
┌─────────────────┐
│ Department      │ (Department-specific policies)
│ Filters         │
└────────┬────────┘
         │
         │ Referenced by
         ▼
┌─────────────────┐
│ VM Filters      │ (VM-specific customizations)
└─────────────────┘
```

### 2.1 Filter Types

The system supports three primary filter types:

1. **Generic Filters** (`type = "generic"`):
   - General-purpose, reusable filter definitions
   - Used as building blocks for more complex filtering
   - Can be referenced by department and VM filters
   - Examples: basic-allow, basic-deny, allow-established

2. **Department Filters** (`type = "department"`):
   - Applied to all VMs within a department
   - Can reference generic filters
   - Provide consistent security policies across department VMs
   - Examples: dept-web-server, dept-development, dept-secure

3. **VM Filters** (`type = "vm"`):
   - Applied to individual VMs
   - Can reference generic filters
   - Allow for VM-specific customizations
   - Examples: vm-web-server, vm-database, vm-gateway

4. **Custom Filters**:
   - Special-purpose filters for specific scenarios
   - May not fit into the standard hierarchy
   - Examples: temporary-access, migration-filter

## 3. Filter References

Filters can reference other filters through the `FilterReference` model, creating a directed acyclic graph of filter dependencies:

```
Filter A ──────► Filter B ──────► Filter C
    │                                │
    └────────────────────────────────┘
```

This allows for:
- Reuse of common filter patterns
- Modular filter design
- Simplified management of complex rule sets

## 4. Rule Structure

Each filter contains one or more rules (`FWRule`) that define specific filtering behavior:

### 4.1 Rule Components

- **Action**: What to do with matching packets
  - `accept`: Allow the packet
  - `drop`: Silently discard the packet
  - `reject`: Discard and send an error response
  - `return`: Stop processing in this filter and return to caller
  - `continue`: Continue to next rule even if this one matches

- **Direction**: Traffic flow direction
  - `in`: Inbound traffic (to the VM)
  - `out`: Outbound traffic (from the VM)
  - `inout`: Both directions

- **Priority**: Processing order (lower numbers = higher priority)
  - Typical range: 100-900
  - Critical rules: 100-300
  - Standard rules: 400-600
  - Fallback rules: 700-900

- **Protocol**: Network protocol
  - `tcp`: TCP traffic
  - `udp`: UDP traffic
  - `icmp`: ICMP traffic
  - `all`: All protocols

- **Port Specifications**:
  - `srcPortStart/End`: Source port range
  - `dstPortStart/End`: Destination port range

- **State Tracking**:
  - `NEW`: New connection
  - `ESTABLISHED`: Established connection
  - `RELATED`: Related to an existing connection

### 4.2 Rule Examples

#### Basic Outbound Allow Rule:
```typescript
{
  action: 'accept',
  direction: 'out',
  priority: 500,
  protocol: 'tcp',
  dstPortStart: 80,
  dstPortEnd: 80,
  comment: 'Allow outbound HTTP'
}
```

#### Inbound Service with Established Connection:
```typescript
// Allow inbound connections
{
  action: 'accept',
  direction: 'in',
  priority: 500,
  protocol: 'tcp',
  dstPortStart: 22,
  dstPortEnd: 22,
  comment: 'Allow inbound SSH'
}

// Allow related outbound responses
{
  action: 'accept',
  direction: 'out',
  priority: 499,
  protocol: 'tcp',
  srcPortStart: 22,
  srcPortEnd: 22,
  state: { established: true, related: true },
  comment: 'Allow outbound traffic for SSH responses'
}
```

## 5. XML Generation

The NetworkFilterService translates database filter and rule definitions into libvirt XML format:

### 5.1 Filter XML Structure

```xml
<filter name='vm-filter-123' chain='ipv4'>
  <uuid>550e8400-e29b-41d4-a716-446655440000</uuid>
  
  <!-- Reference to another filter -->
  <filterref filter='generic-base-filter'/>
  
  <!-- TCP rule example -->
  <rule action='accept' direction='out' priority='500'>
    <tcp dstportstart='80' dstportend='80'/>
  </rule>
  
  <!-- Established connection rule -->
  <rule action='accept' direction='in' priority='499'>
    <tcp srcportstart='80' srcportend='80' state='established'/>
  </rule>
</filter>
```

### 5.2 XML Generation Process

1. Retrieve filter and its rules from database
2. Convert to intermediate object structure
3. Generate XML using xml2js Builder
4. Apply to libvirt via NwFilter.defineXml()

## 6. Synchronization and Updates

### 6.1 Filter Update Process

When a filter is updated:
1. The filter's `updatedAt` timestamp is updated
2. A cron job detects filters with `updatedAt` newer than `flushedAt`
3. Updated filters are regenerated and applied
4. The filter's `flushedAt` timestamp is updated

### 6.2 VM Filter Application

VM network interfaces reference filters by UUID:

```xml
<interface type='network'>
  <source network='default'/>
  <filterref filter='vm-filter-123'/>
</interface>
```

Filter changes take effect:
- Immediately for new connections
- Based on state tracking for existing connections

## 7. Best Practices

### 7.1 Rule Management

- Use descriptive comments for all rules
- Set appropriate priorities (lower numbers = higher priority)
- Include rules for established connections when creating inbound rules
- Use service IDs from `knownServices.ts` for consistency

### 7.2 Performance Optimization

- Minimize the number of rules per filter
- Use port ranges instead of individual ports where possible
- Properly structure filter inheritance to reduce duplication
- Use appropriate rule priorities to ensure correct processing order

### 7.3 Security Considerations

- Follow principle of least privilege
- Regularly audit enabled services
- Consider service risk levels when enabling services
- Use state tracking for established connections to enhance security

## 8. Common Patterns

### 8.1 Basic VM Security Filter

```typescript
// Allow all outbound
await networkFilterService.createRule(
  filterId,
  'accept',
  'out',
  900,
  'all'
);

// Allow established inbound
await networkFilterService.createRule(
  filterId,
  'accept',
  'in',
  800,
  'all',
  undefined,
  { state: { established: true, related: true } }
);

// Drop everything else
await networkFilterService.createRule(
  filterId,
  'drop',
  'inout',
  999,
  'all'
);
```

### 8.2 Service-Specific Rules

See the [Service Management API](./service-management-api.md) documentation for service-specific rule patterns.
