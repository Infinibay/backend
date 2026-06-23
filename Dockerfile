# Infinibay backend — multi-stage image.
#
#   target: dev   Hot-reload development. No source is baked in; the lxd dev
#                 stack bind-mounts this repo (and the infinization sibling) and
#                 runs the hot-reload entrypoint. This is what `lxd` builds today.
#                   build.context = this repo, target = dev   (see ../lxd)
#
#   target: prod  Compiled image (mirrors the LXD production run: tsc build →
#                 node dist/index.js via module-alias). Because the backend
#                 depends on @infinibay/infinization through "file:../infinization",
#                 the prod target must be built from the MONOREPO ROOT so the
#                 sibling is in the build context:
#                   docker build -f backend/Dockerfile --target prod -t infinibay/backend .
#
# The compose wiring, entrypoints, env and KVM override live in the lxd repo —
# this Dockerfile only defines how to BUILD the backend image.

# ── base: Debian + Node 20 + the host hypervisor toolchain ───────────────────
# node:20-bookworm (Debian, non-slim) already ships build-essential / python3 /
# git, needed to compile the native addons (bcrypt, ref-napi, ssh2). The qemu /
# nftables / swtpm tools are inert on macOS (no /dev/kvm) but let the SAME image
# run the full VM path on a Linux KVM host.
FROM node:20-bookworm AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      qemu-system-x86 qemu-utils nftables iproute2 dnsmasq \
      swtpm swtpm-tools ethtool numactl genisoimage xorriso procps \
      postgresql-client curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/backend

# ── dev: environment only; source + infinization are mounted at runtime ──────
# nodemon drives the restart loop; ts-node itself is the project's own pinned
# version (resolved from node_modules via nodemon's PATH shim).
FROM base AS dev
RUN npm install -g nodemon@3
# Real command comes from the lxd compose stack (docker/entrypoint-backend.sh).
CMD ["bash", "-lc", "echo 'Run via the lxd dev stack (see ../lxd)'; sleep infinity"]

# ── prod: compiled image. Build from the monorepo root (see header). ─────────
FROM base AS prod
# Both paths are relative to the MONOREPO ROOT build context.
COPY infinization /workspace/infinization
COPY backend /workspace/backend
# infinization must be built first (backend imports its compiled dist/index.js).
WORKDIR /workspace/infinization
RUN npm install --minimum-release-age=0 --no-audit --no-fund && npm run build
WORKDIR /workspace/backend
RUN npm install --minimum-release-age=0 --no-audit --no-fund \
    && npx prisma generate \
    && npm run build
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
# Migrations + seed are an operational step (run `npx prisma migrate deploy`
# against a reachable DB before/at deploy), not baked into the image.
CMD ["node", "dist/index.js"]
