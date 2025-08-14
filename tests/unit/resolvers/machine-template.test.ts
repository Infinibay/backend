import 'reflect-metadata';
import { MachineTemplateResolver } from '@resolvers/machine_template/resolver';
import { mockPrisma } from '../../setup/jest.setup';
import {
  createMockMachineTemplate,
  createMockMachineTemplateCategory,
  createMockMachines,
} from '../../setup/mock-factories';
import { createAdminContext } from '../../setup/test-helpers';
import { UserInputError } from 'apollo-server-errors';

describe('MachineTemplateResolver', () => {
  let resolver: MachineTemplateResolver;

  beforeEach(() => {
    resolver = new MachineTemplateResolver();
    jest.clearAllMocks();
  });

  describe('machineTemplate', () => {
    it('should return template by id with relations', async () => {
      const category = createMockMachineTemplateCategory();
      const template = createMockMachineTemplate({ categoryId: category.id });
      const machines = createMockMachines(2).map(m => ({ ...m, templateId: template.id }));

      const templateWithRelations = {
        ...template,
        category,
        machines,
      };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithRelations);

      const result = await resolver.machineTemplate(template.id);

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: template.id },
        include: {
          category: true,
          machines: true,
        },
      });
      expect(result).toEqual(templateWithRelations);
    });

    it('should return null if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);

      const result = await resolver.machineTemplate('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('machineTemplates', () => {
    it('should return all templates', async () => {
      const templates = Array.from({ length: 5 }, () => createMockMachineTemplate());
      
      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates);

      const result = await resolver.machineTemplates();

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        include: {
          category: true,
          machines: true,
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(templates);
    });

    it('should filter templates by category', async () => {
      const categoryId = 'category-123';
      const templates = Array.from({ length: 3 }, () => 
        createMockMachineTemplate({ categoryId })
      );
      
      mockPrisma.machineTemplate.findMany.mockResolvedValue(templates);

      const result = await resolver.machineTemplates({ categoryId });

      expect(mockPrisma.machineTemplate.findMany).toHaveBeenCalledWith({
        where: { categoryId },
        include: {
          category: true,
          machines: true,
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(templates);
    });

    it('should return empty array when no templates exist', async () => {
      mockPrisma.machineTemplate.findMany.mockResolvedValue([]);

      const result = await resolver.machineTemplates();

      expect(result).toEqual([]);
    });
  });

  describe('createMachineTemplate', () => {
    it('should create template with valid input', async () => {
      const input = {
        name: 'Ubuntu Server Template',
        description: 'Ubuntu 22.04 LTS Server',
        cores: 4,
        ram: 8,
        storage: 100,
        categoryId: 'category-123',
      };

      const category = createMockMachineTemplateCategory({ id: input.categoryId });
      const createdTemplate = createMockMachineTemplate(input);

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null); // Name doesn't exist
      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(category);
      mockPrisma.machineTemplate.create.mockResolvedValue(createdTemplate);

      const context = createAdminContext();
      const result = await resolver.createMachineTemplate(context, input);

      expect(mockPrisma.machineTemplate.create).toHaveBeenCalledWith({
        data: input,
        include: {
          category: true,
        },
      });
      expect(result).toEqual(createdTemplate);
    });

    it('should create template without category', async () => {
      const input = {
        name: 'Basic Template',
        description: 'Basic VM template',
        cores: 2,
        ram: 4,
        storage: 50,
      };

      const createdTemplate = createMockMachineTemplate(input);

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplate.create.mockResolvedValue(createdTemplate);

      const context = createAdminContext();
      const result = await resolver.createMachineTemplate(context, input);

      expect(result).toEqual(createdTemplate);
    });

    it('should throw error if template name already exists', async () => {
      const input = {
        name: 'Existing Template',
        cores: 4,
        ram: 8,
        storage: 100,
      };

      const existingTemplate = createMockMachineTemplate({ name: input.name });
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(existingTemplate);

      const context = createAdminContext();
      await expect(
        resolver.createMachineTemplate(context, input)
      ).rejects.toThrow(UserInputError);
      expect(mockPrisma.machineTemplate.create).not.toHaveBeenCalled();
    });

    it('should throw error if category not found', async () => {
      const input = {
        name: 'Template',
        cores: 4,
        ram: 8,
        storage: 100,
        categoryId: 'non-existent',
      };

      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(null);

      const context = createAdminContext();
      await expect(
        resolver.createMachineTemplate(context, input)
      ).rejects.toThrow(UserInputError);
    });

    it('should validate resource constraints', async () => {
      const context = createAdminContext();

      // Test invalid CPU cores
      await expect(
        resolver.createMachineTemplate(context, {
          name: 'Template',
          cores: 0,
          ram: 8,
          storage: 100,
        })
      ).rejects.toThrow(UserInputError);

      // Test invalid RAM
      await expect(
        resolver.createMachineTemplate(context, {
          name: 'Template',
          cores: 4,
          ram: 0,
          storage: 100,
        })
      ).rejects.toThrow(UserInputError);

      // Test invalid storage
      await expect(
        resolver.createMachineTemplate(context, {
          name: 'Template',
          cores: 4,
          ram: 8,
          storage: 0,
        })
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('updateMachineTemplate', () => {
    it('should update template properties', async () => {
      const template = createMockMachineTemplate();
      const updateInput = {
        name: 'Updated Template',
        description: 'Updated description',
        cores: 8,
        ram: 16,
        storage: 200,
      };

      const updatedTemplate = { ...template, ...updateInput };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null); // New name doesn't exist
      mockPrisma.machineTemplate.update.mockResolvedValue(updatedTemplate);

      const result = await resolver.updateMachineTemplate(template.id, updateInput);

      expect(mockPrisma.machineTemplate.update).toHaveBeenCalledWith({
        where: { id: template.id },
        data: updateInput,
        include: {
          category: true,
        },
      });
      expect(result).toEqual(updatedTemplate);
    });

    it('should update template category', async () => {
      const template = createMockMachineTemplate();
      const newCategory = createMockMachineTemplateCategory();
      const updateInput = { categoryId: newCategory.id };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(newCategory);
      mockPrisma.machineTemplate.update.mockResolvedValue({
        ...template,
        categoryId: newCategory.id,
        category: newCategory,
      });

      const result = await resolver.updateMachineTemplate(template.id, updateInput);

      expect(result.categoryId).toBe(newCategory.id);
    });

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);

      await expect(
        resolver.updateMachineTemplate('non-existent', { name: 'New Name' })
      ).rejects.toThrow(UserInputError);
    });

    it('should throw error if new name already exists', async () => {
      const template = createMockMachineTemplate();
      const otherTemplate = createMockMachineTemplate({ name: 'Existing Name' });

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(otherTemplate);

      await expect(
        resolver.updateMachineTemplate(template.id, { name: 'Existing Name' })
      ).rejects.toThrow(UserInputError);
    });

    it('should not allow reducing resources if machines are using template', async () => {
      const template = createMockMachineTemplate({ cores: 8, ram: 16, storage: 200 });
      const machines = createMockMachines(2).map(m => ({ ...m, templateId: template.id }));
      
      mockPrisma.machineTemplate.findUnique.mockResolvedValue({
        ...template,
        machines,
      });

      // Try to reduce resources
      await expect(
        resolver.updateMachineTemplate(template.id, { cores: 4 })
      ).rejects.toThrow(UserInputError);

      await expect(
        resolver.updateMachineTemplate(template.id, { ram: 8 })
      ).rejects.toThrow(UserInputError);

      await expect(
        resolver.updateMachineTemplate(template.id, { storage: 100 })
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('deleteM achineTemplate', () => {
    it('should delete template without machines', async () => {
      const template = createMockMachineTemplate();
      const templateWithNoMachines = { ...template, machines: [] };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithNoMachines);
      mockPrisma.machineTemplate.delete.mockResolvedValue(template);

      const result = await resolver.deleteMachineTemplate(template.id);

      expect(mockPrisma.machineTemplate.delete).toHaveBeenCalledWith({
        where: { id: template.id },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('deleted'),
      });
    });

    it('should not delete template with machines', async () => {
      const template = createMockMachineTemplate();
      const machines = createMockMachines(2);
      const templateWithMachines = { ...template, machines };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(templateWithMachines);

      await expect(
        resolver.deleteMachineTemplate(template.id)
      ).rejects.toThrow(UserInputError);
      expect(mockPrisma.machineTemplate.delete).not.toHaveBeenCalled();
    });

    it('should throw error if template not found', async () => {
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);

      await expect(
        resolver.deleteMachineTemplate('non-existent')
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('machineTemplateCategories', () => {
    it('should return all categories', async () => {
      const categories = Array.from({ length: 3 }, () => 
        createMockMachineTemplateCategory()
      );
      
      mockPrisma.machineTemplateCategory.findMany.mockResolvedValue(categories);

      const result = await resolver.machineTemplateCategories();

      expect(mockPrisma.machineTemplateCategory.findMany).toHaveBeenCalledWith({
        include: {
          templates: true,
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(categories);
    });
  });

  describe('createMachineTemplateCategory', () => {
    it('should create category with valid input', async () => {
      const input = {
        name: 'Server Templates',
        description: 'Templates for server configurations',
      };

      const createdCategory = createMockMachineTemplateCategory(input);

      mockPrisma.machineTemplateCategory.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplateCategory.create.mockResolvedValue(createdCategory);

      const context = createAdminContext();
      const result = await resolver.createMachineTemplateCategory(context, input);

      expect(mockPrisma.machineTemplateCategory.create).toHaveBeenCalledWith({
        data: input,
      });
      expect(result).toEqual(createdCategory);
    });

    it('should throw error if category name already exists', async () => {
      const input = { name: 'Existing Category' };
      const existingCategory = createMockMachineTemplateCategory({ name: input.name });

      mockPrisma.machineTemplateCategory.findFirst.mockResolvedValue(existingCategory);

      const context = createAdminContext();
      await expect(
        resolver.createMachineTemplateCategory(context, input)
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('updateMachineTemplateCategory', () => {
    it('should update category properties', async () => {
      const category = createMockMachineTemplateCategory();
      const updateInput = {
        name: 'Updated Category',
        description: 'Updated description',
      };

      const updatedCategory = { ...category, ...updateInput };

      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(category);
      mockPrisma.machineTemplateCategory.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplateCategory.update.mockResolvedValue(updatedCategory);

      const result = await resolver.updateMachineTemplateCategory(category.id, updateInput);

      expect(mockPrisma.machineTemplateCategory.update).toHaveBeenCalledWith({
        where: { id: category.id },
        data: updateInput,
      });
      expect(result).toEqual(updatedCategory);
    });
  });

  describe('deleteMachineTemplateCategory', () => {
    it('should delete category without templates', async () => {
      const category = createMockMachineTemplateCategory();
      const categoryWithNoTemplates = { ...category, templates: [] };

      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(categoryWithNoTemplates);
      mockPrisma.machineTemplateCategory.delete.mockResolvedValue(category);

      const result = await resolver.deleteMachineTemplateCategory(category.id);

      expect(mockPrisma.machineTemplateCategory.delete).toHaveBeenCalledWith({
        where: { id: category.id },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('deleted'),
      });
    });

    it('should not delete category with templates', async () => {
      const category = createMockMachineTemplateCategory();
      const templates = Array.from({ length: 2 }, () => createMockMachineTemplate());
      const categoryWithTemplates = { ...category, templates };

      mockPrisma.machineTemplateCategory.findUnique.mockResolvedValue(categoryWithTemplates);

      await expect(
        resolver.deleteMachineTemplateCategory(category.id)
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('cloneMachineTemplate', () => {
    it('should clone existing template', async () => {
      const originalTemplate = createMockMachineTemplate({
        name: 'Original Template',
        cores: 4,
        ram: 8,
        storage: 100,
      });

      const clonedTemplate = {
        ...originalTemplate,
        id: 'new-id',
        name: 'Original Template (Copy)',
      };

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(originalTemplate);
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplate.create.mockResolvedValue(clonedTemplate);

      const context = createAdminContext();
      const result = await resolver.cloneMachineTemplate(context, originalTemplate.id, 'Original Template (Copy)');

      expect(mockPrisma.machineTemplate.create).toHaveBeenCalledWith({
        data: {
          name: 'Original Template (Copy)',
          description: originalTemplate.description,
          cores: originalTemplate.cores,
          ram: originalTemplate.ram,
          storage: originalTemplate.storage,
          categoryId: originalTemplate.categoryId,
        },
        include: {
          category: true,
        },
      });
      expect(result.name).toBe('Original Template (Copy)');
    });

    it('should auto-generate clone name if not provided', async () => {
      const originalTemplate = createMockMachineTemplate({ name: 'Template' });

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(originalTemplate);
      mockPrisma.machineTemplate.findFirst.mockResolvedValue(null);
      mockPrisma.machineTemplate.create.mockResolvedValue({
        ...originalTemplate,
        id: 'new-id',
        name: 'Template (Copy)',
      });

      const context = createAdminContext();
      await resolver.cloneMachineTemplate(context, originalTemplate.id);

      expect(mockPrisma.machineTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Template (Copy)',
          }),
        })
      );
    });
  });

  describe('Authorization Tests', () => {
    it('should require ADMIN role for createMachineTemplate', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        MachineTemplateResolver.prototype,
        'createMachineTemplate'
      );
      expect(metadata).toBe('ADMIN');
    });

    it('should require ADMIN role for updateMachineTemplate', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        MachineTemplateResolver.prototype,
        'updateMachineTemplate'
      );
      expect(metadata).toBe('ADMIN');
    });

    it('should require ADMIN role for deleteMachineTemplate', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        MachineTemplateResolver.prototype,
        'deleteMachineTemplate'
      );
      expect(metadata).toBe('ADMIN');
    });

    it('should allow USER role for viewing templates', () => {
      const metadata = Reflect.getMetadata(
        'custom:authorized',
        MachineTemplateResolver.prototype,
        'machineTemplates'
      );
      expect(metadata).toBe('USER');
    });
  });
});