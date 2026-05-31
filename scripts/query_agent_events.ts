import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // Most recent VMs first
  const recent = await prisma.machine.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, name: true, createdAt: true, status: true },
  });
  console.log('=== Recent VMs ===');
  for (const m of recent) {
    console.log(`${m.createdAt.toISOString()}  ${m.id}  ${m.name}  status=${m.status}`);
  }

  if (recent[0]) {
    const vmId = recent[0].id;
    console.log(`\n=== Stuck script executions for ${recent[0].name} ===`);
    const execs = await prisma.scriptExecution.findMany({
      where: { machineId: vmId },
      include: { script: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    for (const e of execs) {
      console.log(`${e.status.padEnd(10)} ${e.script.name}  startedAt=${e.startedAt?.toISOString() || '-'}  exitCode=${e.exitCode ?? '-'}`);
    }

    console.log(`\n=== Agent events for ${recent[0].name} ===`);
    const events = await prisma.agentEvent.findMany({
      where: { machineId: vmId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    if (events.length === 0) {
      console.log('(none)');
    } else {
      for (const ev of events) {
        console.log(`${ev.severity.padEnd(5)} [${ev.source}]  exec=${ev.executionId ?? '-'}  ${ev.message}`);
      }
    }
  }

  await prisma.$disconnect();
})();
