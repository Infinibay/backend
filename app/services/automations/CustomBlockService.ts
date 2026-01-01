import { PrismaClient, CustomBlock, BlockOutputType, OS, Prisma } from '@prisma/client';
import { BlockDefinition, getBlockRegistry } from './BlockRegistry';

const debug = require('debug')('infinibay:automation:customblock');

export interface CreateCustomBlockInput {
  name: string;
  displayName: string;
  description?: string;
  category: string;
  blockDefinition: BlockDefinition;
  generatorCode: string;
  inputs?: Array<{
    name: string;
    type: string;
    label: string;
    required?: boolean;
  }>;
  outputType: BlockOutputType;
  supportedOS?: OS[];
}

export interface UpdateCustomBlockInput {
  displayName?: string;
  description?: string;
  category?: string;
  blockDefinition?: BlockDefinition;
  generatorCode?: string;
  inputs?: Array<{
    name: string;
    type: string;
    label: string;
    required?: boolean;
  }>;
  outputType?: BlockOutputType;
  supportedOS?: OS[];
  isEnabled?: boolean;
}

export class CustomBlockService {
  constructor(
    private prisma: PrismaClient,
    private userId: string | null
  ) {}

  /**
   * Create a new custom block
   */
  async create(input: CreateCustomBlockInput): Promise<CustomBlock> {
    debug('Creating custom block: %s', input.name);

    // Validate all inputs
    this.validateBlockInput(input);

    // Check name uniqueness
    const existing = await this.getByName(input.name);
    if (existing) {
      throw new Error(`Block name "${input.name}" is already in use`);
    }

    // Validate generator code syntax
    this.validateGeneratorCode(input.generatorCode);

    const block = await this.prisma.customBlock.create({
      data: {
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        blockDefinition: input.blockDefinition as unknown as Prisma.InputJsonValue,
        generatorCode: input.generatorCode,
        inputs: (input.inputs ?? []) as unknown as Prisma.InputJsonValue,
        outputType: input.outputType,
        supportedOS: input.supportedOS ?? ['WINDOWS', 'LINUX'],
        isBuiltIn: false,
        createdById: this.userId,
      },
    });

    // Reload the block registry to include the new block
    await this.reloadBlockRegistry();

    return block;
  }

  /**
   * Update an existing custom block
   */
  async update(id: string, input: UpdateCustomBlockInput): Promise<CustomBlock> {
    debug('Updating custom block: %s', id);

    const existing = await this.getById(id);
    if (!existing) throw new Error('Custom block not found');

    // Cannot edit built-in blocks
    if (existing.isBuiltIn) {
      throw new Error('Cannot modify built-in blocks');
    }

    // Validate input data (isCreate = false)
    this.validateBlockInput(input, false);

    // Validate generator code if provided
    if (input.generatorCode) {
      this.validateGeneratorCode(input.generatorCode);
    }

    const block = await this.prisma.customBlock.update({
      where: { id },
      data: {
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        blockDefinition: input.blockDefinition as unknown as Prisma.InputJsonValue,
        generatorCode: input.generatorCode,
        inputs: input.inputs as unknown as Prisma.InputJsonValue,
        outputType: input.outputType,
        supportedOS: input.supportedOS,
        isEnabled: input.isEnabled,
      },
    });

    // Reload the block registry
    await this.reloadBlockRegistry();

    return block;
  }

  /**
   * Delete a custom block
   */
  async delete(id: string): Promise<void> {
    debug('Deleting custom block: %s', id);

    const existing = await this.getById(id);
    if (!existing) throw new Error('Custom block not found');

    if (existing.isBuiltIn) {
      throw new Error('Cannot delete built-in blocks');
    }

    await this.prisma.customBlock.delete({ where: { id } });

    // Reload the block registry
    await this.reloadBlockRegistry();
  }

  /**
   * Get a custom block by ID
   */
  async getById(id: string): Promise<CustomBlock | null> {
    return this.prisma.customBlock.findUnique({ where: { id } });
  }

  /**
   * Get a custom block by name
   */
  async getByName(name: string): Promise<CustomBlock | null> {
    return this.prisma.customBlock.findUnique({ where: { name } });
  }

  /**
   * List all custom blocks
   */
  async list(options?: { category?: string; isBuiltIn?: boolean; isEnabled?: boolean }): Promise<CustomBlock[]> {
    const where: Prisma.CustomBlockWhereInput = {};

    if (options?.category) {
      where.category = options.category;
    }
    if (options?.isBuiltIn !== undefined) {
      where.isBuiltIn = options.isBuiltIn;
    }
    if (options?.isEnabled !== undefined) {
      where.isEnabled = options.isEnabled;
    }

    return this.prisma.customBlock.findMany({
      where,
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const results = await this.prisma.customBlock.groupBy({
      by: ['category'],
      _count: true,
    });
    return results.map(r => r.category);
  }

  /**
   * Enable a custom block
   */
  async enable(id: string): Promise<CustomBlock> {
    const block = await this.prisma.customBlock.update({
      where: { id },
      data: { isEnabled: true },
    });

    await this.reloadBlockRegistry();
    return block;
  }

  /**
   * Disable a custom block
   */
  async disable(id: string): Promise<CustomBlock> {
    const block = await this.prisma.customBlock.update({
      where: { id },
      data: { isEnabled: false },
    });

    await this.reloadBlockRegistry();
    return block;
  }

  /**
   * Check if a block name is available
   */
  async isNameAvailable(name: string): Promise<boolean> {
    const existing = await this.prisma.customBlock.findUnique({
      where: { name },
      select: { id: true },
    });
    return !existing;
  }

  /**
   * Test a custom block's generator code
   */
  testGeneratorCode(generatorCode: string, mockBlock: Record<string, unknown>): string | [string, number] {
    try {
      const fn = new Function('block', generatorCode);
      const blockProxy = {
        getFieldValue: (name: string) => mockBlock[name],
        getInputTargetBlock: () => null,
        type: 'test',
        id: 'test',
      };
      return fn(blockProxy);
    } catch (error) {
      throw new Error(`Generator code error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate generator code syntax
   */
  private validateGeneratorCode(code: string): void {
    try {
      // Try to create a function from the code
      new Function('block', code);
    } catch (error) {
      throw new Error(`Invalid generator code: ${error instanceof Error ? error.message : 'Syntax error'}`);
    }
  }

  /**
   * Validate block input data
   */
  private validateBlockInput(input: CreateCustomBlockInput | UpdateCustomBlockInput, isCreate = true): void {
    // For create, name is required
    if (isCreate && 'name' in input) {
      const name = (input as CreateCustomBlockInput).name?.trim();

      if (!name) {
        throw new Error('Block name is required');
      }

      // Name format: lowercase alphanumeric with underscores, starting with a letter
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        throw new Error('Block name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores');
      }

      // Reserved prefixes
      const reservedPrefixes = ['health_', 'logic_', 'math_', 'text_', 'loop_', 'action_', 'compare_'];
      if (reservedPrefixes.some(prefix => name.startsWith(prefix))) {
        throw new Error(`Block name cannot start with reserved prefixes: ${reservedPrefixes.join(', ')}`);
      }

      // Max length
      if (name.length > 64) {
        throw new Error('Block name must be 64 characters or less');
      }
    }

    // displayName validation
    if ('displayName' in input && input.displayName !== undefined) {
      const displayName = input.displayName?.trim();
      if (isCreate && !displayName) {
        throw new Error('Display name is required');
      }
      if (displayName && displayName.length > 128) {
        throw new Error('Display name must be 128 characters or less');
      }
    }

    // description max length
    if ('description' in input && input.description && input.description.length > 500) {
      throw new Error('Description must be 500 characters or less');
    }

    // category validation
    if ('category' in input && input.category !== undefined) {
      const category = input.category?.trim();
      if (isCreate && !category) {
        throw new Error('Category is required');
      }
      if (category && category.length > 64) {
        throw new Error('Category must be 64 characters or less');
      }
    }

    // generatorCode validation
    if ('generatorCode' in input && input.generatorCode !== undefined) {
      if (isCreate && !input.generatorCode?.trim()) {
        throw new Error('Generator code is required');
      }
      if (input.generatorCode && input.generatorCode.length > 10000) {
        throw new Error('Generator code must be 10000 characters or less');
      }
    }

    // inputs validation
    if ('inputs' in input && input.inputs) {
      if (!Array.isArray(input.inputs)) {
        throw new Error('Inputs must be an array');
      }
      if (input.inputs.length > 10) {
        throw new Error('Maximum 10 inputs allowed per block');
      }
      for (const inp of input.inputs) {
        if (!inp.name?.trim()) {
          throw new Error('Input name is required');
        }
        if (!/^[a-z][a-z0-9_]*$/i.test(inp.name)) {
          throw new Error(`Input name "${inp.name}" must be alphanumeric with underscores`);
        }
        if (!inp.type) {
          throw new Error('Input type is required');
        }
        if (!['Number', 'String', 'Boolean'].includes(inp.type)) {
          throw new Error(`Invalid input type: ${inp.type}. Must be Number, String, or Boolean`);
        }
      }
    }
  }

  /**
   * Reload the block registry to pick up changes
   */
  private async reloadBlockRegistry(): Promise<void> {
    try {
      const registry = await getBlockRegistry(this.prisma);
      await registry.loadCustomBlocks();
      debug('Block registry reloaded');
    } catch (error) {
      debug('Failed to reload block registry: %s', error);
    }
  }
}
