import { PrismaClient } from '@prisma/client';
import { Connection, Machine as VirtualMachine, NwFilter } from 'libvirt-node';
import { XMLGenerator } from '../../utils/VirtManager/xmlGenerator';
import { Debugger } from '../../utils/debug';
import { unlinkSync, existsSync } from 'fs';

export class MachineCleanupService {
  private prisma: PrismaClient;
  private debug = new Debugger('machine-cleanup-service');

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async cleanupVM(machineId: string): Promise<void> {
    console.log("Cleanining up");
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        configuration: true,
        nwFilters: { include: { nwFilter: true } }
      }
    });
    if (!machine) {
      this.debug.log(`Machine ${machineId} not found`);
      return;
    }

    // Collect filter IDs for DB cleanup
    const filterIds = machine.nwFilters.map(vmf => vmf.nwFilter.id);

    // Prepare VM-related files for deletion
    let filesToDelete: string[] = [];
    if (machine.configuration?.xml) {
      const xmlGen = new XMLGenerator('', '', '');
      xmlGen.load(machine.configuration.xml);
      filesToDelete = [
        xmlGen.getUefiVarFile(),
        ...xmlGen.getDisks()
      ].filter((file): file is string => Boolean(file && existsSync(file) && !file.includes('virtio')));
    }

    // Libvirt cleanup and resource removal
    let conn: Connection | null = null;
    try {
      conn = Connection.open('qemu:///system');
      if (conn) {
        const domain = VirtualMachine.lookupByName(conn, machine.internalName);
        // Destroy VM domain
        if (domain) {
          try { await domain.destroy(); } catch (e) {
            this.debug.log(`Error destroying domain ${machine.internalName}: ${String(e)}`);
          }
        }
        // Delete VM-related files
        for (const file of filesToDelete) {
          try { unlinkSync(file); } catch (e) {
            this.debug.log(`Error deleting file ${file}: ${String(e)}`);
          }
        }
        // Cleanup VM-specific filters in libvirt
        for (const vmf of machine.nwFilters) {
          try {
            const filter = await NwFilter.lookupByName(conn, vmf.nwFilter.internalName);
            if (filter) {
              await filter.undefine();
            }
          } catch (e) {
            this.debug.log(`Error undefining filter ${vmf.nwFilter.internalName}: ${String(e)}`);
          }
        }
        // Undefine VM domain
        if (domain) {
          try { await domain.undefine(); } catch (e) {
            this.debug.log(`Error undefining domain ${machine.internalName}: ${String(e)}`);
          }
        }
      }
    } catch (e) {
      console.log(e);
      this.debug.log(`Error cleaning up libvirt resources: ${String(e)}`);
    } finally {
      if (conn) {
        try { conn.close(); } catch (e) {
          console.log(e);
          this.debug.log(`Error closing libvirt connection: ${String(e)}`);
        }
      }
    }

    // Remove DB records in correct order
    await this.prisma.$transaction(async tx => {
      console.log("Removing DB records");
      try {
        if (machine.configuration) {
          await tx.machineConfiguration.delete({ where: { machineId: machine.id } });
        }
        await tx.machineApplication.deleteMany({ where: { machineId: machine.id } });
        await tx.vMNWFilter.deleteMany({ where: { vmId: machine.id } });
        // Delete VM port records to satisfy foreign key constraint
        await tx.vmPort.deleteMany({ where: { vmId: machine.id } });
        // Delete VM-specific filters
        if (filterIds.length) {
          await tx.nWFilter.deleteMany({ where: { id: { in: filterIds } } });
        }
        await tx.machine.delete({ where: { id: machine.id } });
      } catch (e) {
        console.log(e);
        this.debug.log(`Error removing DB records: ${String(e)}`);
      }
      });
  }
}
