import si from 'systeminformation'
import { PrismaClient } from '@prisma/client'
import { Debugger } from './debug'

const debug = new Debugger('gpu-affinity')

/**
 * Checks existing GPU assignments at startup and removes stale assignments.
 *
 * With infinization, VMs are not "defined" in libvirt - they're QEMU processes
 * managed directly. So we only need to update the database, and the VM will
 * pick up the updated configuration on the next start.
 */
export async function checkGpuAffinity (prisma: PrismaClient): Promise<void> {
  const assignments = await prisma.machineConfiguration.findMany({
    where: { assignedGpuBus: { not: null } },
    select: { machineId: true, assignedGpuBus: true }
  })

  if (!assignments.length) {
    debug.log('No GPU assignments found')
    return
  }

  debug.log(`Found ${assignments.length} GPU assignments to verify`)

  const controllers = (await si.graphics()).controllers
  const availableBuses = controllers.map(
    c => c.pciBus || `00000000:${c.busAddress}`
  )

  debug.log(`Available GPU buses: ${availableBuses.join(', ')}`)

  for (const { machineId, assignedGpuBus } of assignments) {
    if (assignedGpuBus && !availableBuses.includes(assignedGpuBus)) {
      debug.log('warn', `GPU ${assignedGpuBus} not found for VM ${machineId}, removing assignment`)

      // Remove stale assignment from database
      // The VM will pick up this change on next start
      await prisma.machineConfiguration.update({
        where: { machineId },
        data: { assignedGpuBus: null }
      })

      debug.log(`Removed stale GPU assignment for VM ${machineId}`)
    }
  }

  debug.log('GPU affinity check completed')
}
