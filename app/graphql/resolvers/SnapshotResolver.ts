import { Resolver, Query, Mutation, Arg, Authorized } from 'type-graphql';
import { 
  Snapshot, 
  SnapshotResult, 
  SnapshotListResult,
  CreateSnapshotInput,
  RestoreSnapshotInput,
  DeleteSnapshotInput
} from '../types/SnapshotType';
import { SuccessType } from './machine/type';
import { getSnapshotService, SnapshotService } from '@services/SnapshotService';
import { getLibvirtConnection } from '@utils/libvirt';
import { Machine, Connection } from '@infinibay/libvirt-node';
import { Debugger } from '@utils/debug';
import { UserInputError } from 'apollo-server-express';

@Resolver()
export class SnapshotResolver {
  private debug: Debugger;
  private snapshotService: SnapshotService | null = null;
  private libvirt: Connection | null = null;

  constructor() {
    this.debug = new Debugger('snapshot-resolver');
  }

  private async ensureServices(): Promise<{ 
    snapshotService: SnapshotService; 
    libvirt: Connection 
  }> {
    if (!this.snapshotService) {
      this.snapshotService = await getSnapshotService();
    }
    if (!this.libvirt) {
      this.libvirt = await getLibvirtConnection();
    }
    return { 
      snapshotService: this.snapshotService, 
      libvirt: this.libvirt 
    };
  }

  @Mutation(() => SnapshotResult, { description: 'Create a snapshot of a virtual machine' })
  @Authorized()
  async createSnapshot(
    @Arg('input') input: CreateSnapshotInput
  ): Promise<SnapshotResult> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, input.machineId);
      if (!domain) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        };
      }

      const vmName = domain.getName() || 'Unknown';
      const isActive = domain.isActive();
      
      if (!isActive) {
        this.debug.log('warning', `VM ${input.machineId} is not running. Snapshot will be created but may have limited functionality.`);
      }

      // Check for existing snapshots with same name
      const existingSnapshots = await snapshotService.listSnapshots(input.machineId);
      if (existingSnapshots.success) {
        const exists = existingSnapshots.snapshots.some(snap => snap.name === input.name);
        if (exists) {
          return {
            success: false,
            message: `Snapshot with name '${input.name}' already exists for this VM`
          };
        }
      }

      // Create the snapshot
      const result = await snapshotService.createSnapshot(
        input.machineId,
        input.name,
        input.description
      );

      if (!result.success) {
        return {
          success: false,
          message: result.message
        };
      }

      const snapshot: Snapshot = {
        id: input.name,
        name: input.name,
        description: input.description,
        vmId: input.machineId,
        vmName: vmName,
        createdAt: result.snapshot?.createdAt || new Date(),
        isCurrent: true,
        parentId: undefined,
        hasMetadata: true,
        state: result.snapshot?.state || 'active'
      };

      this.debug.log('info', `Snapshot '${input.name}' created successfully for VM ${input.machineId}`);

      return {
        success: true,
        message: result.message,
        snapshot: snapshot
      };
    } catch (error) {
      this.debug.log('error', `Failed to create snapshot: ${error}`);
      throw new UserInputError(`Failed to create snapshot: ${error}`);
    }
  }

  @Mutation(() => SuccessType, { description: 'Restore a virtual machine to a snapshot' })
  @Authorized()
  async restoreSnapshot(
    @Arg('input') input: RestoreSnapshotInput
  ): Promise<SuccessType> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, input.machineId);
      if (!domain) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        };
      }

      // Check if snapshot exists
      const snapshots = await snapshotService.listSnapshots(input.machineId);
      if (snapshots.success) {
        const snapshotExists = snapshots.snapshots.some(snap => snap.name === input.snapshotName);
        if (!snapshotExists) {
          return {
            success: false,
            message: `Snapshot '${input.snapshotName}' not found for this VM`
          };
        }
      }

      // Restore the snapshot
      const result = await snapshotService.restoreSnapshot(
        input.machineId,
        input.snapshotName
      );

      this.debug.log('info', `VM ${input.machineId} restored to snapshot '${input.snapshotName}'`);

      return {
        success: result.success,
        message: result.message
      };
    } catch (error) {
      this.debug.log('error', `Failed to restore snapshot: ${error}`);
      throw new UserInputError(`Failed to restore snapshot: ${error}`);
    }
  }

  @Mutation(() => SuccessType, { description: 'Delete a snapshot from a virtual machine' })
  @Authorized()
  async deleteSnapshot(
    @Arg('input') input: DeleteSnapshotInput
  ): Promise<SuccessType> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, input.machineId);
      if (!domain) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        };
      }

      // Check if snapshot exists
      const snapshots = await snapshotService.listSnapshots(input.machineId);
      if (snapshots.success) {
        const snapshotExists = snapshots.snapshots.some(snap => snap.name === input.snapshotName);
        if (!snapshotExists) {
          return {
            success: false,
            message: `Snapshot '${input.snapshotName}' not found for this VM`
          };
        }
      }

      // Delete the snapshot
      const result = await snapshotService.deleteSnapshot(
        input.machineId,
        input.snapshotName
      );

      this.debug.log('info', `Snapshot '${input.snapshotName}' deleted from VM ${input.machineId}`);

      return {
        success: result.success,
        message: result.message
      };
    } catch (error) {
      this.debug.log('error', `Failed to delete snapshot: ${error}`);
      throw new UserInputError(`Failed to delete snapshot: ${error}`);
    }
  }

  @Query(() => SnapshotListResult, { description: 'List all snapshots for a virtual machine' })
  @Authorized()
  async machineSnapshots(
    @Arg('machineId') machineId: string
  ): Promise<SnapshotListResult> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, machineId);
      if (!domain) {
        return {
          success: false,
          message: `Virtual machine with ID ${machineId} not found`,
          snapshots: []
        };
      }

      const vmName = domain.getName() || 'Unknown';
      
      // Get snapshots from service
      const result = await snapshotService.listSnapshots(machineId);
      
      if (!result.success || result.snapshots.length === 0) {
        return {
          success: true,
          message: 'No snapshots found for this virtual machine',
          snapshots: []
        };
      }

      // Convert to GraphQL type
      const snapshots: Snapshot[] = result.snapshots.map(snap => ({
        id: snap.name,
        name: snap.name,
        description: snap.description,
        vmId: machineId,
        vmName: vmName,
        createdAt: snap.createdAt,
        isCurrent: snap.isCurrent,
        parentId: snap.parentName,
        hasMetadata: true,
        state: snap.state
      }));

      // Sort by creation date (newest first)
      snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      this.debug.log('info', `Retrieved ${snapshots.length} snapshots for VM ${machineId}`);

      return {
        success: true,
        message: `Found ${snapshots.length} snapshot(s)`,
        snapshots: snapshots
      };
    } catch (error) {
      this.debug.log('error', `Failed to list snapshots: ${error}`);
      throw new UserInputError(`Failed to list snapshots: ${error}`);
    }
  }

  @Query(() => Snapshot, { nullable: true, description: 'Get the current snapshot of a virtual machine' })
  @Authorized()
  async currentSnapshot(
    @Arg('machineId') machineId: string
  ): Promise<Snapshot | null> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, machineId);
      if (!domain) {
        throw new UserInputError(`Virtual machine with ID ${machineId} not found`);
      }

      const vmName = domain.getName() || 'Unknown';
      
      // Get current snapshot from service
      const currentSnap = await snapshotService.getCurrentSnapshot(machineId);
      
      if (!currentSnap) {
        return null;
      }

      const result: Snapshot = {
        id: currentSnap.name,
        name: currentSnap.name,
        description: currentSnap.description,
        vmId: machineId,
        vmName: vmName,
        createdAt: currentSnap.createdAt,
        isCurrent: true,
        parentId: currentSnap.parentName,
        hasMetadata: true,
        state: currentSnap.state
      };

      this.debug.log('info', `Retrieved current snapshot '${currentSnap.name}' for VM ${machineId}`);

      return result;
    } catch (error) {
      this.debug.log('error', `Failed to get current snapshot: ${error}`);
      throw new UserInputError(`Failed to get current snapshot: ${error}`);
    }
  }

  @Mutation(() => SuccessType, { description: 'Force power off and restore snapshot (emergency recovery)' })
  @Authorized()
  async forceRestoreSnapshot(
    @Arg('input') input: RestoreSnapshotInput
  ): Promise<SuccessType> {
    try {
      const { snapshotService, libvirt } = await this.ensureServices();
      
      // Check if VM exists
      const domain = Machine.lookupByUuidString(libvirt, input.machineId);
      if (!domain) {
        return {
          success: false,
          message: `Virtual machine with ID ${input.machineId} not found`
        };
      }

      // Force stop the VM if it's running
      if (domain.isActive()) {
        this.debug.log('info', `Force stopping VM ${input.machineId} before restore`);
        domain.destroy();
        
        // Wait a moment for the VM to fully stop
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Check if snapshot exists
      const snapshots = await snapshotService.listSnapshots(input.machineId);
      if (snapshots.success) {
        const snapshotExists = snapshots.snapshots.some(snap => snap.name === input.snapshotName);
        if (!snapshotExists) {
          return {
            success: false,
            message: `Snapshot '${input.snapshotName}' not found for this VM`
          };
        }
      }

      // Restore the snapshot
      const result = await snapshotService.restoreSnapshot(
        input.machineId,
        input.snapshotName
      );

      this.debug.log('info', `VM ${input.machineId} force-restored to snapshot '${input.snapshotName}'`);

      return {
        success: result.success,
        message: `Virtual machine force-restored to snapshot '${input.snapshotName}' successfully`
      };
    } catch (error) {
      this.debug.log('error', `Failed to force restore snapshot: ${error}`);
      throw new UserInputError(`Failed to force restore snapshot: ${error}`);
    }
  }
}