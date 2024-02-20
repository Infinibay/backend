import { PrismaClient } from '@prisma/client'
import {
  Arg,
  Authorized,
  Mutation,
  Query,
  Resolver,
} from "type-graphql"
import { Ctx } from 'type-graphql';
import { InfinibayContext } from "@utils/context";

import { DyummyType } from "./type";

export interface SetupResolverInterface {
  setupNode(ctx: InfinibayContext): Promise<DyummyType>
  checkSetupStatus(ctx: InfinibayContext): Promise<DyummyType>
}

export class SetupResolver implements SetupResolverInterface {
  @Mutation(() => DyummyType)
  @Authorized('SETUP_MODE')
  async setupNode(
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


    return {
      value: 'dummy',
    };
  }

  @Query(() => DyummyType)
  @Authorized('SETUP_MODE')
  async checkSetupStatus(
    @Ctx() ctx: InfinibayContext
  ): Promise<DyummyType> {
    return {
      value: 'dummy',
    };
  }

}
