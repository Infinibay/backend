import { PrismaClient } from '@prisma/client'
import {
  Arg,
  Authorized,
  Ctx,
  Mutation,
  Query,
  Resolver
} from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from 'apollo-server-errors'
import { MachineTemplateCategoryType, MachineTemplateCategoryInputType } from './type'

export interface MachineTemplateCategoryResolverInterface {
  machineTemplateCategories(ctx: InfinibayContext): Promise<MachineTemplateCategoryType[]>
  machineTemplateCategory(id: string, ctx: InfinibayContext): Promise<MachineTemplateCategoryType | null>
  createMachineTemplateCategory(input: MachineTemplateCategoryInputType, ctx: InfinibayContext): Promise<MachineTemplateCategoryType>
  updateMachineTemplateCategory(id: string, input: MachineTemplateCategoryInputType, ctx: InfinibayContext): Promise<MachineTemplateCategoryType>
}

@Resolver(_of => MachineTemplateCategoryType)
export class MachineTemplateCategoryResolver implements MachineTemplateCategoryResolverInterface {
  /**
   * Retrieves all machine template categories.
   *
   * @param {InfinibayContext} ctx - The Infinibay context.
   * @returns {Promise<MachineTemplateCategoryType[]>} An array of machine template category objects.
   */
  @Query(() => [MachineTemplateCategoryType])
  @Authorized('ADMIN')
  async machineTemplateCategories (
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateCategoryType[]> {
    const { prisma } = ctx
    const categories = await prisma.machineTemplateCategory.findMany()

    // Get counts for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        // Count templates in this category
        const templates = await prisma.machineTemplate.findMany({
          where: { categoryId: category.id }
        })

        // Count total machines using templates in this category
        const totalMachines = await prisma.machine.count({
          where: {
            templateId: {
              in: templates.map(t => t.id)
            }
          }
        })

        return {
          ...category,
          totalTemplates: templates.length,
          totalMachines
        }
      })
    )

    return categoriesWithCounts
  }

  /**
   * Retrieves a machine template category by id.
   *
   * @param {string} id - The id of the machine template category.
   * @param {InfinibayContext} ctx - The Infinibay context.
   * @returns {Promise<MachineTemplateCategoryType | null>} The machine template category object or null if not found.
   */
  @Query(() => MachineTemplateCategoryType, { nullable: true })
  @Authorized('ADMIN')
  async machineTemplateCategory (
    @Arg('id', { nullable: false }) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateCategoryType | null> {
    const { prisma } = ctx
    const category = await prisma.machineTemplateCategory.findUnique({
      where: { id }
    })

    if (!category) return null

    // Count templates in this category
    const templates = await prisma.machineTemplate.findMany({
      where: { categoryId: id }
    })

    // Count total machines using templates in this category
    const totalMachines = await prisma.machine.count({
      where: {
        templateId: {
          in: templates.map(t => t.id)
        }
      }
    })

    return {
      ...category,
      totalTemplates: templates.length,
      totalMachines
    }
  }

  /**
   * Creates a new machine template category.
   *
   * @param {MachineTemplateCategoryInputType} input - The input for creating a new category.
   * @param {InfinibayContext} ctx - The Infinibay context.
   * @throws {UserInputError} If a category with the same name already exists.
   * @returns {Promise<MachineTemplateCategoryType>} The created machine template category.
   */
  @Mutation(() => MachineTemplateCategoryType)
  @Authorized('ADMIN')
  async createMachineTemplateCategory (
    @Arg('input', () => MachineTemplateCategoryInputType) input: MachineTemplateCategoryInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateCategoryType> {
    const { prisma } = ctx

    await this.checkCategoryExistence(input.name, prisma)

    const createdCategory = await prisma.machineTemplateCategory.create({
      data: {
        name: input.name,
        description: input.description
      }
    })

    return createdCategory as MachineTemplateCategoryType
  }

  /**
   * Updates an existing machine template category.
   *
   * @param {string} id - The id of the category to update.
   * @param {MachineTemplateCategoryInputType} input - The input for updating the category.
   * @param {InfinibayContext} ctx - The Infinibay context.
   * @throws {UserInputError} If the category is not found or if a category with the new name already exists.
   * @returns {Promise<MachineTemplateCategoryType>} The updated machine template category.
   */
  @Mutation(() => MachineTemplateCategoryType)
  @Authorized('ADMIN')
  async updateMachineTemplateCategory (
    @Arg('id', { nullable: false }) id: string,
    @Arg('input', () => MachineTemplateCategoryInputType) input: MachineTemplateCategoryInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateCategoryType> {
    const { prisma } = ctx

    const exists = await this.categoryExists(prisma, id)
    if (!exists) {
      throw new UserInputError('Machine template category not found')
    }

    if (input.name) {
      await this.checkCategoryExistence(input.name, prisma, id)
    }

    return this.updateCategoryInDb(prisma, id, input)
  }

  private async checkCategoryExistence (name: string, prisma: PrismaClient, excludeId?: string) {
    const existingCategory = await prisma.machineTemplateCategory.findFirst({
      where: {
        name,
        id: { not: excludeId }
      }
    })
    if (existingCategory) {
      throw new UserInputError('Machine template category with this name already exists')
    }
  }

  private async categoryExists (prisma: PrismaClient, id: string): Promise<boolean> {
    return !!(await prisma.machineTemplateCategory.findUnique({ where: { id } }))
  }

  private async updateCategoryInDb (prisma: PrismaClient, id: string, input: MachineTemplateCategoryInputType): Promise<MachineTemplateCategoryType> {
    return prisma.machineTemplateCategory.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description && { description: input.description })
      }
    })
  }
}
