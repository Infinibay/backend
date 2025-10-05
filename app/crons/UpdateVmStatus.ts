// Every minute:
// * fetch all running vms with libvirt-node
// * Update all vm to not running if they are not found in the list
// * Update all vm to running if they are found in the list
import { CronJob } from 'cron'
// libvirt-node
import { Connection } from '@infinibay/libvirt-node'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'
import { getVMHealthQueueManager } from '../services/VMHealthQueueManager'

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
    // Get singleton instances
    const eventManager = getEventManager()
    const queueManager = getVMHealthQueueManager(prisma, eventManager)

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

      // Emit update events for each VM that became running
      for (const vmId of runningVmIds) {
        try {
          // Fetch complete VM data to send in the event
          const vm = await prisma.machine.findUnique({
            where: { id: vmId },
            include: {
              user: true,
              template: true,
              department: true,
              configuration: true
            }
          })
          if (vm) {
            await eventManager.dispatchEvent('vms', 'update', vm)
            console.log(`🎯 VM status update: ${vm.name} (${vmId}) -> running`)

            // Trigger queue processing for newly running VM
            try {
              await queueManager.processQueue(vmId)
            } catch (error) {
              console.error(`🗂️ Failed to process health queue for newly running VM ${vm.name} (${vmId}):`, error)
            }
          }
        } catch (error) {
          console.error(`Failed to emit update event for VM ${vmId}:`, error)
        }
      }
    }

    // Update stopped VMs
    if (stoppedVmIds.length > 0) {
      await prisma.machine.updateMany({
        where: { id: { in: stoppedVmIds } },
        data: { status: 'stopped' }
      })

      // Emit update events for each VM that became stopped
      for (const vmId of stoppedVmIds) {
        try {
          // Fetch complete VM data to send in the event
          const vm = await prisma.machine.findUnique({
            where: { id: vmId },
            include: {
              user: true,
              template: true,
              department: true,
              configuration: true
            }
          })
          if (vm) {
            await eventManager.dispatchEvent('vms', 'update', vm)
            console.log(`🎯 VM status update: ${vm.name} (${vmId}) -> stopped`)
          }
        } catch (error) {
          console.error(`Failed to emit update event for VM ${vmId}:`, error)
        }
      }
    }
  } catch (error) {
    console.error('Error in UpdateVmStatusJob:', error)
  }
})

export default UpdateVmStatusJob
