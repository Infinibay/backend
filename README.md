# Infinibay Backend

GraphQL API backend for Infinibay, a virtualization management platform designed for simplicity.

## Overview

This repository contains the backend API server for Infinibay. It provides a GraphQL interface for managing virtual machines, networks, storage, and user authentication through libvirt.

**Important:** This is a component of the Infinibay system and is not intended to be installed standalone. The backend runs as part of a containerized infrastructure orchestrated by LXD.

## Tech Stack

- **Runtime:** Node.js 18+
- **API:** Apollo Server 4 (GraphQL)
- **Database:** PostgreSQL (via Prisma 6)
- **Virtualization:** Native libvirt bindings (Rust/NAPI-RS via `@infinibay/libvirt-node`)
- **Real-time:** Socket.io for WebSocket events

## Installation

Infinibay backend is deployed automatically as part of the complete system. Choose your installation method:

### Production Installation (Recommended)
Use the automated installer for Ubuntu 22.04+ systems:
```bash
git clone https://github.com/Infinibay/installer
cd installer
./setup.sh
```

See the [installer repository](https://github.com/Infinibay/installer) for full documentation.

### LXD-based Deployment (Alternative)
For simplified deployment using LXD containers:
```bash
git clone https://github.com/Infinibay/lxd
cd lxd
sudo ./setup.sh
./run.sh
```

See the [lxd repository](https://github.com/Infinibay/lxd) for LXD-based deployment and usage.

## Development

For developers contributing to the backend:

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- libvirt with qemu/kvm

### Local Setup
```bash
npm install
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npm run db:migrate

# Seed database
npm run db:seed

# Start development server
npm run dev
```

### Key Commands
- `npm run dev` - Start development server with hot reload
- `npm run db:migrate` - Run Prisma migrations
- `npm run db:seed` - Seed database with initial data
- `npm test` - Run test suite
- `npm run cleanup:nwfilters` - Clean orphaned network filters

See [backend/CLAUDE.md](./CLAUDE.md) for architecture details and development patterns.

## GraphQL API

The API is available at `http://localhost:4000/graphql` when running.

- Schema: [app/schema.graphql](./app/schema.graphql)
- Resolvers: [app/graphql/resolvers/](./app/graphql/resolvers/)
- Services: [app/services/](./app/services/)

## License

[Your License]

## Links

- [Infinibay Website](https://infinibay.com)
- [Installer Repository](https://github.com/Infinibay/installer)
- [LXD Development Repository](https://github.com/Infinibay/lxd)
- [Frontend Repository](https://github.com/Infinibay/frontend)
