import { PrismaClient, SystemScript, Prisma } from '@prisma/client';

const debug = require('debug')('infinibay:automation:systemscript');

export interface CreateSystemScriptInput {
  name: string;
  displayName: string;
  description?: string;
  codeWindows?: string;
  codeLinux?: string;
  category?: string;
  requiredHealthFields?: string[];
}

export interface UpdateSystemScriptInput {
  displayName?: string;
  description?: string;
  codeWindows?: string;
  codeLinux?: string;
  category?: string;
  requiredHealthFields?: string[];
  isEnabled?: boolean;
}

export class SystemScriptService {
  constructor(
    private prisma: PrismaClient,
    private userId: string | null
  ) {}

  /**
   * Create a new system script
   */
  async create(input: CreateSystemScriptInput): Promise<SystemScript> {
    debug('Creating system script: %s', input.name);

    // Validate name format (alphanumeric with underscores)
    if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
      throw new Error('System script name must be lowercase alphanumeric with underscores, starting with a letter');
    }

    return this.prisma.systemScript.create({
      data: {
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        codeWindows: input.codeWindows,
        codeLinux: input.codeLinux,
        category: input.category ?? 'General',
        requiredHealthFields: input.requiredHealthFields ?? [],
        createdById: this.userId,
      },
    });
  }

  /**
   * Update an existing system script
   */
  async update(id: string, input: UpdateSystemScriptInput): Promise<SystemScript> {
    debug('Updating system script: %s', id);

    return this.prisma.systemScript.update({
      where: { id },
      data: {
        displayName: input.displayName,
        description: input.description,
        codeWindows: input.codeWindows,
        codeLinux: input.codeLinux,
        category: input.category,
        requiredHealthFields: input.requiredHealthFields,
        isEnabled: input.isEnabled,
      },
    });
  }

  /**
   * Delete a system script
   */
  async delete(id: string): Promise<void> {
    debug('Deleting system script: %s', id);

    // Check if script is used by any automation
    const usage = await this.prisma.automationScript.count({
      where: { systemScriptId: id },
    });

    if (usage > 0) {
      throw new Error(`Cannot delete system script: used by ${usage} automation(s)`);
    }

    await this.prisma.systemScript.delete({ where: { id } });
  }

  /**
   * Get a system script by ID
   */
  async getById(id: string): Promise<SystemScript | null> {
    return this.prisma.systemScript.findUnique({ where: { id } });
  }

  /**
   * Get a system script by name
   */
  async getByName(name: string): Promise<SystemScript | null> {
    return this.prisma.systemScript.findUnique({ where: { name } });
  }

  /**
   * List all system scripts, optionally filtered by category
   */
  async list(category?: string): Promise<SystemScript[]> {
    return this.prisma.systemScript.findMany({
      where: {
        isEnabled: true,
        ...(category && { category }),
      },
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
    });
  }

  /**
   * List all system scripts including disabled ones (admin view)
   */
  async listAll(): Promise<SystemScript[]> {
    return this.prisma.systemScript.findMany({
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { automationScripts: true } },
      },
    });
  }

  /**
   * Get all unique categories
   */
  async getCategories(): Promise<string[]> {
    const results = await this.prisma.systemScript.groupBy({
      by: ['category'],
      _count: true,
    });
    return results.map(r => r.category);
  }

  /**
   * Enable a system script
   */
  async enable(id: string): Promise<SystemScript> {
    return this.prisma.systemScript.update({
      where: { id },
      data: { isEnabled: true },
    });
  }

  /**
   * Disable a system script
   */
  async disable(id: string): Promise<SystemScript> {
    return this.prisma.systemScript.update({
      where: { id },
      data: { isEnabled: false },
    });
  }

  /**
   * Get script code for a specific OS
   */
  async getCodeForOS(id: string, os: 'WINDOWS' | 'LINUX'): Promise<string | null> {
    const script = await this.getById(id);
    if (!script) return null;

    return os === 'WINDOWS' ? script.codeWindows : script.codeLinux;
  }

  /**
   * Check if a system script name is available
   */
  async isNameAvailable(name: string): Promise<boolean> {
    const existing = await this.prisma.systemScript.findUnique({
      where: { name },
      select: { id: true },
    });
    return !existing;
  }
}
