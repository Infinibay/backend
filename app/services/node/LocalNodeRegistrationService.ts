import os from 'node:os'
import si from 'systeminformation'
import { Node, PrismaClient } from '@prisma/client'

interface DetectedDisk {
  path: string
  status: string
}

interface BlockDeviceLike {
  name?: string
  path?: string
  type?: string
  interface?: string
  interfaceType?: string
  removable?: boolean
  isRemovable?: boolean
}

interface LocalNodeHardware {
  name: string
  currentRaid: string
  cpuFlags: {
    raw: string
    values: string[]
  }
  ram: number
  cores: number
  disks: DetectedDisk[]
}

function normalizeDiskPath (value: string | undefined): string | null {
  if (!value) return null
  if (value.startsWith('/dev/')) return value
  return `/dev/${value.replace(/^\/?dev\//, '')}`
}

function shouldSkipDevice (device: BlockDeviceLike): boolean {
  const type = String(device.type || '').toLowerCase()
  const interfaceType = String(device.interfaceType || device.interface || '').toLowerCase()
  const name = String(device.name || '').toLowerCase()

  return Boolean(
    device.removable ||
    device.isRemovable ||
    interfaceType.includes('usb') ||
    type.includes('rom') ||
    type.includes('cd') ||
    type.includes('dvd') ||
    type.includes('loop') ||
    name.startsWith('loop')
  )
}

function detectRaidLevel (diskCount: number): string {
  if (diskCount >= 4) return 'raid10'
  if (diskCount === 3) return 'raid5'
  if (diskCount === 2) return 'raid1'
  return 'single'
}

export class LocalNodeRegistrationService {
  constructor (private readonly prisma: PrismaClient) {}

  async detectLocalHardware (): Promise<LocalNodeHardware> {
    const [cpu, mem, blockDevices] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.blockDevices()
    ])

    const devices = blockDevices as unknown as BlockDeviceLike[]

    const disks = devices
      .filter(device => !shouldSkipDevice(device))
      .map(device => normalizeDiskPath(device.path || device.name))
      .filter((path): path is string => Boolean(path))
      .map(path => ({
        path,
        status: 'healthy'
      }))

    const rawFlags = String(cpu.flags || '')

    return {
      name: process.env.INFINIBAY_NODE_NAME || os.hostname(),
      currentRaid: detectRaidLevel(disks.length),
      cpuFlags: {
        raw: rawFlags,
        values: rawFlags.split(/\s+/).filter(Boolean)
      },
      ram: Math.round(mem.total / 1024 / 1024),
      cores: cpu.cores || 1,
      disks
    }
  }

  async registerLocalNode (): Promise<Node> {
    const hardware = await this.detectLocalHardware()
    const existing = await this.prisma.node.findFirst({
      where: { name: hardware.name }
    })

    // This service runs inside the control-plane backend, so by default the local
    // node IS the master. A compute-node agent (Phase 1) sets INFINIBAY_NODE_ROLE
    // =compute and uses its own registration path that does NOT adopt orphan VMs.
    const role = (process.env.INFINIBAY_NODE_ROLE || 'master').toLowerCase()
    const address = process.env.HOST_IP || process.env.APP_HOST || null
    // The local node is alive right now: stamp a heartbeat so it reads 'online'
    // immediately (NodeCapacity staleness is heartbeat-driven in Phase 0).
    const now = new Date()

    const node = existing
      ? await this.prisma.node.update({
        where: { id: existing.id },
        data: {
          currentRaid: hardware.currentRaid,
          cpuFlags: hardware.cpuFlags,
          ram: hardware.ram,
          cores: hardware.cores,
          role,
          status: 'online',
          address,
          lastHeartbeat: now
        }
      })
      : await this.prisma.node.create({
        data: {
          name: hardware.name,
          currentRaid: hardware.currentRaid,
          cpuFlags: hardware.cpuFlags,
          ram: hardware.ram,
          cores: hardware.cores,
          maintenanceMode: false,
          role,
          status: 'online',
          address,
          lastHeartbeat: now
        }
      })

    await this.prisma.disk.deleteMany({
      where: { nodeId: node.id }
    })

    if (hardware.disks.length > 0) {
      await this.prisma.disk.createMany({
        data: hardware.disks.map(disk => ({
          nodeId: node.id,
          path: disk.path,
          status: disk.status
        }))
      })
    }

    // Backfill (G0): adopt VMs that predate node placement (nodeId IS NULL) onto
    // this master node so the node-scoped reconcile/reaper actually manages them.
    // Only the master adopts orphans — a compute agent must never claim VMs it was
    // not assigned. Idempotent: once every Machine has a nodeId this is a no-op.
    if (role === 'master') {
      const adopted = await this.prisma.machine.updateMany({
        where: { nodeId: null },
        data: { nodeId: node.id }
      })
      if (adopted.count > 0) {
        // eslint-disable-next-line no-console
        console.info(`[node] adopted ${adopted.count} unassigned VM(s) onto master node ${node.id}`)
      }
    }

    return node
  }
}
