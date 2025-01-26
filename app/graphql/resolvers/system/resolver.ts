import { Resolver, Query } from 'type-graphql';
import si from 'systeminformation';
import { GPU } from './type';

@Resolver()
export class SystemResolver {
  @Query(() => [GPU])
  async getGraphics(): Promise<GPU[]> {
    try {
      const data = (await si.graphics()).controllers;
      return data.map(controller => ({
        pciBus: controller.pciBus || `00000000:${controller.busAddress}` || '',
        vendor: controller.vendor,
        model: controller.name || controller.model,
        memory: (controller.vram || 0) / 1024  // Convert MB to GB
      }));
    } catch (error) {
      return [];
    }
  }
}