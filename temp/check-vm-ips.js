const { PrismaClient } = require('@prisma/client');

async function checkVMIPs() {
  const prisma = new PrismaClient();

  try {
    const machines = await prisma.machine.findMany({
      select: {
        id: true,
        name: true,
        localIP: true,
        publicIP: true,
        status: true
      }
    });

    console.log('VMs encontradas:', machines.length);
    console.log('\nDetalles de las VMs:');

    machines.forEach(vm => {
      console.log(`\nVM: ${vm.name} (${vm.id})`);
      console.log(`  Status: ${vm.status}`);
      console.log(`  Local IP: ${vm.localIP || 'No disponible'}`);
      console.log(`  Public IP: ${vm.publicIP || 'No disponible'}`);
    });

    const vmsWithIP = machines.filter(vm => vm.localIP || vm.publicIP);
    console.log(`\nVMs con datos de IP: ${vmsWithIP.length}/${machines.length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkVMIPs();