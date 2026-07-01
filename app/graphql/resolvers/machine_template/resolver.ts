import { PrismaClient, Prisma } from '@prisma/client'
import {
  Arg,
  Mutation,
  Query,
  Resolver,
  Ctx
} from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { MachineTemplateType, MachineTemplateOrderBy, MachineTemplateInputType } from './type'
import { PaginationInputType } from '@utils/pagination'
import { Can } from '@main/permissions'

export interface MachineTemplateResolverInterface {
  machineTemplates(pagination: PaginationInputType | undefined, orderBy: MachineTemplateOrderBy | undefined, ctx: InfinibayContext): Promise<MachineTemplateType[]>
  createMachineTemplate(input: MachineTemplateInputType, ctx: InfinibayContext): Promise<MachineTemplateType>
  updateMachineTemplate(id: string, input: MachineTemplateInputType, ctx: InfinibayContext): Promise<MachineTemplateType>
  destroyMachineTemplate(id: string, ctx: InfinibayContext): Promise<boolean>
  destroyMachineTemplateCategory(id: string, ctx: InfinibayContext): Promise<boolean>
}

const MAX_CORES = 64
const MIN_CORES = 1
const MAX_RAM = 512
const MIN_RAM = 1
const MAX_STORAGE = 1024
const MIN_STORAGE = 1

// Server-side cap on the number of rows a single machineTemplates page may
// return, so an unbounded `take` can't be used to exhaust the DB pool / heap.
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 10

// Documented allowlists for the free-form template string fields (see type.ts).
// These values later drive guest provisioning (install pipeline routing and
// FIRST_BOOT script inputs), so they are validated at the trust boundary.
const VALID_OS_TYPES = ['windows10', 'windows11', 'ubuntu', 'fedora']
const VALID_POWER_PLANS = ['balanced', 'high-performance', 'power-saver']
const MAX_WALLPAPER_URL_LENGTH = 1024

@Resolver(() => MachineTemplateType)
export class MachineTemplateResolver implements MachineTemplateResolverInterface {
  /**
   * Retrieves a machine template by id.
   *
   * @param {string} id - The id of the machine template.
   * @param {InfinibayContext} ctx - The Infinibay context.
   *
   * @returns {Promise<MachineTemplateType | null>} The machine template object or null if not found.
   */
  @Query(() => MachineTemplateType, { nullable: true })
  @Can('machineTemplate:view', { id: (a) => a.id })
  async machineTemplate (
    @Arg('id', { nullable: false }) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType | null> {
    const machineTemplate = await ctx.prisma.machineTemplate.findUnique({
      where: { id },
      include: {
        category: true,
        applications: { include: { application: true } },
        scripts: { include: { script: true }, orderBy: { order: 'asc' } }
      }
    })
    // we need to count the number of machines using this template
    const totalMachines = await ctx.prisma.machine.count({
      where: { templateId: id }
    })
    if (!machineTemplate) return null
    const response : MachineTemplateType = {
      ...machineTemplate,
      totalMachines,
      applications: machineTemplate.applications.map((link) => ({
        applicationId: link.applicationId,
        name: link.application.name,
        parameters: (link.parameters as Record<string, unknown> | null) ?? undefined
      })),
      scripts: machineTemplate.scripts.map((link) => ({
        scriptId: link.scriptId,
        name: link.script.name,
        order: link.order,
        inputValues: (link.inputValues as Record<string, unknown> | null) ?? undefined
      }))
    }
    return response
  }

  /**
   * Retrieves the machine templates with pagination and order by options.
   *
   * @param {PaginationInputType} pagination - The pagination input options.
   * @param {MachineTemplateOrderBy} orderBy - The ordering options for machine templates.
   * @param {InfinibayContext} ctx - The context object containing the Prisma instance.
   * @returns {Promise<MachineTemplateType[]>} - An array of machine template objects.
   */
  @Query(() => [MachineTemplateType])
  @Can('machineTemplate:view')
  async machineTemplates (
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
    @Arg('orderBy', { nullable: true }) orderBy: MachineTemplateOrderBy,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType[]> {
    const { prisma } = ctx
    const order = this.resolveOrder(orderBy)
    const skip = this.resolveSkip(pagination)
    const take = this.resolveTake(pagination)

    const machineTemplates = await prisma.machineTemplate.findMany({
      orderBy: order,
      skip,
      take,
      include: {
        category: true,
        applications: { include: { application: true } },
        scripts: { include: { script: true }, orderBy: { order: 'asc' } }
      }
    })

    // Get the count of machines for each template
    const templatesWithCount = await Promise.all(
      machineTemplates.map(async (template) => {
        const totalMachines = await prisma.machine.count({
          where: { templateId: template.id }
        })
        return {
          ...template,
          totalMachines,
          applications: template.applications.map((link) => ({
            applicationId: link.applicationId,
            name: link.application.name,
            parameters: (link.parameters as Record<string, unknown> | null) ?? undefined
          })),
          scripts: template.scripts.map((link) => ({
            scriptId: link.scriptId,
            name: link.script.name,
            order: link.order,
            inputValues: (link.inputValues as Record<string, unknown> | null) ?? undefined
          }))
        }
      })
    )

    return templatesWithCount
  }

  private resolveOrder (orderBy: MachineTemplateOrderBy | undefined) {
    if (orderBy && orderBy.fieldName && orderBy.direction) {
      return {
        [orderBy.fieldName as keyof MachineTemplateType]: orderBy.direction
      }
    }
    return undefined
  }

  private resolveSkip (pagination: PaginationInputType | undefined) {
    // Clamp to a non-negative value so a negative skip never reaches Prisma
    // (which would otherwise throw a raw validation error leaked to the client).
    return Math.max(0, pagination?.skip ?? 0)
  }

  private resolveTake (pagination: PaginationInputType | undefined) {
    // Cap the page size server-side: an unbounded take lets an authenticated
    // caller load every row and fire one machine.count per row, exhausting the
    // connection pool / heap. Also fixes take=0 previously falling back to the
    // default instead of being treated as an at-least-one page.
    return Math.min(Math.max(1, pagination?.take ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  }

  /**
   * Create a machine template
   *
   * @param {MachineTemplateInputType} input - The input object for creating a machine template
   * @param {InfinibayContext} ctx - The context object for the session
   *
   * @throws {UserInputError} - If the machine template already exists, or if the cores, RAM, or storage is out of range
   *
   * @returns {Promise<MachineTemplateType>} - The created machine template
   */
  @Mutation(() => MachineTemplateType)
  @Can('machineTemplate:create')
  async createMachineTemplate (
    @Arg('input', { nullable: false }) input: MachineTemplateInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType> {
    const { prisma } = ctx

    await this.checkMachineTemplateExistence(input.name, prisma)

    this.checkConstraintValidity(input.cores, MIN_CORES, MAX_CORES, 'Cores must be between 1 and 64')
    this.checkConstraintValidity(input.ram, MIN_RAM, MAX_RAM, 'RAM must be between 1 and 512')
    this.checkConstraintValidity(input.storage, MIN_STORAGE, MAX_STORAGE, 'Storage must be between 1 and 1024')
    this.checkTemplateInputValidity(input)
    await this.checkReferencesExist(prisma, input)

    const createdMachineTemplate = await prisma.machineTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        cores: input.cores,
        ram: input.ram,
        storage: input.storage,
        categoryId: input.categoryId,
        osType: input.osType ?? null,
        wallpaperUrl: input.wallpaperUrl ?? null,
        powerPlan: input.powerPlan ?? null,
        encryptDisk: input.encryptDisk ?? false,
        applications: input.applications && input.applications.length > 0
          ? {
            create: input.applications.map((a) => ({
              applicationId: a.applicationId,
              parameters: (a.parameters ?? Prisma.JsonNull) as Prisma.InputJsonValue
            }))
          }
          : undefined,
        scripts: input.scripts && input.scripts.length > 0
          ? {
            create: input.scripts.map((s, i) => ({
              scriptId: s.scriptId,
              order: s.order ?? i,
              inputValues: (s.inputValues ?? Prisma.JsonNull) as Prisma.InputJsonValue
            }))
          }
          : undefined
      },
      include: { category: true }
    })

    return createdMachineTemplate as MachineTemplateType
  }

  // Method for checking if machine template exists
  checkMachineTemplateExistence = async (name: string, prisma: PrismaClient) => {
    const existingTemplate = await prisma.machineTemplate.findFirst({
      where: { name }
    })
    if (existingTemplate) {
      throw new UserInputError('Machine template already exists')
    }
  }

  // Method for verifying the constraints on cores, RAM, and storage
  checkConstraintValidity (value: number, min: number, max: number, errorMsg: string) {
    if (value < min || value > max) {
      throw new UserInputError(errorMsg)
    }
  }

  // Validate the free-form string fields against their documented allowlists
  // before they are persisted and later fed into guest provisioning. osType
  // routes the install pipeline (a garbage value silently mis-provisions the
  // VM); wallpaperUrl/powerPlan are injected verbatim as FIRST_BOOT script
  // inputs. Nullable fields are only checked when actually provided so legacy
  // blueprints (and partial updates that omit them) keep working unchanged.
  checkTemplateInputValidity = (input: MachineTemplateInputType): void => {
    if (input.osType != null && !VALID_OS_TYPES.includes(input.osType)) {
      throw new UserInputError('Invalid osType')
    }
    if (input.powerPlan != null && !VALID_POWER_PLANS.includes(input.powerPlan)) {
      throw new UserInputError('Invalid powerPlan')
    }
    if (input.wallpaperUrl != null) {
      // Reject control characters (incl. newlines) so the value cannot break out
      // of the guest script input it is later interpolated into, and cap length.
      if (input.wallpaperUrl.length > MAX_WALLPAPER_URL_LENGTH || this.hasControlChar(input.wallpaperUrl)) {
        throw new UserInputError('Invalid wallpaperUrl')
      }
    }
  }

  private hasControlChar (value: string): boolean {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code < 0x20 || code === 0x7f) return true
    }
    return false
  }

  // Verify the foreign-key references (category / applications / scripts) exist
  // before persisting, so a bogus id surfaces as a clean UserInputError instead
  // of a raw Prisma P2003 foreign-key error (which leaks DB schema internals).
  checkReferencesExist = async (prisma: PrismaClient, input: MachineTemplateInputType): Promise<void> => {
    if (input.categoryId) {
      const categoryCount = await prisma.machineTemplateCategory.count({ where: { id: input.categoryId } })
      if (!categoryCount) {
        throw new UserInputError('Category not found')
      }
    }

    const appIds = input.applications?.map((a) => a.applicationId) ?? []
    if (appIds.length > 0) {
      const distinctAppIds = new Set(appIds)
      const foundApps = await prisma.application.count({ where: { id: { in: [...distinctAppIds] } } })
      if (foundApps !== distinctAppIds.size) {
        throw new UserInputError('One or more applications not found')
      }
    }

    const scriptIds = input.scripts?.map((s) => s.scriptId) ?? []
    if (scriptIds.length > 0) {
      const distinctScriptIds = new Set(scriptIds)
      const foundScripts = await prisma.script.count({ where: { id: { in: [...distinctScriptIds] } } })
      if (foundScripts !== distinctScriptIds.size) {
        throw new UserInputError('One or more scripts not found')
      }
    }
  }

  /**
   * Updates a machine template with the specified ID.
   *
   * @param {string} id - The ID of the machine template to update. (Required)
   * @param {MachineTemplateInputType} input - The updated information of the machine template. (Required)
   * @param {InfinibayContext} ctx - The context object containing the Prisma client. (Required)
   * @returns {Promise<MachineTemplateType>} - The updated machine template.
   * @throws {UserInputError} - If the machine template with the specified ID is not found.
   */
  @Mutation(() => MachineTemplateType)
  @Can('machineTemplate:edit', { id: (a) => a.id })
  async updateMachineTemplate (
    @Arg('id', { nullable: false }) id: string,
    @Arg('input', { nullable: false }) input: MachineTemplateInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType> {
    const { prisma } = ctx

    // Ensure the machine template exists before updating
    const exists = await this.machineTemplateExists(prisma, id)
    if (!exists) {
      throw new UserInputError('Machine template not found')
    }

    // Check for constraints
    this.checkConstraintValidity(input.cores, MIN_CORES, MAX_CORES, 'Cores must be between 1 and 64')
    this.checkConstraintValidity(input.ram, MIN_RAM, MAX_RAM, 'RAM must be between 1 and 512')
    this.checkConstraintValidity(input.storage, MIN_STORAGE, MAX_STORAGE, 'Storage must be between 1 and 1024')
    this.checkTemplateInputValidity(input)
    await this.checkReferencesExist(prisma, input)

    // Use a single call to update the machineTemplate, no need to update properties one-by-one
    return await this.updateMachineTemplateInDb(prisma, id, input)
  }

  machineTemplateExists = async (prisma: PrismaClient, id: string): Promise<boolean> => {
    return !!(await prisma.machineTemplate.findUnique({ where: { id } }))
  }

  updateMachineTemplateInDb = async (prisma: PrismaClient, id: string, input: MachineTemplateInputType): Promise<MachineTemplateType> => {
    // Joins are updated via replace semantics — the GraphQL input is the
    // source of truth for the whole set of apps/scripts, so we wipe and
    // re-create inside a transaction.
    return await prisma.$transaction(async (tx) => {
      if (input.applications !== undefined) {
        await tx.machineTemplateApplication.deleteMany({ where: { templateId: id } })
        if (input.applications.length > 0) {
          await tx.machineTemplateApplication.createMany({
            data: input.applications.map((a) => ({
              templateId: id,
              applicationId: a.applicationId,
              parameters: (a.parameters ?? Prisma.JsonNull) as Prisma.InputJsonValue
            }))
          })
        }
      }
      if (input.scripts !== undefined) {
        await tx.machineTemplateScript.deleteMany({ where: { templateId: id } })
        if (input.scripts.length > 0) {
          await tx.machineTemplateScript.createMany({
            data: input.scripts.map((s, i) => ({
              templateId: id,
              scriptId: s.scriptId,
              order: s.order ?? i,
              inputValues: (s.inputValues ?? Prisma.JsonNull) as Prisma.InputJsonValue
            }))
          })
        }
      }
      return await tx.machineTemplate.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          cores: input.cores,
          ram: input.ram,
          storage: input.storage,
          categoryId: input.categoryId,
          // osType is the source of truth for VM creation. It is only set on
          // create when omitted on update (legacy rows), but if the caller
          // provides one we honour it so blueprints created before the column
          // existed can be back-filled through the edit form.
          ...(input.osType !== undefined ? { osType: input.osType ?? null } : {}),
          wallpaperUrl: input.wallpaperUrl ?? null,
          powerPlan: input.powerPlan ?? null,
          // Previously omitted — toggling disk encryption on an existing
          // blueprint silently did nothing. Persist it like create does, but
          // only when the caller actually sends it: an unconditional `?? false`
          // would silently disable encryption on any partial update that omits
          // the field.
          ...(input.encryptDisk !== undefined ? { encryptDisk: input.encryptDisk } : {})
        },
        include: { category: true }
      })
    })
  }

  /**
   * Deletes a machine template if it's not being used by any machines
   *
   * @param {string} id - The ID of the machine template to delete
   * @param {InfinibayContext} ctx - The Infinibay context
   * @returns {Promise<boolean>} - True if deletion was successful, throws error otherwise
   */
  @Mutation(() => Boolean)
  @Can('machineTemplate:delete', { id: (a) => a.id })
  async destroyMachineTemplate (
    @Arg('id', { nullable: false }) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = ctx

    // Check if template exists
    const template = await prisma.machineTemplate.findUnique({
      where: { id }
    })

    if (!template) {
      throw new UserInputError('Machine template not found')
    }

    // Check if template is in use
    const machineCount = await prisma.machine.count({
      where: { templateId: id }
    })

    if (machineCount > 0) {
      throw new UserInputError('Cannot delete template while it is being used by machines')
    }

    // Delete the template
    await prisma.machineTemplate.delete({
      where: { id }
    })

    return true
  }

  /**
   * Deletes a machine template category if it's not being used by any templates
   *
   * @param {string} id - The ID of the category to delete
   * @param {InfinibayContext} ctx - The Infinibay context
   * @returns {Promise<boolean>} - True if deletion was successful, throws error otherwise
   */
  @Mutation(() => Boolean)
  @Can('machineTemplateCategory:delete', { id: (a) => a.id })
  async destroyMachineTemplateCategory (
    @Arg('id', { nullable: false }) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma } = ctx

    // Check if category exists
    const category = await prisma.machineTemplateCategory.findUnique({
      where: { id }
    })

    if (!category) {
      throw new UserInputError('Machine template category not found')
    }

    // Check if category is in use
    const templateCount = await prisma.machineTemplate.count({
      where: { categoryId: id }
    })

    if (templateCount > 0) {
      throw new UserInputError('Cannot delete category while it is being used by templates')
    }

    // Delete the category
    await prisma.machineTemplateCategory.delete({
      where: { id }
    })

    return true
  }
}
