import {
  Arg,
  Authorized,
  Mutation,
  Query,
  Resolver
  , Ctx
} from 'type-graphql'
import bcrypt from 'bcrypt'
import { InfinibayContext, requireUser } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { invalidateSetupCache } from '@utils/setupState'
import { LocalNodeRegistrationService } from '@services/node/LocalNodeRegistrationService'

import { DyummyType, SetupStatusType, SetupStepType } from './type'

const APP_SETTINGS_ID = 'default-settings'
// Matches the production admin-seed policy (validateAdminSeedPassword).
const MIN_ADMIN_PASSWORD_LENGTH = 12

export interface SetupResolverInterface {
  setupNode(ctx: InfinibayContext): Promise<DyummyType>
  checkSetupStatus(ctx: InfinibayContext): Promise<DyummyType>
  setupStatus(ctx: InfinibayContext): Promise<SetupStatusType>
  completeSetup(ctx: InfinibayContext): Promise<SetupStatusType>
  setupChangeAdminPassword(newPassword: string, ctx: InfinibayContext): Promise<SetupStatusType>
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

  /**
   * First-run setup status. PUBLIC by design: the frontend redirect gate reads
   * it both before login (while setup is open) and afterwards (to bounce /setup
   * back into the app once closed). It exposes only whether setup is complete and
   * which steps remain — no sensitive data.
   */
  @Query(() => SetupStatusType)
  async setupStatus (
    @Ctx() ctx: InfinibayContext
  ): Promise<SetupStatusType> {
    return await buildSetupStatus(ctx.prisma)
  }

  /**
   * Close first-run setup. Requires an authenticated admin (the first admin logs
   * in during /setup). Refuses while the insecure dev-default admin password is
   * still in place, so the operator cannot ship a system reachable with
   * admin@example.com / password.
   */
  @Mutation(() => SetupStatusType)
  @Authorized('ADMIN')
  async completeSetup (
    @Ctx() ctx: InfinibayContext
  ): Promise<SetupStatusType> {
    const settings = await ctx.prisma.appSettings.findUnique({
      where: { id: APP_SETTINGS_ID },
      select: { setupCompleted: true, devModeAdmin: true }
    })

    if (settings?.setupCompleted) {
      // Idempotent: already closed.
      return await buildSetupStatus(ctx.prisma)
    }

    if (settings?.devModeAdmin) {
      throw new UserInputError('Change the default administrator password before finishing setup.')
    }

    await ctx.prisma.appSettings.update({
      where: { id: APP_SETTINGS_ID },
      data: {
        setupCompleted: true,
        setupPhase: 'completed',
        setupCompletedAt: new Date()
      }
    })
    // Close the setupMode window immediately (don't wait for the cache TTL).
    invalidateSetupCache()

    return await buildSetupStatus(ctx.prisma)
  }

  /**
   * Change the authenticated admin's password during first-run setup and clear
   * the `devModeAdmin` flag atomically. Used by /setup Step 0 when the system was
   * bootstrapped with the insecure dev-default credentials. No current-password
   * check: the caller is already an authenticated admin and is being *forced* to
   * replace the known-weak default.
   */
  @Mutation(() => SetupStatusType)
  @Authorized('ADMIN')
  async setupChangeAdminPassword (
    @Arg('newPassword') newPassword: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<SetupStatusType> {
    const user = requireUser(ctx)

    if (!newPassword || newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      throw new UserInputError(`Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`)
    }
    if (newPassword === 'password') {
      throw new UserInputError('Choose a password other than the default.')
    }

    const hashed = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || '10', 10))

    await ctx.prisma.$transaction([
      ctx.prisma.user.update({ where: { id: user.id }, data: { password: hashed } }),
      ctx.prisma.appSettings.update({ where: { id: APP_SETTINGS_ID }, data: { devModeAdmin: false } })
    ])

    return await buildSetupStatus(ctx.prisma)
  }
}

/** Assemble the SetupStatus payload (status + the onboarding step checklist). */
async function buildSetupStatus (prisma: InfinibayContext['prisma']): Promise<SetupStatusType> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: APP_SETTINGS_ID },
    select: { setupCompleted: true, setupPhase: true, devModeAdmin: true }
  })

  const isoCount = await prisma.iSO.count({ where: { isAvailable: true } }).catch(() => 0)

  const status = new SetupStatusType()
  status.completed = settings?.setupCompleted ?? false
  status.phase = settings?.setupPhase ?? 'pending'
  status.devModeAdmin = settings?.devModeAdmin ?? false
  status.steps = [
    step('admin_password', 'Set a secure administrator password', !status.devModeAdmin),
    step('permissions', 'Review group permissions', true),
    step('users', 'Create additional users', true),
    step('isos', 'Install at least one OS image (ISO)', isoCount > 0),
    step('migration', 'Choose the migration mode', true)
  ]
  return status
}

function step (key: string, label: string, done: boolean): SetupStepType {
  const s = new SetupStepType()
  s.key = key
  s.label = label
  s.done = done
  return s
}
