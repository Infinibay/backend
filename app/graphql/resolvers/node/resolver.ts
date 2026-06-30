import { Arg, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'
import { Disk, Node } from '@prisma/client'

import { InfinibayContext } from '@utils/context'
import { NodeInventorySummary, NodeType, PendingNodeType } from './type'
import { Can } from '@main/permissions'
import { calculateNodeCapacity, nodeHealth } from '../../../services/node/NodeCapacity'
import { ClusterCA } from '../../../services/node/ClusterCA'
import { NodeEnrollmentService } from '../../../services/node/NodeEnrollmentService'

type NodeWithDisks = Node & { disks: Disk[] }

const HEALTHY_DISK_STATUSES = new Set(['healthy', 'online', 'ok', 'ready'])

type NodeWithInventory = NodeWithDisks & {
  machines?: Array<{
    status?: string
    cpuCores: number
    ramGB: number
    diskSizeGB: number
  }>
}

function toGraphql (node: NodeWithInventory, now = new Date()): NodeType {
  const disks = node.disks ?? []
  const capacity = calculateNodeCapacity({
    cores: node.cores,
    ram: node.ram,
    updatedAt: node.updatedAt,
    lastHeartbeat: node.lastHeartbeat,
    maintenanceMode: node.maintenanceMode,
    machines: node.machines ?? []
  }, now)
  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    address: node.address,
    fingerprint: node.fingerprint,
    currentRaid: node.currentRaid,
    nextRaid: node.nextRaid,
    cpuFlags: node.cpuFlags,
    ram: node.ram,
    cores: node.cores,
    maintenanceMode: node.maintenanceMode,
    health: nodeHealth(node.lastHeartbeat ?? node.updatedAt, now),
    diskCount: disks.length,
    healthyDiskCount: disks.filter(disk => HEALTHY_DISK_STATUSES.has(disk.status.toLowerCase())).length,
    availableCores: capacity.availableCores,
    availableRamGB: capacity.availableRamGB,
    machineCount: node.machines?.length ?? 0,
    runningMachineCount: node.machines?.filter(machine => machine.status === 'running').length ?? 0,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    disks
  }
}

@Resolver(() => NodeType)
export class NodeResolver {
  @Query(() => [NodeType])
  @Can('node:view')
  async nodes (@Ctx() context: InfinibayContext): Promise<NodeType[]> {
    const { prisma } = context
    const now = new Date()
    const nodes = await prisma.node.findMany({
      include: {
        disks: true,
        machines: {
          select: {
            status: true,
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    return nodes.map(node => toGraphql(node, now))
  }

  @Query(() => NodeType, { nullable: true })
  @Can('node:view', { id: (a) => a.id })
  async node (
    @Arg('id', () => ID) id: string,
      @Ctx() context: InfinibayContext
  ): Promise<NodeType | null> {
    const { prisma } = context
    const node = await prisma.node.findUnique({
      where: { id },
      include: {
        disks: true,
        machines: {
          select: {
            status: true,
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      }
    })

    return node ? toGraphql(node) : null
  }

  @Query(() => NodeInventorySummary)
  @Can('node:view')
  async nodeInventorySummary (@Ctx() context: InfinibayContext): Promise<NodeInventorySummary> {
    const { prisma } = context
    const now = new Date()
    const nodes = await prisma.node.findMany({
      include: {
        disks: true,
        machines: {
          select: {
            status: true,
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      }
    })
    const gqlNodes = nodes.map(node => toGraphql(node, now))

    return {
      totalNodes: gqlNodes.length,
      onlineNodes: gqlNodes.filter(node => node.health === 'online').length,
      staleNodes: gqlNodes.filter(node => node.health === 'stale').length,
      totalCores: gqlNodes.reduce((sum, node) => sum + node.cores, 0),
      totalRam: gqlNodes.reduce((sum, node) => sum + node.ram, 0),
      totalDisks: gqlNodes.reduce((sum, node) => sum + node.diskCount, 0)
    }
  }

  @Mutation(() => NodeType)
  @Can('node:edit', { id: (a) => a.id })
  async setNodeMaintenanceMode (
    @Arg('id', () => ID) id: string,
      @Arg('enabled', () => Boolean) enabled: boolean,
      @Ctx() context: InfinibayContext
  ): Promise<NodeType> {
    const { prisma } = context
    const node = await prisma.node.update({
      where: { id },
      data: { maintenanceMode: enabled },
      include: {
        disks: true,
        machines: {
          select: {
            status: true,
            cpuCores: true,
            ramGB: true,
            diskSizeGB: true
          }
        }
      }
    })

    return toGraphql(node)
  }

  /**
   * Nodes awaiting SAS approval, each with the pairing code to compare against the
   * one on the node terminal (Phase 2 onboarding / double-verification).
   */
  @Query(() => [PendingNodeType])
  @Can('node:view')
  async pendingNodes (@Ctx() context: InfinibayContext): Promise<PendingNodeType[]> {
    const enrollment = new NodeEnrollmentService(context.prisma, new ClusterCA())
    return enrollment.listPending()
  }

  /**
   * Approve a pending node into the cluster. If `pairingCode` is supplied it must
   * match the node's SAS — i.e. the admin confirms they read the code off the
   * node's own terminal (the strongest form of the double-check). On the node's
   * next poll the master signs its client certificate.
   */
  @Mutation(() => Boolean)
  @Can('node:edit', { id: (a) => a.id })
  async approveNode (
    @Arg('id', () => ID) id: string,
      @Arg('pairingCode', () => String, { nullable: true }) pairingCode: string | undefined,
      @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const enrollment = new NodeEnrollmentService(context.prisma, new ClusterCA())
    await enrollment.approve(id, pairingCode ?? undefined)
    return true
  }

  /** Reject a pending node's join request. */
  @Mutation(() => Boolean)
  @Can('node:edit', { id: (a) => a.id })
  async rejectNode (
    @Arg('id', () => ID) id: string,
      @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const enrollment = new NodeEnrollmentService(context.prisma, new ClusterCA())
    await enrollment.reject(id)
    return true
  }
}
