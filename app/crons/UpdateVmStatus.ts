// Every minute:
// * fetch all running vms with libvirt-node
// * Update all vm to not running if they are not found in the list
// * Update all vm to running if they are found in the list
import { CronJob } from 'cron';
// prisma
import { PrismaClient } from '@prisma/client';
// libvirt-node
import { Connection, Machine } from 'libvirt-node';

const UpdateVmStatusJob = new CronJob('* * * * *', async () => {
  console.log('Running UpdateVmStatusJob');
  const prisma = new PrismaClient();
  const conn = Connection.open('qemu:///system');
  if (!conn) {
    console.error('Failed to open connection to libvirt');
    return;
  }
  const domains = conn?.listAllDomains(0);
  if (!domains) {
    console.error('Failed to list domains');
    return;
  }
  const runningVms = domains.map((domain) => domain.getName());
  const allVms = await prisma.machine.findMany();

  const runningVmIds = allVms
    .filter((vm) => runningVms.includes(vm.internalName) && vm.status !== 'running')
    .map((vm) => vm.id);

  const stoppedVmIds = allVms
    .filter((vm) => !runningVms.includes(vm.internalName) && vm.status !== 'stopped')
    .map((vm) => vm.id);

  if (runningVmIds.length > 0) {
    console.log(`Updating ${runningVmIds.length} VMs to running`);
    await prisma.machine.updateMany({
      where: { id: { in: runningVmIds } },
      data: { status: 'running' },
    });
  }

  if (stoppedVmIds.length > 0) {
    console.log(`Updating ${stoppedVmIds.length} VMs to stopped`);
    await prisma.machine.updateMany({
      where: { id: { in: stoppedVmIds } },
      data: { status: 'stopped' },
    });
  }

  conn.close();
  prisma.$disconnect();
});

export default UpdateVmStatusJob;