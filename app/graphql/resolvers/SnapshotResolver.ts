import { Resolver, Query, Mutation, Arg, Authorized, Ctx } from 'type-graphql'
import {
  Snapshot,
  SnapshotResult,
  SnapshotListResult,
  CreateSnapshotInput,
  RestoreSnapshotInput,
  DeleteSnapshotInput
} from '../types/SnapshotType'
import { SuccessType } from './machine/type'
import { SnapshotServiceV2, getSnapshotServiceV2 } from '@services/SnapshotServiceV2'
import { VMOperationsService } from '@services/VMOperationsService'
import { Debugger } from '@utils/debug'
import { UserInputError } from 'apollo-server-express'
import { getSocketService } from '@services/SocketService'
import { InfinibayContext } from '@utils/context'
import Debug from 'debug'

const debug = Debug('infinibay:snapshot-resolver')

@Resolver()
export class SnapshotResolver {
  private debug: Debugger

  constructor () {
    this.debug = new Debugger('snapshot-resolver')
  }

  @Mutation(() => SnapshotResult, { description: 'Create a snapshot of a virtual machine' })
  @Authorized()
  async createSnapshot (
    @Arg('input') input: CreateSnapshotInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SnapshotResult> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { id: true, name: true, status: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        }
      }

      // Check if snapshot with same name exists
      const existingResult = await snapshotService.snapshotExists(input.machineId, input.name)
      if (existingResult) {
        return {
          success: false,
          message: `Snapshot with name '${input.name}' already exists for this VM`
        }
      }

      // Create the snapshot
      const result = await snapshotService.createSnapshot(
        input.machineId,
        input.name,
        input.description
      )

      if (!result.success) {
        return {
          success: false,
          message: result.message
        }
      }

      const snapshot: Snapshot = {
        id: input.name,
        name: input.name,
        description: input.description,
        vmId: input.machineId,
        vmName: machine.name,
        createdAt: result.snapshot?.createdAt || new Date(),
        isCurrent: true,
        parentId: undefined,
        hasMetadata: true,
        state: result.snapshot?.state || 'shutoff'
      }

      this.debug.log('info', `Snapshot '${input.name}' created successfully for VM ${input.machineId}`)

      // Emit WebSocket event
      if (ctx?.user && machine?.userId) {
        try {
          const socketService = getSocketService()
          socketService.sendToUser(machine.userId, 'vm', 'snapshot:created', {
            data: {
              machineId: input.machineId,
              snapshot
            }
          })
          debug(`📡 Emitted vm:snapshot:created event for machine ${input.machineId}`)
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      return {
        success: true,
        message: result.message,
        snapshot
      }
    } catch (error) {
      this.debug.log('error', `Failed to create snapshot: ${error}`)
      throw new UserInputError(`Failed to create snapshot: ${error}`)
    }
  }

  @Mutation(() => SuccessType, { description: 'Restore a virtual machine to a snapshot' })
  @Authorized()
  async restoreSnapshot (
    @Arg('input') input: RestoreSnapshotInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SuccessType> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { id: true, name: true, status: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        }
      }

      // Check if snapshot exists
      const snapshotExists = await snapshotService.snapshotExists(input.machineId, input.snapshotName)
      if (!snapshotExists) {
        return {
          success: false,
          message: `Snapshot '${input.snapshotName}' not found for this VM`
        }
      }

      // Restore the snapshot
      const result = await snapshotService.restoreSnapshot(
        input.machineId,
        input.snapshotName
      )

      this.debug.log('info', `VM ${input.machineId} restored to snapshot '${input.snapshotName}'`)

      // Emit WebSocket event if successful
      if (result.success && ctx?.user && machine?.userId) {
        try {
          const socketService = getSocketService()
          socketService.sendToUser(machine.userId, 'vm', 'snapshot:restored', {
            data: {
              machineId: input.machineId,
              snapshotName: input.snapshotName
            }
          })
          debug(`📡 Emitted vm:snapshot:restored event for machine ${input.machineId}`)
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      return {
        success: result.success,
        message: result.message
      }
    } catch (error) {
      this.debug.log('error', `Failed to restore snapshot: ${error}`)
      throw new UserInputError(`Failed to restore snapshot: ${error}`)
    }
  }

  @Mutation(() => SuccessType, { description: 'Delete a snapshot from a virtual machine' })
  @Authorized()
  async deleteSnapshot (
    @Arg('input') input: DeleteSnapshotInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SuccessType> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { id: true, name: true, userId: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        }
      }

      // Check if snapshot exists
      const snapshotExists = await snapshotService.snapshotExists(input.machineId, input.snapshotName)
      if (!snapshotExists) {
        return {
          success: false,
          message: `Snapshot '${input.snapshotName}' not found for this VM`
        }
      }

      // Delete the snapshot
      const result = await snapshotService.deleteSnapshot(
        input.machineId,
        input.snapshotName
      )

      this.debug.log('info', `Snapshot '${input.snapshotName}' deleted from VM ${input.machineId}`)

      // Emit WebSocket event if successful
      if (result.success && ctx?.user && machine?.userId) {
        try {
          const socketService = getSocketService()
          socketService.sendToUser(machine.userId, 'vm', 'snapshot:deleted', {
            data: {
              machineId: input.machineId,
              snapshotName: input.snapshotName
            }
          })
          debug(`📡 Emitted vm:snapshot:deleted event for machine ${input.machineId}`)
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      return {
        success: result.success,
        message: result.message
      }
    } catch (error) {
      this.debug.log('error', `Failed to delete snapshot: ${error}`)
      throw new UserInputError(`Failed to delete snapshot: ${error}`)
    }
  }

  @Query(() => SnapshotListResult, { description: 'List all snapshots for a virtual machine' })
  @Authorized()
  async machineSnapshots (
    @Arg('machineId') machineId: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SnapshotListResult> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Virtual machine with ID ${machineId} not found`,
          snapshots: []
        }
      }

      // Get snapshots from service
      const result = await snapshotService.listSnapshots(machineId)

      if (!result.success || result.snapshots.length === 0) {
        return {
          success: true,
          message: result.message || 'No snapshots found for this virtual machine',
          snapshots: []
        }
      }

      // Convert to GraphQL type
      const snapshots: Snapshot[] = result.snapshots.map(snap => ({
        id: snap.name,
        name: snap.name,
        description: snap.description,
        vmId: machineId,
        vmName: machine.name,
        createdAt: snap.createdAt,
        isCurrent: snap.isCurrent,
        parentId: snap.parentName,
        hasMetadata: true,
        state: snap.state
      }))

      // Sort by creation date (newest first)
      snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      this.debug.log('info', `Retrieved ${snapshots.length} snapshots for VM ${machineId}`)

      return {
        success: true,
        message: `Found ${snapshots.length} snapshot(s)`,
        snapshots
      }
    } catch (error) {
      this.debug.log('error', `Failed to list snapshots: ${error}`)
      throw new UserInputError(`Failed to list snapshots: ${error}`)
    }
  }

  @Query(() => Snapshot, { nullable: true, description: 'Get the current snapshot of a virtual machine' })
  @Authorized()
  async currentSnapshot (
    @Arg('machineId') machineId: string,
    @Ctx() ctx?: InfinibayContext
  ): Promise<Snapshot | null> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { id: true, name: true }
      })

      if (!machine) {
        throw new UserInputError(`Virtual machine with ID ${machineId} not found`)
      }

      // Get current snapshot from service
      const currentSnap = await snapshotService.getCurrentSnapshot(machineId)

      if (!currentSnap) {
        return null
      }

      const result: Snapshot = {
        id: currentSnap.name,
        name: currentSnap.name,
        description: currentSnap.description,
        vmId: machineId,
        vmName: machine.name,
        createdAt: currentSnap.createdAt,
        isCurrent: true,
        parentId: currentSnap.parentName,
        hasMetadata: true,
        state: currentSnap.state
      }

      this.debug.log('info', `Retrieved current snapshot '${currentSnap.name}' for VM ${machineId}`)

      return result
    } catch (error) {
      this.debug.log('error', `Failed to get current snapshot: ${error}`)
      throw new UserInputError(`Failed to get current snapshot: ${error}`)
    }
  }

  @Mutation(() => SuccessType, { description: 'Force power off and restore snapshot (emergency recovery)' })
  @Authorized()
  async forceRestoreSnapshot (
    @Arg('input') input: RestoreSnapshotInput,
    @Ctx() ctx?: InfinibayContext
  ): Promise<SuccessType> {
    if (!ctx?.prisma) {
      throw new UserInputError('Database context not available')
    }

    try {
      const snapshotService = getSnapshotServiceV2(ctx.prisma)
      const vmOpsService = new VMOperationsService(ctx.prisma)

      // Check if VM exists
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { id: true, name: true, status: true }
      })

      if (!machine) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        }
      }

      // Force stop the VM if it's running
      if (machine.status === 'running') {
        this.debug.log('info', `Force stopping VM ${input.machineId} before restore`)
        const stopResult = await vmOpsService.forcePowerOff(input.machineId)

        if (!stopResult.success) {
          return {
            success: false,
            message: `Failed to stop VM before restore: ${stopResult.error}`
          }
        }

        // Wait a moment for the VM to fully stop
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      // Check if snapshot exists
      const snapshotExists = await snapshotService.snapshotExists(input.machineId, input.snapshotName)
      if (!snapshotExists) {
        return {
          success: false,
          message: `Snapshot '${input.snapshotName}' not found for this VM`
        }
      }

      // Restore the snapshot
      const result = await snapshotService.restoreSnapshot(
        input.machineId,
        input.snapshotName
      )

      this.debug.log('info', `VM ${input.machineId} force-restored to snapshot '${input.snapshotName}'`)

      return {
        success: result.success,
        message: `Virtual machine force-restored to snapshot '${input.snapshotName}' successfully`
      }
    } catch (error) {
      this.debug.log('error', `Failed to force restore snapshot: ${error}`)
      throw new UserInputError(`Failed to force restore snapshot: ${error}`)
    }
  }
}
