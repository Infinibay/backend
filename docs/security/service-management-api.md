# Service Management API Documentation

## 1. Overview

The Service Management API provides a comprehensive interface for enabling and disabling network services at the VM, department, and global levels. It supports hierarchical configuration inheritance and provides both outbound use and inbound provide service modes.

## 2. GraphQL Schema

### 2.1 Types

#### ServiceDefinition

Represents a known network service.

```graphql
type ServiceDefinition {
  id: String!
  name: String!
  displayName: String!
  description: String!
  ports: [ServicePort!]!
  riskLevel: String!
  riskDescription: String!
}

type ServicePort {
  protocol: String!
  portStart: Int!
  portEnd: Int!
}
```

#### VmServiceStatus

Represents the status of a service for a specific VM.

```graphql
type VmServiceStatus {
  vmId: String!
  vmName: String!
  serviceId: String!
  serviceName: String!
  useEnabled: Boolean!
  provideEnabled: Boolean!
  running: Boolean!
}
```

#### DepartmentServiceStatus

Represents the status of a service for a department.

```graphql
type DepartmentServiceStatus {
  departmentId: String!
  departmentName: String!
  serviceId: String!
  serviceName: String!
  useEnabled: Boolean!
  provideEnabled: Boolean!
  vmCount: Int!
  enabledVmCount: Int!
}
```

#### DepartmentServiceDetailedStats

Provides detailed statistics about a service within a department.

```graphql
type DepartmentServiceDetailedStats {
  departmentId: String!
  departmentName: String!
  serviceId: String!
  serviceName: String!
  useEnabled: Boolean!
  provideEnabled: Boolean!
  vmCount: Int!
  enabledVmCount: Int!
  runningVmCount: Int!
  vms: [DepartmentServiceVmStats!]!
}

type DepartmentServiceVmStats {
  vmId: String!
  vmName: String!
  useEnabled: Boolean!
  provideEnabled: Boolean!
  running: Boolean!
  inheritedFromDepartment: Boolean!
}
```

#### GlobalServiceStatus

Represents the global default status for a service.

```graphql
type GlobalServiceStatus {
  serviceId: String!
  serviceName: String!
  useEnabled: Boolean!
  provideEnabled: Boolean!
}
```

### 2.2 Input Types

```graphql
input ToggleServiceInput {
  serviceId: String!
  action: ServiceAction!
  enabled: Boolean!
}

input ToggleVmServiceInput {
  vmId: String!
  serviceId: String!
  action: ServiceAction!
  enabled: Boolean!
}

input ToggleDepartmentServiceInput {
  departmentId: String!
  serviceId: String!
  action: ServiceAction!
  enabled: Boolean!
}

input ToggleGlobalServiceInput {
  serviceId: String!
  action: ServiceAction!
  enabled: Boolean!
}

enum ServiceAction {
  USE
  PROVIDE
}
```

### 2.3 Queries

#### List Services

Retrieves all known service definitions.

```graphql
query ListServices {
  listServices {
    id
    name
    displayName
    description
    ports {
      protocol
      portStart
      portEnd
    }
    riskLevel
    riskDescription
  }
}
```

#### Get VM Service Status

Retrieves the status of services for a specific VM.

```graphql
query GetVmServiceStatus($vmId: ID!, $serviceId: ID) {
  getVmServiceStatus(vmId: $vmId, serviceId: $serviceId) {
    vmId
    vmName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

#### Get Department Service Status

Retrieves the status of services for a specific department.

```graphql
query GetDepartmentServiceStatus($departmentId: ID!, $serviceId: ID) {
  getDepartmentServiceStatus(departmentId: $departmentId, serviceId: $serviceId) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
  }
}
```

#### Get Department Service Detailed Stats

Retrieves detailed statistics about services within a department.

```graphql
query GetDepartmentServiceDetailedStats($departmentId: ID!, $serviceId: ID) {
  getDepartmentServiceDetailedStats(departmentId: $departmentId, serviceId: $serviceId) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
    runningVmCount
    vms {
      vmId
      vmName
      useEnabled
      provideEnabled
      running
      inheritedFromDepartment
    }
  }
}
```

#### Get Global Service Status

Retrieves the global default status for services.

```graphql
query GetGlobalServiceStatus($serviceId: ID) {
  getGlobalServiceStatus(serviceId: $serviceId) {
    serviceId
    serviceName
    useEnabled
    provideEnabled
  }
}
```

### 2.4 Mutations

#### Toggle VM Service

Enables or disables a service for a specific VM.

```graphql
mutation ToggleVmService($input: ToggleVmServiceInput!) {
  toggleVmService(input: $input) {
    vmId
    vmName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

Example:
```graphql
mutation {
  toggleVmService(input: {
    vmId: "vm-123",
    serviceId: "http",
    action: USE,
    enabled: true
  }) {
    vmId
    vmName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

#### Toggle Department Service

Enables or disables a service for a department.

```graphql
mutation ToggleDepartmentService($input: ToggleDepartmentServiceInput!) {
  toggleDepartmentService(input: $input) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
  }
}
```

Example:
```graphql
mutation {
  toggleDepartmentService(input: {
    departmentId: "dept-456",
    serviceId: "http",
    action: PROVIDE,
    enabled: true
  }) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
  }
}
```

#### Toggle Global Service

Sets the global default for a service.

```graphql
mutation ToggleGlobalService($input: ToggleGlobalServiceInput!) {
  toggleGlobalService(input: $input) {
    serviceId
    serviceName
    useEnabled
    provideEnabled
  }
}
```

Example:
```graphql
mutation {
  toggleGlobalService(input: {
    serviceId: "http",
    action: USE,
    enabled: true
  }) {
    serviceId
    serviceName
    useEnabled
    provideEnabled
  }
}
```

#### Clear VM Service Overrides

Removes VM-specific service configurations, reverting to department defaults.

```graphql
mutation ClearVmServiceOverrides($vmId: ID!, $serviceId: ID) {
  clearVmServiceOverrides(vmId: $vmId, serviceId: $serviceId) {
    vmId
    vmName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

#### Apply Service To All Department VMs

Applies a service setting to all VMs in a department.

```graphql
mutation ApplyServiceToAllDepartmentVms($input: ToggleDepartmentServiceInput!) {
  applyServiceToAllDepartmentVms(input: $input) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
  }
}
```

#### Reset VM Service Overrides To Department

Resets VM-specific overrides to department defaults for selected VMs.

```graphql
mutation ResetVmServiceOverridesToDepartment(
  $departmentId: ID!,
  $serviceId: ID!,
  $vmIds: [ID!]!
) {
  resetVmServiceOverridesToDepartment(
    departmentId: $departmentId,
    serviceId: $serviceId,
    vmIds: $vmIds
  ) {
    departmentId
    serviceId
    resetVmCount
    successfulResets {
      vmId
      vmName
    }
    failedResets {
      vmId
      error
    }
  }
}
```

## 3. Service Configuration Inheritance

The service configuration follows a hierarchical inheritance model:

```
Global Settings
      ↓
Department Settings
      ↓
   VM Settings
```

For both `useEnabled` and `provideEnabled` settings:

1. If a VM-specific configuration exists, it is used
2. Otherwise, if a department configuration exists, it is used
3. Otherwise, the global default is used

This inheritance is applied automatically by the FirewallService when retrieving service status.

## 4. Implementation Details

### 4.1 FirewallService

The FirewallService class implements the core functionality for service management:

```typescript
export class FirewallService {
  constructor(private prisma: PrismaClient) {
    this.networkFilterService = new NetworkFilterService(prisma);
  }

  // Service listing
  async getServices(): Promise<ServiceDefinition[]>

  // VM service management
  async getVmServiceStatus(vmId: string, serviceId?: string): Promise<VmServiceStatus[]>
  async toggleVmService(vmId: string, serviceId: string, action: 'use' | 'provide', enabled: boolean): Promise<VmServiceStatus>
  async clearVmServiceOverrides(vmId: string, serviceId?: string): Promise<VmServiceStatus[]>

  // Department service management
  async getDepartmentServiceStatus(departmentId: string, serviceId?: string): Promise<DepartmentServiceStatus[]>
  async toggleDepartmentService(departmentId: string, serviceId: string, action: 'use' | 'provide', enabled: boolean): Promise<DepartmentServiceStatus>
  async getDepartmentServiceDetailedStats(departmentId: string, serviceId?: string): Promise<DepartmentServiceDetailedStats[]>
  async applyServiceToAllDepartmentVms(departmentId: string, serviceId: string, action: 'use' | 'provide', enabled: boolean): Promise<DepartmentServiceStatus>
  async resetVmServiceOverridesToDepartment(departmentId: string, serviceId: string, vmIds: string[]): Promise<ResetResult>

  // Global service management
  async getGlobalServiceStatus(serviceId?: string): Promise<GlobalServiceStatus[]>
  async toggleGlobalService(serviceId: string, action: 'use' | 'provide', enabled: boolean): Promise<GlobalServiceStatus>

  // Rule management
  private async applyServiceRules(filterId: string, service: ServiceDefinition, action: 'use' | 'provide', enabled: boolean): Promise<void>
  private async updateVmPortRecords(vmId: string, service: ServiceDefinition, enabled: boolean): Promise<void>
}
```

### 4.2 Rule Generation

When a service is enabled, the FirewallService generates appropriate firewall rules:

#### For 'use' mode (outbound):

```typescript
// Allow outbound to the service port
await this.networkFilterService.createRule(
  filterId,
  'accept',
  'out',
  500, // Priority
  port.protocol,
  undefined, // No simple port, use range
  {
    dstPortStart: port.portStart,
    dstPortEnd: port.portEnd,
    comment: `Allow using ${service.displayName} service`
  }
);
```

#### For 'provide' mode (inbound):

```typescript
// Allow inbound to the service port
await this.networkFilterService.createRule(
  filterId,
  'accept',
  'in',
  500, // Priority
  port.protocol,
  undefined, // No simple port, use range
  {
    dstPortStart: port.portStart,
    dstPortEnd: port.portEnd,
    comment: `Allow providing ${service.displayName} service`
  }
);

// Allow established outbound for responses
await this.networkFilterService.createRule(
  filterId,
  'accept',
  'out',
  499, // Higher priority
  port.protocol,
  undefined,
  {
    srcPortStart: port.portStart,
    srcPortEnd: port.portEnd,
    comment: `Allow outbound traffic for ${service.displayName} service`,
    state: { established: true, related: true }
  }
);
```

## 5. Error Handling

The API implements consistent error handling:

### 5.1 Common Error Types

- **Not Found Errors**: When a VM, department, or service doesn't exist
- **Permission Errors**: When the user doesn't have permission to modify a service
- **Validation Errors**: When input parameters are invalid
- **Filter Errors**: When there's an issue with the network filter

### 5.2 Error Response Format

```json
{
  "errors": [
    {
      "message": "Error message",
      "path": ["toggleVmService"],
      "extensions": {
        "code": "NOT_FOUND",
        "exception": {
          "stacktrace": [...]
        }
      }
    }
  ],
  "data": null
}
```

## 6. Best Practices

### 6.1 Service Management

- Always check service status before enabling/disabling
- Consider service risk levels when enabling services
- Use department-level configuration for consistent policies
- Only override at VM level when necessary

### 6.2 Query Optimization

- Request only the fields you need
- Use serviceId parameter to filter when working with a specific service
- Batch related operations to minimize API calls

### 6.3 Error Handling

- Implement proper error handling on the client side
- Check for failed operations in batch responses
- Provide user-friendly error messages

## 7. Example Use Cases

### 7.1 Enabling SSH for a VM

```graphql
mutation {
  toggleVmService(input: {
    vmId: "vm-123",
    serviceId: "ssh",
    action: PROVIDE,
    enabled: true
  }) {
    vmId
    vmName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

### 7.2 Configuring Web Server Department

```graphql
mutation {
  toggleDepartmentService(input: {
    departmentId: "dept-456",
    serviceId: "http",
    action: PROVIDE,
    enabled: true
  }) {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
  }
}
```

### 7.3 Checking Service Status

```graphql
query {
  getDepartmentServiceDetailedStats(departmentId: "dept-456", serviceId: "http") {
    departmentId
    departmentName
    serviceId
    serviceName
    useEnabled
    provideEnabled
    vmCount
    enabledVmCount
    runningVmCount
    vms {
      vmId
      vmName
      useEnabled
      provideEnabled
      running
      inheritedFromDepartment
    }
  }
}
```
