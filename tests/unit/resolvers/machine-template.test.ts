import 'reflect-metadata'
import { MachineTemplateResolver } from '@resolvers/machine_template/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createMockMachineTemplate,
  createMockMachineTemplateCategory,
  createMockMachines
} from '../../setup/mock-factories'
import { createAdminContext } from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-errors'

describe('MachineTemplateResolver', () => {
  let resolver: MachineTemplateResolver
  const ctx = createAdminContext()

  beforeEach(() => {
    resolver = new MachineTemplateResolver()
    jest.clearAllMocks()
  })

  describe('Query: machineTemplate', () => {
    it('should return template by id with relations', async () => {
      const category = createMockMachineTemplateCategory()
      const template = createMockMachineTemplate({ categoryId: category.id })
      const machines = createMockMachines(2).map(m => ({ ...m, templateId: template.id }))

      const templateWithRelations = {
        ...template,
        category,
        machines
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithRelations)

      const result = await resolver.machineTemplate(template.id, ctx)

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: template.id },
        include: {
          category: true,
          machines: true
        }
      })
      expect(result).toEqual(templateWithRelations)
    })

    it('should return null if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      const result = await resolver.machineTemplate('non-existent-id', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Query: machineTemplates', () => {
    it('should return all templates with default pagination', async () => {
      const templates = Array.from({ length: 5 }, () => createMockMachineTemplate())
      const total = 5

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      mockPrisma.machineTemplate.count.mockResolvedValue(total)

      const result = await resolver.machineTemplates(undefined, undefined, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        include: {
          category: true,
          machines: true
        },
        orderBy: { name: 'asc' }
      })
      expect(result).toEqual({
        data: templates,
        total
      })
    })

    it('should apply pagination parameters', async () => {
      const templates = Array.from({ length: 3 }, () => createMockMachineTemplate())
      const total = 10
      const pagination = { skip: 5, take: 3 }

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      mockPrisma.machineTemplate.count.mockResolvedValue(total)

      const result = await resolver.machineTemplates(pagination, undefined, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: pagination.skip,
        take: pagination.take,
        include: {
          category: true,
          machines: true
        },
        orderBy: { name: 'asc' }
      })
      expect(result.data).toEqual(templates)
      expect(result.total).toBe(total)
    })

    it('should apply custom ordering', async () => {
      const templates = Array.from({ length: 5 }, () => createMockMachineTemplate())
      const total = 5
      const orderBy = { field: 'cores', direction: 'desc' }

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      mockPrisma.machineTemplate.count.mockResolvedValue(total)

      const result = await resolver.machineTemplates(undefined, orderBy, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        include: {
          category: true,
          machines: true
        },
        orderBy: { cores: 'desc' }
      })
      expect(result.data).toEqual(templates)
    })

    it('should return empty array when no templates exist', async () => {
      mockPrisma.machineTemplate.findMany.mockResolvedValue([])
      mockPrisma.machineTemplate.count.mockResolvedValue(0)

      const result = await resolver.machineTemplates(undefined, undefined, ctx)

      expect(result.data).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('Query: machineTemplateCategories', () => {
    it('should return all categories', async () => {
      const categories = Array.from({ length: 3 }, () => createMockMachineTemplateCategory())

      mockPrisma.machineTemplateCategory.findMany.mockResolvedValue(categories)

      const result = await resolver.machineTemplateCategories(ctx)

      expect(mockPrisma.machineTemplateCategory.findMany).toHaveBeenCalledWith({
        include: {
          templates: true
        },
        orderBy: { name: 'asc' }
      })
      expect(result).toEqual(categories)
    })

    it('should return empty array when no categories exist', async () => {
      mockPrisma.machineTemplateCategory.findMany.mockResolvedValue([])

      const result = await resolver.machineTemplateCategories(ctx)

      expect(result).toEqual([])
    })
  })

  describe('Mutation: createMachineTemplate', () => {
    it('should create a new template', async () => {
      const input = {
        name: 'New Template',
        description: 'Test template',
        cores: 4,
        ram: 8,
        storage: 100,
        categoryId: 'category-123'
      }

      const createdTemplate = createMockMachineTemplate(input)

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null) // Name doesn't exist
      mockPrisma.machineTemplate.create.mockResolvedValue(createdTemplate)

      const result = await resolver.createMachineTemplate(input, ctx)

      expect(mockPrisma.machineTemplate.findFirst).toHaveBeenCalledWith({
        where: { name: input.name }
      })
      expect(mockPrisma.machineTemplate.create).toHaveBeenCalledWith({
        data: {
          name: input.name,
          description: input.description,
          cores: input.cores,
          ram: input.ram,
          storage: input.storage,
          category: input.categoryId ? { connect: { id: input.categoryId } } : undefined
        },
        include: {
          category: true,
          machines: true
        }
      })
      expect(result).toEqual(createdTemplate)
    })

    it('should throw error if template name already exists', async () => {
      const existingTemplate = createMockMachineTemplate({ name: 'Existing Template' })
      const input = {
        name: 'Existing Template',
        cores: 2,
        ram: 4,
        storage: 50
      }

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(existingTemplate)

      await expect(
        resolver.createMachineTemplate(input, ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should create template without category', async () => {
      const input = {
        name: 'Basic Template',
        cores: 1,
        ram: 2,
        storage: 25
      }

      const createdTemplate = createMockMachineTemplate(input)

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null)
      mockPrisma.machineTemplate.create.mockResolvedValue(createdTemplate)

      const result = await resolver.createMachineTemplate(input, ctx)

      expect(mockPrisma.machineTemplate.create).toHaveBeenCalledWith({
        data: {
          name: input.name,
          description: undefined,
          cores: input.cores,
          ram: input.ram,
          storage: input.storage,
          category: undefined
        },
        include: {
          category: true,
          machines: true
        }
      })
      expect(result).toEqual(createdTemplate)
    })
  })

  describe('Mutation: updateMachineTemplate', () => {
    it('should update an existing template', async () => {
      const templateId = 'template-123'
      const existingTemplate = createMockMachineTemplate({ id: templateId })
      const updateInput = {
        name: 'Updated Template',
        cores: 8,
        ram: 16
      }

      const updatedTemplate = { ...existingTemplate, ...updateInput }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(existingTemplate)
      mockPrisma.machineTemplate.update.mockResolvedValue(updatedTemplate)

      const result = await resolver.updateMachineTemplate(templateId, updateInput, ctx)

      expect(mockPrisma.machineTemplate.update).toHaveBeenCalledWith({
        where: { id: templateId },
        data: updateInput,
        include: {
          category: true,
          machines: true
        }
      })
      expect(result).toEqual(updatedTemplate)
    })

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      await expect(
        resolver.updateMachineTemplate('non-existent', { name: 'Test' }, ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if updating to duplicate name', async () => {
      const templateId = 'template-123'
      const existingTemplate = createMockMachineTemplate({ id: templateId })
      const duplicateTemplate = createMockMachineTemplate({ name: 'Duplicate Name' })
      const updateInput = { name: 'Duplicate Name' }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(existingTemplate)
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(duplicateTemplate)

      await expect(
        resolver.updateMachineTemplate(templateId, updateInput, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: deleteMachineTemplate', () => {
    it('should delete a template', async () => {
      const templateId = 'template-123'
      const template = createMockMachineTemplate({ id: templateId })
      const templateWithRelations = {
        ...template,
        machines: []
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithRelations)
      mockPrisma.machineTemplate.delete.mockResolvedValue(template)

      const result = await resolver.deleteMachineTemplate(templateId, ctx)

      expect(mockPrisma.machineTemplate.delete).toHaveBeenCalledWith({
        where: { id: templateId }
      })
      expect(result).toBe(true)
    })

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      await expect(
        resolver.deleteMachineTemplate('non-existent', ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if template has machines', async () => {
      const templateId = 'template-123'
      const template = createMockMachineTemplate({ id: templateId })
      const templateWithMachines = {
        ...template,
        machines: createMockMachines(2)
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithMachines)

      await expect(
        resolver.deleteMachineTemplate(templateId, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: createMachineTemplateCategory', () => {
    it('should create a new category', async () => {
      const input = {
        name: 'New Category',
        description: 'Category description'
      }

      const createdCategory = createMockMachineTemplateCategory(input)

      mockPrisma.machineTemplateCategory.findFirst.mockResolvedValue(null)
      mockPrisma.machineTemplateCategory.create.mockResolvedValue(createdCategory)

      const result = await resolver.createMachineTemplateCategory(input, ctx)

      expect(mockPrisma.machineTemplateCategory.create).toHaveBeenCalledWith({
        data: input,
        include: {
          templates: true
        }
      })
      expect(result).toEqual(createdCategory)
    })

    it('should throw error if category name already exists', async () => {
      const existingCategory = createMockMachineTemplateCategory({ name: 'Existing' })
      const input = { name: 'Existing' }

      mockPrisma.machineTemplateCategory.findFirst.mockResolvedValue(existingCategory)

      await expect(
        resolver.createMachineTemplateCategory(input, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: deleteMachineTemplateCategory', () => {
    it('should delete a category', async () => {
      const categoryId = 'category-123'
      const category = createMockMachineTemplateCategory({ id: categoryId })
      const categoryWithRelations = {
        ...category,
        templates: []
      }

      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(categoryWithRelations)
      mockPrisma.machineTemplateCategory.delete.mockResolvedValue(category)

      const result = await resolver.deleteMachineTemplateCategory(categoryId, ctx)

      expect(mockPrisma.machineTemplateCategory.delete).toHaveBeenCalledWith({
        where: { id: categoryId }
      })
      expect(result).toBe(true)
    })

    it('should throw error if category has templates', async () => {
      const categoryId = 'category-123'
      const category = createMockMachineTemplateCategory({ id: categoryId })
      const categoryWithTemplates = {
        ...category,
        templates: [createMockMachineTemplate()]
      }

      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(categoryWithTemplates)

      await expect(
        resolver.deleteMachineTemplateCategory(categoryId, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })
})