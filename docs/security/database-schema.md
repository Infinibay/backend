# Database Schema for Security Services

This document describes the database schema related to the security service implementation, including network filters, firewall rules, and service configurations.

## 1. Network Filter Models

### 1.1 NWFilter

The core model for network filter definitions:

```prisma
model NWFilter {
  id            String   @id @default(uuid())
  name          String   @unique
  internalName  String   @unique
  uuid          String   @unique
  description   String?
  chain         String?  // ipv4, arp, etc.
  type          String   @default("generic") // generic, department, vm
  priority      Int      @default(500)
  stateMatch    Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  flushedAt     DateTime?
  rules         FWRule[]
  departments   DepartmentNWFilter[]
  vms           VMNWFilter[]
  
  // Self-referential many-to-many relationship for filter references
  referencedBy    FilterReference[] @relation("ReferencingFilters")
  references      FilterReference[] @relation("ReferencedFilters")
}
```

Key fields:
- `id`: Unique identifier
- `name`: Human-readable name
- `internalName`: Name used within the system
- `uuid`: UUID used by libvirt
- `type`: Filter type (generic, department, vm)
- `priority`: Processing priority (lower = higher priority)
- `stateMatch`: Whether to use state matching

### 1.2 FWRule

Individual firewall rules within a filter:

```prisma
model FWRule {
  id          String    @id @default(uuid())
  nwFilter    NWFilter  @relation(fields: [nwFilterId], references: [id], onDelete: Cascade)
  nwFilterId  String
  action      String    @default("accept") // accept, reject, drop, return, continue
  direction   String    @default("inout")  // in, out, inout
  priority    Int
  protocol    String    @default("all")    // tcp, udp, icmp, arp, ipv4, ipv6, all
  ipVersion   String?   // ipv4, ipv6
  srcMacAddr  String?   // MAC address format
  srcIpAddr   String?   // IP address format
  srcIpMask   String?   // IP mask format
  dstIpAddr   String?   // IP address format
  dstIpMask   String?   // IP mask format
  srcPortStart Int?     // 0-65535
  srcPortEnd   Int?     // 0-65535
  dstPortStart Int?     // 0-65535
  dstPortEnd   Int?     // 0-65535
  state       Json?     // NEW, ESTABLISHED, RELATED, etc.
  comment     String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

Key fields:
- `action`: Rule action (accept, reject, drop, etc.)
- `direction`: Traffic direction (in, out, inout)
- `priority`: Rule processing priority
- `protocol`: Network protocol
- `srcPortStart/End`: Source port range
- `dstPortStart/End`: Destination port range
- `state`: Connection state tracking

### 1.3 FilterReference

Links between filters for reference/inheritance:

```prisma
model FilterReference {
  id              String   @id @default(uuid())
  sourceFilter    NWFilter @relation("ReferencingFilters", fields: [sourceFilterId], references: [id], onDelete: Cascade)
  sourceFilterId  String
  targetFilter    NWFilter @relation("ReferencedFilters", fields: [targetFilterId], references: [id], onDelete: Cascade)
  targetFilterId  String
  createdAt      DateTime @default(now())

  @@unique([sourceFilterId, targetFilterId])
}
```

This model creates a many-to-many self-referential relationship for NWFilter, allowing filters to reference other filters.

### 1.4 DepartmentNWFilter

Maps departments to network filters:

```prisma
model DepartmentNWFilter {
  id           String     @id @default(uuid())
  department   Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  departmentId String
  nwFilter     NWFilter   @relation(fields: [nwFilterId], references: [id], onDelete: Cascade)
  nwFilterId   String
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@unique([departmentId, nwFilterId])
}
```

### 1.5 VMNWFilter

Maps VMs to network filters:

```prisma
model VMNWFilter {
  id           String     @id @default(uuid())
  vm           Machine    @relation(fields: [vmId], references: [id], onDelete: Cascade)
  vmId         String
  nwFilter     NWFilter   @relation(fields: [nwFilterId], references: [id], onDelete: Cascade)
  nwFilterId   String
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@unique([vmId, nwFilterId])
}
```

## 2. Service Configuration Models

### 2.1 VmPort

Tracks ports on VMs for service monitoring:

```prisma
model VmPort {
  id          String    @id @default(uuid())
  portStart   Int       // Start of port range
  portEnd     Int       // End of port range (same as portStart for single port)
  protocol    String    // tcp or udp
  running     Boolean   // if the port is currently in use
  enabled     Boolean   // if firewall allows inbound connections
  toEnable    Boolean   // if it will be enabled in next firewall update
  vmId        String
  vm          Machine   @relation(fields: [vmId], references: [id])
  lastSeen    DateTime  @default(now())
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@unique([vmId, portStart, protocol])
}
```

Key fields:
- `portStart/End`: Port range
- `protocol`: Network protocol
- `running`: Whether the port is currently in use
- `enabled`: Whether inbound connections are allowed
- `toEnable`: Whether it will be enabled in the next update

### 2.2 DepartmentServiceConfig

Department-level service configurations:

```prisma
model DepartmentServiceConfig {
  id             String     @id @default(uuid())
  department     Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  departmentId   String
  serviceId      String     // Reference to a known service
  useEnabled     Boolean    @default(false)  // Can VMs in department use this service
  provideEnabled Boolean    @default(false)  // Can VMs in department provide this service
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  
  @@unique([departmentId, serviceId])
}
```

### 2.3 VMServiceConfig

VM-level service configurations:

```prisma
model VMServiceConfig {
  id             String     @id @default(uuid())
  vm             Machine    @relation(fields: [vmId], references: [id], onDelete: Cascade)
  vmId           String
  serviceId      String     // Reference to a known service
  useEnabled     Boolean    @default(false)  // Can this VM use this service
  provideEnabled Boolean    @default(false)  // Can this VM provide this service
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  
  @@unique([vmId, serviceId])
}
```

### 2.4 GlobalServiceConfig

Global default service configurations:

```prisma
model GlobalServiceConfig {
  id             String     @id @default(uuid())
  serviceId      String     @unique // Reference to a known service
  useEnabled     Boolean    @default(true)   // Global default for using this service
  provideEnabled Boolean    @default(false)  // Global default for providing this service
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}
```

## 3. Entity Relationships

### 3.1 Service Configuration Hierarchy

```
GlobalServiceConfig
       ↑
       | (inherited by)
       |
DepartmentServiceConfig
       ↑
       | (inherited by)
       |
  VMServiceConfig
```

### 3.2 Filter Hierarchy

```
Generic Filters
       ↑
       | (referenced by)
       |
Department Filters
       ↑
       | (referenced by)
       |
    VM Filters
```

### 3.3 Service-to-Filter Relationship

Service configurations (Global/Department/VM) determine which firewall rules are created in the corresponding filters. The relationship is managed programmatically by the FirewallService.
