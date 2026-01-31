import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { getPackageManager } from '@services/packages/PackageManager'
import { PackageType, PackageCheckerType, PackageStatusType } from '../../types/PluginPackageTypes'
import * as fs from 'fs'
import * as path from 'path'
import Debug from 'debug'

const debug = Debug('infinibay:plugin-package-resolver')
const EXTERNAL_PACKAGES_DIR = '/var/infinibay/packages'

@Resolver()
export class PluginPackageResolver {
  /**
   * Maps Prisma Package to GraphQL PackageType
   */
  private mapPackageToGraphQL(
    pkg: {
      id: string
      name: string
      version: string
      displayName: string
      description: string | null
      author: string
      license: string
      isBuiltin: boolean
      isEnabled: boolean
      capabilities: unknown
      installedAt: Date
      updatedAt: Date
      checkers?: Array<{
        id: string
        name: string
        type: string
        dataNeeds: string[]
        isEnabled: boolean
      }>
    }
  ): PackageType {
    const result = new PackageType()
    result.id = pkg.id
    result.name = pkg.name
    result.version = pkg.version
    result.displayName = pkg.displayName
    result.description = pkg.description ?? undefined
    result.author = pkg.author
    result.license = pkg.license
    result.isBuiltin = pkg.isBuiltin
    result.isEnabled = pkg.isEnabled
    result.capabilities = pkg.capabilities as Record<string, unknown> | undefined
    result.installedAt = pkg.installedAt
    result.updatedAt = pkg.updatedAt
    result.checkers = (pkg.checkers || []).map(c => {
      const checker = new PackageCheckerType()
      checker.id = c.id
      checker.name = c.name
      checker.type = c.type
      checker.dataNeeds = c.dataNeeds
      checker.isEnabled = c.isEnabled
      return checker
    })
    return result
  }

  @Query(() => [PackageType], {
    description: 'List all installed plugin packages'
  })
  @Authorized('ADMIN')
  async packages(
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageType[]> {
    debug('Fetching all packages')

    const packages = await ctx.prisma.package.findMany({
      include: { checkers: true },
      orderBy: { name: 'asc' }
    })

    return packages.map(pkg => this.mapPackageToGraphQL(pkg))
  }

  @Query(() => PackageType, {
    nullable: true,
    description: 'Get a specific plugin package by name'
  })
  @Authorized('ADMIN')
  async package(
    @Arg('name') name: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageType | null> {
    debug('Fetching package: %s', name)

    const pkg = await ctx.prisma.package.findUnique({
      where: { name },
      include: { checkers: true }
    })

    if (!pkg) {
      return null
    }

    return this.mapPackageToGraphQL(pkg)
  }

  @Query(() => [PackageStatusType], {
    description: 'Get runtime status of all plugin packages'
  })
  @Authorized('ADMIN')
  async packageStatuses(
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageStatusType[]> {
    debug('Fetching package statuses')

    const pm = getPackageManager(ctx.prisma)
    const statuses = pm.getPackageStatuses()

    return statuses.map(s => {
      const status = new PackageStatusType()
      status.name = s.name
      status.version = s.version
      status.isLoaded = s.isLoaded
      status.isEnabled = s.isEnabled
      status.isBuiltin = s.isBuiltin
      status.checkerCount = s.checkerCount
      status.lastError = s.lastError
      return status
    })
  }

  @Mutation(() => PackageType, {
    nullable: true,
    description: 'Enable a plugin package'
  })
  @Authorized('ADMIN')
  async enablePackage(
    @Arg('name') name: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageType | null> {
    debug('Enabling package: %s', name)

    const pkg = await ctx.prisma.package.findUnique({ where: { name } })
    if (!pkg) {
      throw new Error(`Package not found: ${name}`)
    }

    const updated = await ctx.prisma.package.update({
      where: { name },
      data: { isEnabled: true },
      include: { checkers: true }
    })

    return this.mapPackageToGraphQL(updated)
  }

  @Mutation(() => PackageType, {
    nullable: true,
    description: 'Disable a plugin package'
  })
  @Authorized('ADMIN')
  async disablePackage(
    @Arg('name') name: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<PackageType | null> {
    debug('Disabling package: %s', name)

    const pkg = await ctx.prisma.package.findUnique({ where: { name } })
    if (!pkg) {
      throw new Error(`Package not found: ${name}`)
    }

    const updated = await ctx.prisma.package.update({
      where: { name },
      data: { isEnabled: false },
      include: { checkers: true }
    })

    return this.mapPackageToGraphQL(updated)
  }

  @Mutation(() => Boolean, {
    description: 'Uninstall an external plugin package (cannot uninstall built-in packages)'
  })
  @Authorized('ADMIN')
  async uninstallPackage(
    @Arg('name') name: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    debug('Uninstalling package: %s', name)

    const pkg = await ctx.prisma.package.findUnique({ where: { name } })
    if (!pkg) {
      throw new Error(`Package not found: ${name}`)
    }

    if (pkg.isBuiltin) {
      throw new Error('Cannot uninstall built-in packages')
    }

    // Delete from database (cascade will delete checkers)
    await ctx.prisma.package.delete({ where: { name } })

    // Delete package files
    const packagePath = path.join(EXTERNAL_PACKAGES_DIR, name)
    if (fs.existsSync(packagePath)) {
      fs.rmSync(packagePath, { recursive: true })
      debug('Deleted package directory: %s', packagePath)
    }

    return true
  }
}
