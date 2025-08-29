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
import { MachineTemplateInputType, MachineTemplateOrderBy, MachineTemplateOrderByEnum } from '@graphql/resolvers/machine_template/type'
import { PaginationInputType, OrderByDirection } from '@utils/pagination'

describe('MachineTemplateResolver', () => {
  let resolver: MachineTemplateResolver
  const ctx = createAdminContext()

  beforeEach(() => {
    resolver = new MachineTemplateResolver()
    jest.clearAllMocks()
  })

  describe('Query: machineTemplate', () => {
    it('should return template by id with totalMachines count', async () => {
      const category = createMockMachineTemplateCategory()
      const template = createMockMachineTemplate({ categoryId: category.id })

      const templateWithCategory = {
        ...template,
        category
      }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithCategory)
      mockPrisma.machine.count.mockResolvedValue(5)

      const result = await resolver.machineTemplate(template.id, ctx)

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: template.id },
        include: {
          category: true
        }
      })
      expect(mockPrisma.machine.count).toHaveBeenCalledWith({
        where: { templateId: template.id }
      })
      expect(result).toEqual({
        ...templateWithCategory,
        totalMachines: 5
      })
    })

    it('should return null if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)
      mockPrisma.machine.count.mockResolvedValue(0)

      const result = await resolver.machineTemplate('non-existent-id', ctx)

      expect(result).toBeNull()
    })
  })

  describe('Query: machineTemplates', () => {
    it('should return all templates with default pagination', async () => {
      const templates = Array.from({ length: 5 }, () => createMockMachineTemplate())

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      templates.forEach(() => {
        mockPrisma.machine.count.mockResolvedValueOnce(3)
      })

      const result = await resolver.machineTemplates(undefined as unknown as PaginationInputType, undefined as unknown as MachineTemplateOrderBy, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        include: {
          category: true
        },
        orderBy: undefined
      })

      expect(result).toHaveLength(5)
      result.forEach(template => {
        expect(template).toHaveProperty('totalMachines', 3)
      })
    })

    it('should apply pagination parameters', async () => {
      const templates = Array.from({ length: 3 }, () => createMockMachineTemplate())
      const pagination: PaginationInputType = { skip: 5, take: 3 }

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      templates.forEach(() => {
        mockPrisma.machine.count.mockResolvedValueOnce(2)
      })

      const result = await resolver.machineTemplates(pagination, undefined as unknown as MachineTemplateOrderBy, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: pagination.skip,
        take: pagination.take,
        include: {
          category: true
        },
        orderBy: undefined
      })
      expect(result).toHaveLength(3)
    })

    it('should apply custom ordering', async () => {
      const templates = Array.from({ length: 5 }, () => createMockMachineTemplate())
      const orderBy: MachineTemplateOrderBy = {
        fieldName: MachineTemplateOrderByEnum.CORES,
        direction: OrderByDirection.DESC
      }

      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates)
      templates.forEach(() => {
        mockPrisma.machine.count.mockResolvedValueOnce(1)
      })

      const result = await resolver.machineTemplates(undefined as unknown as PaginationInputType, orderBy, ctx)

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        include: {
          category: true
        },
        orderBy: { cores: OrderByDirection.DESC }
      })
      expect(result).toHaveLength(5)
    })

    it('should return empty array when no templates exist', async () => {
      mockPrisma.machineTemplate.findMany.mockResolvedValue([])

      const result = await resolver.machineTemplates(undefined as unknown as PaginationInputType, undefined as unknown as MachineTemplateOrderBy, ctx)

      expect(result).toEqual([])
    })
  })

  describe('Mutation: createMachineTemplate', () => {
    it('should create a new template', async () => {
      const input: MachineTemplateInputType = {
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
          categoryId: input.categoryId
        },
        include: {
          category: true
        }
      })
      expect(result).toEqual(createdTemplate)
    })

    it('should throw error if template name already exists', async () => {
      const existingTemplate = createMockMachineTemplate({ name: 'Existing Template' })
      const input: MachineTemplateInputType = {
        name: 'Existing Template',
        description: 'Test',
        cores: 2,
        ram: 4,
        storage: 50,
        categoryId: null
      }

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(existingTemplate)

      await expect(
        resolver.createMachineTemplate(input, ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if cores out of range', async () => {
      const input: MachineTemplateInputType = {
        name: 'Invalid Template',
        description: 'Test',
        cores: 100, // Max is 64
        ram: 8,
        storage: 100,
        categoryId: null
      }

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null)

      await expect(
        resolver.createMachineTemplate(input, ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if RAM out of range', async () => {
      const input: MachineTemplateInputType = {
        name: 'Invalid Template',
        description: 'Test',
        cores: 4,
        ram: 600, // Max is 512
        storage: 100,
        categoryId: null
      }

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null)

      await expect(
        resolver.createMachineTemplate(input, ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if storage out of range', async () => {
      const input: MachineTemplateInputType = {
        name: 'Invalid Template',
        description: 'Test',
        cores: 4,
        ram: 8,
        storage: 2000, // Max is 1024
        categoryId: null
      }

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null)

      await expect(
        resolver.createMachineTemplate(input, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: updateMachineTemplate', () => {
    it('should update an existing template', async () => {
      const templateId = 'template-123'
      const existingTemplate = createMockMachineTemplate({ id: templateId })
      const updateInput: MachineTemplateInputType = {
        name: 'Updated Template',
        description: 'Updated description',
        cores: 8,
        ram: 16,
        storage: 200,
        categoryId: null
      }

      const updatedTemplate = { ...existingTemplate, ...updateInput }

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(existingTemplate)
      mockPrisma.machineTemplate.update.mockResolvedValue(updatedTemplate)

      const result = await resolver.updateMachineTemplate(templateId, updateInput, ctx)

      expect(mockPrisma.machineTemplate.update).toHaveBeenCalledWith({
        where: { id: templateId },
        data: {
          name: updateInput.name,
          description: updateInput.description,
          cores: updateInput.cores,
          ram: updateInput.ram,
          storage: updateInput.storage,
          categoryId: updateInput.categoryId
        },
        include: {
          category: true
        }
      })
      expect(result).toEqual(updatedTemplate)
    })

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      const updateInput: MachineTemplateInputType = {
        name: 'Test',
        description: 'Test',
        cores: 4,
        ram: 8,
        storage: 100,
        categoryId: null
      }

      await expect(
        resolver.updateMachineTemplate('non-existent', updateInput, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Mutation: destroyMachineTemplate', () => {
    it('should delete a template without machines', async () => {
      const templateId = 'template-123'
      const template = createMockMachineTemplate({ id: templateId })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template)
      mockPrisma.machine.count.mockResolvedValue(0) // No machines using this template
      mockPrisma.machineTemplate.delete.mockResolvedValue(template)

      const result = await resolver.destroyMachineTemplate(templateId, ctx)

      expect(mockPrisma.machineTemplate.delete).toHaveBeenCalledWith({
        where: { id: templateId }
      })
      expect(result).toBe(true)
    })

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null)

      await expect(
        resolver.destroyMachineTemplate('non-existent', ctx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if template has machines', async () => {
      const templateId = 'template-123'
      const template = createMockMachineTemplate({ id: templateId })

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template)
      mockPrisma.machine.count.mockResolvedValue(2) // Has machines using this template

      await expect(
        resolver.destroyMachineTemplate(templateId, ctx)
      ).rejects.toThrow(UserInputError)
    })
  })
})
