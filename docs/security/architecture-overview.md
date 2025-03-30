# Security Service Architecture Overview

## 1. Core Components

The Infinibay security service implementation consists of several key components that work together to provide comprehensive network security and service management:

### 1.1 Service Definition System

Located in `/app/config/knownServices.ts`, this component:
- Defines all network services with their properties, ports, and risk levels
- Provides utility functions for service lookup and filtering
- Serves as the source of truth for service information throughout the application

### 1.2 Network Filter Management

Implemented in `/app/services/networkFilterService.ts`, this component:
- Provides low-level management of libvirt network filters
- Handles XML generation for filter definitions
- Manages filter and rule CRUD operations
- Interfaces directly with libvirt for filter application

### 1.3 Firewall Service

Implemented in `/app/services/firewallService.ts`, this component:
- Provides high-level service management functionality
- Implements hierarchical configuration inheritance
- Translates service configurations into firewall rules
- Manages service status tracking and reporting

### 1.4 GraphQL API Layer

Implemented in `/app/graphql/resolvers/security/resolver.ts`, this component:
- Exposes service management functionality through GraphQL
- Provides queries for service status and mutations for configuration
- Implements authorization checks for security operations

## 2. Hierarchical Configuration Model

The security service implementation uses a three-tier hierarchical configuration model:

```
┌─────────────────┐
│ Global Settings │
└────────┬────────┘
         │
         │ Inherited by (if not overridden)
         ▼
┌─────────────────┐
│ Department      │
│ Settings        │
└────────┬────────┘
         │
         │ Inherited by (if not overridden)
         ▼
┌─────────────────┐
│ VM Settings     │
└─────────────────┘
```

This hierarchy applies to both 'use' (outbound) and 'provide' (inbound) settings separately, allowing for fine-grained control at each level.

## 3. Service Configuration Flow

When a service configuration is changed, the following flow occurs:

1. **Configuration Update**:
   - Service configuration is stored in the appropriate model (Global/Department/VM)
   - Configuration includes both 'use' and 'provide' settings

2. **Rule Generation**:
   - FirewallService translates service configuration into firewall rules
   - Different rules are generated for 'use' vs 'provide' modes

3. **Filter Application**:
   - NetworkFilterService generates XML representation of rules
   - Rules are applied to the appropriate network filter
   - Filter's updatedAt timestamp triggers synchronization

4. **Port Record Management**:
   - VmPort records are created or updated for service visibility
   - Records track which ports should be enabled/monitored

## 4. Filter Types and Relationships

The system supports three types of filters:

1. **Generic Filters**:
   - Base filters that can be reused
   - Identified by type = "generic"
   - Can be referenced by other filters

2. **Department Filters**:
   - Department-specific filters
   - Identified by type = "department"
   - Can reference generic filters

3. **VM Filters**:
   - VM-specific filters
   - Identified by type = "vm"
   - Can reference generic filters

## 5. Service Enablement Modes

The system supports two service enablement modes:

1. **Use Mode** (Outbound):
   - Allows VMs to connect to this service on other systems
   - Controlled by `useEnabled` boolean in service config
   - Creates outbound firewall rules

2. **Provide Mode** (Inbound):
   - Allows VMs to accept connections for this service
   - Controlled by `provideEnabled` boolean in service config
   - Creates inbound firewall rules and outbound rules for established connections

## 6. Integration Points

The security service implementation integrates with several other Infinibay components:

- **VM Management**: For VM-level service configuration
- **Department Management**: For department-level service configuration
- **Network Management**: For network filter application
- **GraphQL API**: For exposing service management functionality
- **UI Layer**: For visualizing and configuring service settings
