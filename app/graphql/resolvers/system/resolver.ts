import { Resolver, Query, Ctx } from 'type-graphql'
import si from 'systeminformation'
import { GPU } from './type'
import { InfinibayContext } from '../../../utils/context'

@Resolver()
export class SystemResolver {
  @Query(() => [GPU])
  async getGraphics (@Ctx() { prisma }: InfinibayContext): Promise<GPU[]> {
    try {
      // Fetch already assigned GPU buses
      const assignments = await prisma.machineConfiguration.findMany({
        where: { assignedGpuBus: { not: null } },
        select: { assignedGpuBus: true }
      })
      const usedBuses = assignments.map(a => a.assignedGpuBus!).filter(Boolean)
      // Get all GPU controllers
      const controllers = (await si.graphics()).controllers
      // Filter out GPUs in use
      const available = controllers.filter(ctrl => {
        const bus = ctrl.pciBus || `00000000:${ctrl.busAddress}` || ''
        return !usedBuses.includes(bus)
      })
      // Map to GraphQL type
      return available.map(controller => ({
        pciBus: controller.pciBus || `00000000:${controller.busAddress}` || '',
        vendor: controller.vendor,
        model: controller.name || controller.model,
        memory: (controller.vram || 0) / 1024 // Convert MB to GB
      }))
    } catch (error) {
      return []
    }
  }
}
