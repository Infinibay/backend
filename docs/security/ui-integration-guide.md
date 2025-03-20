# UI Integration Guide

This guide provides information on integrating the security service features into the Infinibay user interface.

## 1. Service Management UI Components

### 1.1 Service List Component

Displays available services with their status and risk levels.

```typescript
// Example React component for service listing
const ServiceList = () => {
  const { loading, error, data } = useQuery(LIST_SERVICES_QUERY);
  
  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error.message} />;
  
  return (
    <div className="service-list">
      <h2>Available Services</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Description</th>
            <th>Risk Level</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.listServices.map(service => (
            <tr key={service.id}>
              <td>{service.displayName}</td>
              <td>{service.description}</td>
              <td>
                <RiskBadge level={service.riskLevel} />
              </td>
              <td>
                <ServiceActions serviceId={service.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

### 1.2 VM Service Configuration Component

Allows configuring services for a specific VM.

```typescript
// Example React component for VM service configuration
const VmServiceConfig = ({ vmId }) => {
  const { loading, error, data } = useQuery(GET_VM_SERVICE_STATUS_QUERY, {
    variables: { vmId }
  });
  
  const [toggleService] = useMutation(TOGGLE_VM_SERVICE_MUTATION);
  
  const handleToggle = (serviceId, action, enabled) => {
    toggleService({
      variables: {
        input: {
          vmId,
          serviceId,
          action,
          enabled
        }
      }
    });
  };
  
  // Render component...
};
```

### 1.3 Department Service Configuration Component

Allows configuring services for a department.

```typescript
// Example React component for department service configuration
const DepartmentServiceConfig = ({ departmentId }) => {
  const { loading, error, data } = useQuery(GET_DEPARTMENT_SERVICE_STATUS_QUERY, {
    variables: { departmentId }
  });
  
  const [toggleService] = useMutation(TOGGLE_DEPARTMENT_SERVICE_MUTATION);
  
  // Render component...
};
```

## 2. GraphQL Queries and Mutations

### 2.1 Service Listing Query

```typescript
const LIST_SERVICES_QUERY = gql`
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
`;
```

### 2.2 VM Service Status Query

```typescript
const GET_VM_SERVICE_STATUS_QUERY = gql`
  query GetVmServiceStatus($vmId: ID!) {
    getVmServiceStatus(vmId: $vmId) {
      vmId
      vmName
      serviceId
      serviceName
      useEnabled
      provideEnabled
      running
    }
  }
`;
```

### 2.3 Toggle VM Service Mutation

```typescript
const TOGGLE_VM_SERVICE_MUTATION = gql`
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
`;
```

## 3. UI Design Patterns

### 3.1 Service Status Indicators

Use consistent visual indicators for service status:

- **Enabled**: Green checkmark or toggle switch
- **Disabled**: Gray X or toggle switch
- **Running**: Pulsing green dot
- **Not Running**: Empty circle
- **Inherited**: Icon indicating inheritance from department

```tsx
const ServiceStatusIndicator = ({ enabled, running, inherited }) => {
  return (
    <div className="status-indicator">
      <div className={`enabled-status ${enabled ? 'enabled' : 'disabled'}`}>
        {enabled ? 'Enabled' : 'Disabled'}
        {inherited && <InheritedIcon title="Inherited from department" />}
      </div>
      <div className={`running-status ${running ? 'running' : 'not-running'}`}>
        {running ? 'Running' : 'Not Running'}
      </div>
    </div>
  );
};
```

### 3.2 Risk Level Visualization

Display service risk levels with appropriate colors and icons:

```tsx
const RiskBadge = ({ level }) => {
  const getColorClass = () => {
    switch (level) {
      case 'LOW': return 'risk-low';
      case 'MEDIUM': return 'risk-medium';
      case 'HIGH': return 'risk-high';
      default: return 'risk-unknown';
    }
  };
  
  return (
    <span className={`risk-badge ${getColorClass()}`}>
      {level}
    </span>
  );
};
```

### 3.3 Service Configuration Forms

Use consistent form patterns for service configuration:

```tsx
const ServiceConfigForm = ({ service, onSave }) => {
  const [useEnabled, setUseEnabled] = useState(service.useEnabled);
  const [provideEnabled, setProvideEnabled] = useState(service.provideEnabled);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      serviceId: service.serviceId,
      useEnabled,
      provideEnabled
    });
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={useEnabled}
            onChange={(e) => setUseEnabled(e.target.checked)}
          />
          Allow outbound connections (Use)
        </label>
      </div>
      
      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={provideEnabled}
            onChange={(e) => setProvideEnabled(e.target.checked)}
          />
          Allow inbound connections (Provide)
        </label>
      </div>
      
      {service.riskLevel === 'HIGH' && (
        <div className="risk-warning">
          This service has a HIGH risk level. Enable with caution.
        </div>
      )}
      
      <button type="submit">Save Changes</button>
    </form>
  );
};
```

## 4. Service Management Workflows

### 4.1 VM Service Configuration Workflow

1. User navigates to VM details page
2. User selects "Services" tab
3. System loads current service status via GraphQL
4. User toggles service settings
5. System sends mutation to update service configuration
6. UI updates to reflect new status
7. System shows confirmation message

### 4.2 Department Service Configuration Workflow

1. User navigates to department details page
2. User selects "Services" tab
3. System loads current service status via GraphQL
4. User toggles service settings
5. System prompts for confirmation if change affects multiple VMs
6. System sends mutation to update service configuration
7. UI updates to reflect new status
8. System shows confirmation message with affected VM count

### 4.3 Service Inheritance Override Workflow

1. User views VM service that inherits from department
2. User clicks "Override" button
3. System creates VM-specific configuration
4. User modifies settings
5. System saves VM-specific configuration
6. User can later click "Reset to Department Default" to remove override

## 5. Error Handling

### 5.1 GraphQL Error Handling

```typescript
const ServiceToggle = ({ serviceId, initialState, onToggle }) => {
  const [isEnabled, setIsEnabled] = useState(initialState);
  const [toggleService, { loading, error }] = useMutation(TOGGLE_SERVICE_MUTATION);
  
  const handleToggle = async () => {
    try {
      const newState = !isEnabled;
      setIsEnabled(newState); // Optimistic update
      
      await toggleService({
        variables: {
          input: {
            serviceId,
            enabled: newState
          }
        }
      });
      
      onToggle(newState);
    } catch (err) {
      setIsEnabled(isEnabled); // Revert on error
      // Show error notification
    }
  };
  
  return (
    <>
      <Toggle
        checked={isEnabled}
        onChange={handleToggle}
        disabled={loading}
      />
      {error && <ErrorMessage message={error.message} />}
    </>
  );
};
```

### 5.2 User-Friendly Error Messages

Map technical error codes to user-friendly messages:

```typescript
const getErrorMessage = (error) => {
  // Extract error code from GraphQL error
  const code = error?.graphQLErrors?.[0]?.extensions?.code;
  
  switch (code) {
    case 'NOT_FOUND':
      return 'The requested resource could not be found.';
    case 'PERMISSION_DENIED':
      return 'You do not have permission to perform this action.';
    case 'FILTER_ERROR':
      return 'There was an issue updating the network filter. Please try again.';
    default:
      return 'An unexpected error occurred. Please try again later.';
  }
};
```

## 6. Accessibility Considerations

### 6.1 ARIA Attributes

Ensure proper ARIA attributes for service toggles:

```html
<div class="service-toggle">
  <label id="service-ssh-label">SSH Service</label>
  <button
    role="switch"
    aria-checked="true"
    aria-labelledby="service-ssh-label"
    class="toggle-button enabled"
  >
    <span class="toggle-track">
      <span class="toggle-indicator"></span>
    </span>
  </button>
</div>
```

### 6.2 Keyboard Navigation

Ensure all service management UI is keyboard accessible:

```typescript
const ServiceToggle = ({ serviceId, enabled, onChange }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange(!enabled);
    }
  };
  
  return (
    <div
      role="switch"
      tabIndex={0}
      aria-checked={enabled}
      className={`toggle ${enabled ? 'enabled' : 'disabled'}`}
      onClick={() => onChange(!enabled)}
      onKeyDown={handleKeyDown}
    >
      <div className="toggle-track">
        <div className="toggle-indicator"></div>
      </div>
    </div>
  );
};
```

## 7. Best Practices

### 7.1 UI/UX Guidelines

- Use consistent terminology across the UI
- Provide clear explanations of service purposes and risks
- Use tooltips to explain technical terms
- Confirm potentially disruptive actions
- Show inheritance relationships clearly
- Provide visual feedback for state changes

### 7.2 Performance Optimization

- Use Apollo cache effectively
- Implement optimistic UI updates
- Batch related mutations when possible
- Use pagination for large service lists
- Minimize unnecessary re-renders

### 7.3 Security Considerations

- Implement proper authorization checks
- Validate all user inputs
- Provide clear risk information
- Confirm high-risk service enablement
- Log significant service configuration changes
