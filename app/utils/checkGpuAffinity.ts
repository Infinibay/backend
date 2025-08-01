import si from 'systeminformation'
import { PrismaClient } from '@prisma/client'
import { Machine as VirtualMachine } from 'libvirt-node'
import { CreateMachineService } from './VirtManager/createMachineService'

/**
 * Checks existing GPU assignments at startup and removes stale assignments.
 */
export async function checkGpuAffinity (prisma: PrismaClient): Promise<void> {
  const assignments = await prisma.machineConfiguration.findMany({
    where: { assignedGpuBus: { not: null } },
    select: { machineId: true, assignedGpuBus: true }
  })
  if (!assignments.length) {
    return
  }

  const controllers = (await si.graphics()).controllers
  const availableBuses = controllers.map(
    c => c.pciBus || `00000000:${c.busAddress}`
  )

  // Initialize VM service for redefinition
  const vmService = new CreateMachineService('qemu:///system', prisma)
  for (const { machineId, assignedGpuBus } of assignments) {
    if (assignedGpuBus && !availableBuses.includes(assignedGpuBus)) {
      console.warn(
        `GPU ${assignedGpuBus} not found for VM ${machineId}, removing assignment.`
      )
      // Remove stale assignment
      await prisma.machineConfiguration.update({
        where: { machineId },
        data: { assignedGpuBus: null }
      })

      // Fetch VM and regenerate XML without GPU
      const machine = await prisma.machine.findUnique({ where: { id: machineId } })
      const template = await prisma.machineTemplate.findUnique({ where: { id: machine?.templateId } })
      const config = await prisma.machineConfiguration.findUnique({ where: { machineId } })
      if (machine && template && config) {
        const xmlGenerator = await vmService.generateXML(
          machine,
          template,
          config,
          null,
          null
        )
        const xml = xmlGenerator.generate()
        try {
          // Undefine existing VM definition if exists
          const existingVm = VirtualMachine.lookupByName(vmService.libvirt!, machine.internalName)
          if (existingVm) {
            try {
              existingVm.undefine()
              console.log(`Undefining VM ${machine.internalName} before redefining.`)
            } catch (undefErr) {
              console.error(`Failed to undefine VM ${machine.internalName}:`, undefErr)
            }
          }
          VirtualMachine.defineXml(vmService.libvirt!, xml)
          console.log(`Redefined VM ${machine.internalName} without GPU.`)
        } catch (err) {
          console.error(`Failed to redefine VM ${machine.internalName}:`, err)
        }
      }
    }
  }
}
