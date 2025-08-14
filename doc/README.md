# Infinibay Backend Documentation

Welcome to the comprehensive documentation for Infinibay's backend system. This documentation provides detailed information about the architecture, APIs, services, and development practices of the Infinibay virtualization management platform.

## Table of Contents

### Architecture & Design
- [System Architecture Overview](./architecture/README.md)
- [Component Architecture](./architecture/components.md)
- [Design Patterns & Principles](./architecture/design-patterns.md)
- [Data Flow Diagrams](./architecture/data-flow.md)

### Database & Data Models
- [Database Schema](./data/schema.md)
- [Prisma Models](./data/models.md)
- [Data Relationships](./data/relationships.md)
- [Metrics & Analytics Models](./data/metrics.md)

### GraphQL API
- [API Overview](./api/README.md)
- [Schema Documentation](./api/schema.md)
- [Resolvers](./api/resolvers.md)
- [Authentication & Authorization](./api/auth.md)
- [Error Handling](./api/errors.md)

### Services & Business Logic
- [Service Layer Architecture](./services/README.md)
- [Event Management System](./services/event-management.md)
- [Socket.io Real-time Services](./services/socket-services.md)
- [VM Lifecycle Management](./services/vm-lifecycle.md)
- [Security & Network Filtering](./services/security.md)

### Virtualization Integration
- [Libvirt Integration](./virtualization/libvirt.md)
- [VM Management](./virtualization/vm-management.md)
- [Network Management](./virtualization/network-management.md)
- [Storage Management](./virtualization/storage.md)

### Real-time Features
- [WebSocket Communication](./realtime/websockets.md)
- [Event Broadcasting](./realtime/events.md)
- [Live Metrics & Monitoring](./realtime/metrics.md)
- [Virtio Socket Integration](./realtime/virtio-sockets.md)

### Testing
- [Testing Strategy](./testing/README.md)
- [Unit Testing](./testing/unit-testing.md)
- [Integration Testing](./testing/integration-testing.md)
- [Mocking Strategy](./testing/mocking.md)

### Feature Documentation
- [Features Overview](./features/README.md) - **Comprehensive feature documentation with architectural insights**
- [Cron System](./features/cron-system.md) - Automated background operations and system maintenance
- [Unattended Installation](./features/unattended-installation.md) - Automated OS deployment system
- [VM Creation Process](./features/vm-creation-process.md) - Complete VM lifecycle management
- [Event System](./features/event-system.md) - Real-time communication and coordination
- [Security Features](./features/security-features.md) - Multi-layered protection and access control

### Development & Deployment
- [Developer Guide](./development/README.md)
- [Environment Setup](./development/environment.md)
- [Configuration Management](./development/configuration.md)
- [Build & Deployment](./development/deployment.md)
- [Debugging & Logging](./development/debugging.md)

## Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL 12+
- Libvirt/KVM hypervisor
- Rust (for libvirt-node bindings)

### Development Setup
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Database setup
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

### Key Commands
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run test suite
npm run lint         # Check code style
npm run db:migrate   # Run database migrations
npm run db:seed      # Seed database with initial data
```

## Architecture Overview

Infinibay backend is built as a modern GraphQL API server with real-time capabilities:

- **GraphQL API**: Type-safe API using Apollo Server and TypeGraphQL
- **Database**: PostgreSQL with Prisma ORM for type-safe queries
- **Real-time**: Socket.io for WebSocket communication
- **Virtualization**: Custom Rust bindings to libvirt for VM management
- **Security**: JWT authentication with role-based access control
- **Monitoring**: Integration with InfiniService for VM metrics collection

## Key Technologies

- **TypeScript**: Full type safety across the stack
- **GraphQL**: Modern API with Apollo Server
- **Prisma**: Type-safe database ORM
- **Socket.io**: Real-time bidirectional communication
- **Libvirt**: Native virtualization management
- **Jest**: Comprehensive testing framework
- **Winston**: Structured logging

## Contributing

Please refer to our [Development Guide](./development/README.md) for information on:
- Code style and standards
- Testing requirements
- Pull request process
- Development workflow

## Support

For issues and questions:
- Check the [Troubleshooting Guide](./development/troubleshooting.md)
- Review [Common Issues](./development/common-issues.md)
- Enable debug logging as described in [Debugging Guide](./development/debugging.md)