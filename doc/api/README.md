# GraphQL API Documentation

This document provides comprehensive documentation for the Infinibay GraphQL API, including schema overview, resolvers, authentication, and usage examples.

## Table of Contents

- [API Overview](#api-overview)
- [Authentication & Authorization](#authentication--authorization)
- [Schema Structure](#schema-structure)
- [Query Operations](#query-operations)
- [Mutation Operations](#mutation-operations)
- [Real-time Subscriptions](#real-time-subscriptions)
- [Error Handling](#error-handling)
- [Usage Examples](#usage-examples)

## API Overview

The Infinibay GraphQL API provides a type-safe, efficient interface for managing virtualization infrastructure. Built with Apollo Server and TypeGraphQL, it offers:

- **Type Safety**: Full TypeScript integration with automatic schema generation
- **Real-time Updates**: WebSocket integration for live data
- **Role-based Access**: Admin and user permission levels
- **Efficient Queries**: Resolver-level data optimization
- **Comprehensive Coverage**: Complete VM lifecycle management

### Endpoint Information
- **GraphQL Endpoint**: `http://localhost:4000/graphql`
- **GraphQL Playground**: Available in development mode
- **WebSocket Endpoint**: `ws://localhost:4000/graphql` (for subscriptions)

## Authentication & Authorization

### Authentication
The API uses JWT (JSON Web Token) based authentication:

```typescript
// Example JWT payload
{
  userId: "uuid-string",
  userRole: "ADMIN" | "USER",
  iat: 1234567890,
  exp: 1234567890
}
```

### Authorization Levels
- **Public**: No authentication required (login, health checks)
- **@Authorized('USER')**: Requires valid user token
- **@Authorized('ADMIN')**: Requires admin privileges

### Headers
```http
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

## Schema Structure

### Core Types

#### Machine
Represents a virtual machine with full configuration:

```graphql
type Machine {
  id: ID!
  name: String!
  status: String!
  cpuCores: Int
  ramGB: Int
  gpuPciAddress: String
  createdAt: DateTimeISO
  
  # Relations
  user: UserType
  template: MachineTemplateType
  department: DepartmentType
  configuration: JSONObject
}
```

#### User
System user with role-based permissions:

```graphql
type UserType {
  id: ID!
  email: String!
  firstName: String!
  lastName: String!
  role: String!
  createdAt: DateTimeISO!
}
```

#### Department
Organizational unit for VM grouping:

```graphql
type DepartmentType {
  id: ID!
  name: String!
  internetSpeed: Int
  ipSubnet: String
  totalMachines: Float
  createdAt: DateTimeISO!
}
```

## Query Operations

### Machine Queries

#### Get Single Machine
```graphql
query GetMachine($id: String!) {
  machine(id: $id) {
    id
    name
    status
    cpuCores
    ramGB
    user {
      id
      firstName
      lastName
    }
    template {
      id
      name
      cores
      ram
      storage
    }
    department {
      id
      name
    }
  }
}
```

#### List Machines with Filtering
```graphql
query GetMachines(
  $pagination: PaginationInputType
  $orderBy: MachineOrderBy
) {
  machines(pagination: $pagination, orderBy: $orderBy) {
    id
    name
    status
    createdAt
    user {
      firstName
      lastName
    }
  }
}
```

### User Management Queries

#### Get Current User
```graphql
query CurrentUser {
  currentUser {
    id
    email
    firstName
    lastName
    role
  }
}
```

#### List Users (Admin Only)
```graphql
query GetUsers(
  $pagination: PaginationInputType
  $orderBy: UserOrderByInputType
) {
  users(pagination: $pagination, orderBy: $orderBy) {
    id
    email
    firstName
    lastName
    role
    createdAt
  }
}
```

### Department Queries

#### Get Department with Machines
```graphql
query GetDepartment($id: String!) {
  department(id: $id) {
    id
    name
    internetSpeed
    ipSubnet
    totalMachines
    createdAt
  }
}
```

### Network Security Queries

#### List Network Filters
```graphql
query GetFilters($departmentId: ID, $vmId: ID) {
  listFilters(departmentId: $departmentId, vmId: $vmId) {
    id
    name
    description
    type
    rules {
      id
      action
      direction
      protocol
      priority
    }
  }
}
```

#### Service Status Overview
```graphql
query GetServiceStatus {
  getServiceStatusSummary {
    serviceId
    serviceName
    totalVms
    enabledVms
    runningVms
  }
}
```

## Mutation Operations

### Machine Management

#### Create Machine
```graphql
mutation CreateMachine($input: CreateMachineInputType!) {
  createMachine(input: $input) {
    id
    name
    status
    template {
      name
    }
    user {
      firstName
      lastName
    }
  }
}
```

Example input:
```typescript
{
  name: "Development Server",
  templateId: "template-uuid",
  departmentId: "dept-uuid",
  username: "admin",
  password: "secure-password",
  os: UBUNTU,
  applications: [
    {
      applicationId: "app-uuid",
      parameters: {}
    }
  ]
}
```

#### Update Machine Hardware
```graphql
mutation UpdateMachineHardware($input: UpdateMachineHardwareInput!) {
  updateMachineHardware(input: $input) {
    id
    cpuCores
    ramGB
    gpuPciAddress
  }
}
```

#### Power Control Operations
```graphql
# Power On
mutation PowerOn($id: String!) {
  powerOn(id: $id) {
    success
    message
  }
}

# Power Off
mutation PowerOff($id: String!) {
  powerOff(id: $id) {
    success
    message
  }
}

# Suspend
mutation Suspend($id: String!) {
  suspend(id: $id) {
    success
    message
  }
}
```

#### Move Machine Between Departments
```graphql
mutation MoveMachine($id: String!, $departmentId: String!) {
  moveMachine(id: $id, departmentId: $departmentId) {
    id
    name
    department {
      id
      name
    }
  }
}
```

### User Management

#### Create User (Admin Only)
```graphql
mutation CreateUser($input: CreateUserInputType!) {
  createUser(input: $input) {
    id
    email
    firstName
    lastName
    role
    createdAt
  }
}
```

#### Update User
```graphql
mutation UpdateUser($id: String!, $input: UpdateUserInputType!) {
  updateUser(id: $id, input: $input) {
    id
    firstName
    lastName
    role
  }
}
```

### Security Management

#### Create Network Filter
```graphql
mutation CreateFilter($input: CreateFilterInput!) {
  createFilter(input: $input) {
    id
    name
    description
    type
  }
}
```

#### Add Firewall Rule
```graphql
mutation CreateFilterRule(
  $filterId: ID!
  $input: CreateFilterRuleInput!
) {
  createFilterRule(filterId: $filterId, input: $input) {
    id
    action
    direction
    protocol
    priority
    srcIpAddr
    dstIpAddr
  }
}
```

#### Toggle Service Access
```graphql
mutation ToggleVmService($input: ToggleVmServiceInput!) {
  toggleVmService(input: $input) {
    vmId
    serviceId
    serviceName
    useEnabled
    provideEnabled
    running
  }
}
```

## Real-time Subscriptions

While GraphQL subscriptions are supported, Infinibay primarily uses WebSocket events for real-time updates:

### WebSocket Events
Connected clients receive real-time events in the format:
```typescript
{
  eventName: 'namespace:resource:action',
  payload: {
    status: 'success' | 'error',
    data: any,
    error?: string,
    timestamp: string
  }
}
```

### Event Types
- **VM Events**: `user_*:vms:create`, `user_*:vms:update`, `user_*:vms:power_on`
- **User Events**: `admin:users:create`, `admin:users:update`
- **Department Events**: `admin:departments:create`, `admin:departments:update`
- **Metrics Events**: `vm:${vmId}:metricsUpdate`

## Error Handling

### Error Types

#### Authentication Errors
```json
{
  "errors": [
    {
      "message": "Authentication token required",
      "extensions": {
        "code": "UNAUTHENTICATED"
      }
    }
  ]
}
```

#### Authorization Errors
```json
{
  "errors": [
    {
      "message": "Insufficient permissions",
      "extensions": {
        "code": "FORBIDDEN"
      }
    }
  ]
}
```

#### Validation Errors
```json
{
  "errors": [
    {
      "message": "Invalid input data",
      "extensions": {
        "code": "BAD_USER_INPUT",
        "field": "email"
      }
    }
  ]
}
```

#### System Errors
```json
{
  "errors": [
    {
      "message": "Libvirt connection failed",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR"
      }
    }
  ]
}
```

## Usage Examples

### Complete Machine Creation Workflow

```typescript
// 1. Login to get JWT token
const loginResult = await client.mutate({
  mutation: gql`
    mutation Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
      }
    }
  `,
  variables: { email: 'admin@example.com', password: 'password' }
});

// 2. Set authorization header
const token = loginResult.data.login.token;
client.setHeader('Authorization', `Bearer ${token}`);

// 3. Get available templates
const templates = await client.query({
  query: gql`
    query GetTemplates {
      machineTemplates {
        id
        name
        cores
        ram
        storage
      }
    }
  `
});

// 4. Create new machine
const newMachine = await client.mutate({
  mutation: gql`
    mutation CreateMachine($input: CreateMachineInputType!) {
      createMachine(input: $input) {
        id
        name
        status
      }
    }
  `,
  variables: {
    input: {
      name: 'My Development Server',
      templateId: templates.data.machineTemplates[0].id,
      username: 'admin',
      password: 'secure-password',
      os: 'UBUNTU'
    }
  }
});

// 5. Power on the machine
await client.mutate({
  mutation: gql`
    mutation PowerOn($id: String!) {
      powerOn(id: $id) {
        success
        message
      }
    }
  `,
  variables: { id: newMachine.data.createMachine.id }
});
```

### Department Management Example

```typescript
// Create department
const department = await client.mutate({
  mutation: gql`
    mutation CreateDepartment($name: String!) {
      createDepartment(name: $name) {
        id
        name
      }
    }
  `,
  variables: { name: 'Engineering' }
});

// Configure department services
await client.mutate({
  mutation: gql`
    mutation ToggleDepartmentService($input: ToggleDepartmentServiceInput!) {
      toggleDepartmentService(input: $input) {
        departmentId
        serviceId
        useEnabled
        provideEnabled
      }
    }
  `,
  variables: {
    input: {
      departmentId: department.data.createDepartment.id,
      serviceId: 'http',
      action: 'USE',
      enabled: true
    }
  }
});
```

This API documentation provides the foundation for integrating with Infinibay's virtualization management capabilities through a modern, type-safe GraphQL interface.