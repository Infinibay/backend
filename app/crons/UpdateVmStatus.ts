// Every minute:
// * fetch all running vms with libvirt-node
// * Update all vm to not running if they are not found in the list
// * Update all vm to running if they are found in the list
import { CronJob } from 'cron'
// libvirt-node
import { Connection, Machine } from 'libvirt-node'
import prisma from '../utils/database'

async function getRunningDomainNames (): Promise<string[]> {
  try {
    const conn = Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to open connection to libvirt')
    }

    try {
      // Get all domains
      const domains = await conn.listAllDomains(16) // 16 == running
      if (!domains || domains.length === 0) {
        return []
      }

      return domains.map((domain) => domain.getName() || '')
    } finally {
      conn.close()
    }
  } catch (error) {
    console.error('Error in getRunningDomainNames:', error)
    return []
  }
}

const UpdateVmStatusJob = new CronJob('*/1 * * * *', async () => {
  try {
    // Get list of running VMs from libvirt
    const runningVms = await getRunningDomainNames()

    // Get all VMs from database
    const allVms = await prisma.machine.findMany({
      select: {
        id: true,
        internalName: true,
        status: true
      }
    })

    // Find VMs that need status updates
    const runningVmIds = allVms
      .filter((vm) =>
        runningVms.includes(vm.internalName) &&
                vm.status !== 'running'
      )
      .map((vm) => vm.id)

    const stoppedVmIds = allVms
      .filter((vm) =>
        !runningVms.includes(vm.internalName) &&
                vm.status !== 'stopped' &&
                vm.status !== 'failed' // Don't update failed VMs
      )
      .map((vm) => vm.id)

    // Update running VMs
    if (runningVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: runningVmIds } },
        data: { status: 'running' }
      })
    }

    // Update stopped VMs
    if (stoppedVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: stoppedVmIds } },
        data: { status: 'stopped' }
      })
    }
  } catch (error) {
    console.error('Error in UpdateVmStatusJob:', error)
  }
})

export default UpdateVmStatusJob
