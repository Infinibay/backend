import {
  Authorized,
  Mutation,
  Query,
  Resolver
  , Ctx
} from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { LocalNodeRegistrationService } from '@services/node/LocalNodeRegistrationService'

import { DyummyType } from './type'

export interface SetupResolverInterface {
  setupNode(ctx: InfinibayContext): Promise<DyummyType>
  checkSetupStatus(ctx: InfinibayContext): Promise<DyummyType>
}

@Resolver()
export class SetupResolver implements SetupResolverInterface {
  @Mutation(() => DyummyType)
  @Authorized('SETUP_MODE')
  async setupNode (
    @Ctx() ctx: InfinibayContext
  ): Promise<DyummyType> {
    /*
    Step:
    1. Check if the node is already setup
    2. If not:
    3. Detect the node hardware (cpu flags, cores, ram, storage)
    4. Detect all the disks (hdd,ssd and nvme) but not the usb drives
    5. Create the adecuated Btrfs Raid level acoording to the number of disks (raid10 for 4 disks, raid5 for 3 disks, raid6 for 2 disks)
       and mount it in /mnt/storage
    6. TODO: Check if there are other nodes in the network
    7. TODO: Connect to the other nodes and create a cluster if there is another node
    8. Create a postgresql database in the new btrfs volume (/mnt/storage/postgres)
    9. Migrate prisma schema to the new database
    10. TODO: Import the main admin user from /user.json.p7m
     */

    const service = new LocalNodeRegistrationService(ctx.prisma)
    const node = await service.registerLocalNode()

    return {
      value: node.id
    }
  }

  @Query(() => DyummyType)
  @Authorized('SETUP_MODE')
  async checkSetupStatus (
    @Ctx() ctx: InfinibayContext
  ): Promise<DyummyType> {
    const nodes = await ctx.prisma.node.count()

    return {
      value: nodes > 0 ? 'configured' : 'not_configured'
    }
  }
}
