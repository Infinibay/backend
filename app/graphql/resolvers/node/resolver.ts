import { Arg, Ctx, ID, Mutation, Query, Resolver } from 'type-graphql'
import { GraphQLError } from 'graphql'
import { Disk, Node } from '@prisma/client'

import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
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
    // Return a clean NOT_FOUND rather than letting Prisma's P2025 for a bogus id
    // reach the client as a raw internal error (with a stack trace in dev).
    const existing = await prisma.node.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      throw new GraphQLError('Node not found', { extensions: { code: 'NOT_FOUND' } })
    }
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
    try {
      await enrollment.approve(id, pairingCode ?? undefined)
    } catch (err: any) {
      // Map the service's plain Error(s) to typed GraphQL errors so the boundary
      // returns a clean NOT_FOUND / BAD_USER_INPUT instead of masking them to a
      // generic "Internal server error".
      const msg: string = err?.message ?? ''
      if (msg.startsWith('node not found')) {
        throw new GraphQLError('Node not found', { extensions: { code: 'NOT_FOUND' } })
      }
      if (msg.includes('is not pending') || msg.includes('SAS code mismatch')) {
        throw new UserInputError(msg)
      }
      throw err
    }
    return true
  }

  /** Reject a pending node's join request. */
  @Mutation(() => Boolean)
  @Can('node:edit', { id: (a) => a.id })
  async rejectNode (
    @Arg('id', () => ID) id: string,
      @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = context
    // Guard before delegating: reject() unconditionally nulls the row's identity
    // material (certPem/joinNonce/joinCodeHash). Load the target first so we (a)
    // return a clean NOT_FOUND for a bogus id and (b) refuse to reject the master
    // node — doing so would strip the control-plane row's cert and drop it out of
    // healthy inventory, a cluster-wide availability event from a single call.
    // Rejecting an already-approved compute node stays allowed (the documented
    // re-enrollment reset).
    const target = await prisma.node.findUnique({
      where: { id },
      select: { id: true, role: true }
    })
    if (!target) {
      throw new GraphQLError('Node not found', { extensions: { code: 'NOT_FOUND' } })
    }
    if (target.role === 'master') {
      throw new UserInputError('The master node cannot be rejected')
    }
    const enrollment = new NodeEnrollmentService(context.prisma, new ClusterCA())
    await enrollment.reject(id)
    return true
  }

  /**
   * Permanently remove a node from the inventory (delete the row), for
   * decommissioned hosts you no longer want listed. Refuses the master
   * (control-plane) node, and refuses a node that still has VMs assigned —
   * deleting it would detach them (Machine.nodeId → null via onDelete: SetNull)
   * and strand them, since a re-registering agent is minted a fresh node id and
   * the nulled machines never re-link. The node's own Disk rows are removed with
   * it (Disk.nodeId is a required relation, so they must go first).
   *
   * NOTE: MigrationJob.sourceNodeId/targetNodeId are plain columns (no FK), so
   * historical migration rows are left pointing at the deleted id. And a node
   * whose agent is still running will re-register on its next heartbeat — for a
   * durable removal, `rejectNode` it (revokes its cert) and/or stop the agent first.
   */
  @Mutation(() => Boolean)
  @Can('node:edit', { id: (a) => a.id })
  async deleteNode (
    @Arg('id', () => ID) id: string,
      @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = context
    const target = await prisma.node.findUnique({
      where: { id },
      select: { id: true, role: true }
    })
    if (!target) {
      throw new GraphQLError('Node not found', { extensions: { code: 'NOT_FOUND' } })
    }
    if (target.role === 'master') {
      throw new UserInputError('The master node cannot be deleted')
    }
    const machineCount = await prisma.machine.count({ where: { nodeId: id } })
    if (machineCount > 0) {
      throw new UserInputError(
        `This node still has ${machineCount} VM(s) assigned. Migrate or remove them before deleting the node.`
      )
    }
    try {
      await prisma.$transaction([
        prisma.disk.deleteMany({ where: { nodeId: id } }),
        prisma.node.delete({ where: { id } })
      ])
    } catch (err: any) {
      // Lost a race with a concurrent delete (row already gone) → surface a clean
      // NOT_FOUND like the pre-check, not a masked "Internal server error".
      if (err?.code === 'P2025') {
        throw new GraphQLError('Node not found', { extensions: { code: 'NOT_FOUND' } })
      }
      throw err
    }
    return true
  }
}
