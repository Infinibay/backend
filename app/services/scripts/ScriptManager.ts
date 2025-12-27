import { PrismaClient, Prisma, Script, OS, ShellType } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { ScriptParser, ParsedScript, ScriptInputDefinition } from './ScriptParser';
import { TemplateEngine } from './TemplateEngine';

// Cache interfaces
interface CacheEntry {
  data: ParsedScript
  timestamp: number
  ttl: number
}

interface CacheConfig {
  enabled: boolean
  ttlMinutes: number
  maxSize: number
}

// Constants for directory paths
const SCRIPTS_BASE_DIR = process.env.INFINIBAY_BASE_DIR
  ? path.join(process.env.INFINIBAY_BASE_DIR, 'scripts')
  : '/opt/infinibay/scripts';
const LIBRARY_DIR = path.join(SCRIPTS_BASE_DIR, 'library');
const TEMPLATES_DIR = path.join(SCRIPTS_BASE_DIR, 'templates');

// Input types for script operations
export interface CreateScriptInput {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  content: string;
  format: 'yaml' | 'json';
}

export interface UpdateScriptInput {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  content?: string;
}

export interface ScriptFilters {
  category?: string;
  os?: OS;
  tags?: string[];
  search?: string;
}

export interface ScriptWithContent extends Script {
  content: string;
  /** The actual executable script body extracted from the 'script' field in YAML/JSON */
  scriptBody: string;
  parsedInputs: ScriptInputDefinition[];
  hasInputs: boolean;
  inputCount: number;
}

export class ScriptManager {
  private prisma: PrismaClient;
  private parser: ScriptParser;
  private templateEngine: TemplateEngine;

  // Shared static cache across all instances
  private static cache = new Map<string, CacheEntry>()
  private static cacheConfig: CacheConfig = {
    enabled: process.env.SCRIPT_CACHE_ENABLED !== 'false',
    ttlMinutes: parseInt(process.env.SCRIPT_CACHE_TTL_MINUTES || '30', 10),
    maxSize: parseInt(process.env.SCRIPT_CACHE_MAX_SIZE || '100', 10)
  }
  private static maintenanceTimer: NodeJS.Timeout | null = null

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.parser = new ScriptParser();
    this.templateEngine = new TemplateEngine();

    // Start cache maintenance timer (only once)
    if (ScriptManager.cacheConfig.enabled && !ScriptManager.maintenanceTimer) {
      ScriptManager.startCacheMaintenance()
    }
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(
    scriptId: string,
    userId: string | null,
    action: 'CREATED' | 'EDITED' | 'DELETED',
    details?: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      await this.prisma.scriptAuditLog.create({
        data: {
          scriptId,
          userId,
          action,
          details: (details as Prisma.InputJsonValue) || undefined,
          ipAddress: ipAddress || undefined,
          userAgent: userAgent || undefined
        }
      })
    } catch (error) {
      // Log error but don't fail the main operation
      console.error('Failed to create audit log:', error)
    }
  }

  /**
   * Create a new script
   */
  async createScript(data: CreateScriptInput, userId: string, ipAddress?: string, userAgent?: string): Promise<Script> {
    // Parse content based on format
    let parsed: ParsedScript;
    if (data.format === 'yaml') {
      parsed = this.parser.parseYAML(data.content);
    } else {
      parsed = this.parser.parseJSON(data.content);
    }

    // Validate schema
    this.parser.validateSchema(parsed);

    // Check for name mismatch between metadata and input
    if (parsed.name && parsed.name !== data.name) {
      throw new Error(`Script name mismatch: file metadata contains '${parsed.name}' but input specifies '${data.name}'`);
    }

    // Validate template variables (always check, even if no inputs defined)
    this.templateEngine.validateTemplateVariables(parsed.script, parsed.inputs || []);

    // Generate unique filename with collision handling
    const extension = data.format === 'yaml' ? '.yaml' : '.json';
    let fileName = this.sanitizeFileName(data.name) + extension;

    // Ensure library directory exists
    await this.ensureDirectoryExists(LIBRARY_DIR);

    // Check if file already exists and append numeric suffix if needed
    let filePath = path.join(LIBRARY_DIR, fileName);
    let counter = 1;
    while (await this.fileExists(filePath)) {
      const baseName = this.sanitizeFileName(data.name);
      fileName = `${baseName}-${counter}${extension}`;
      filePath = path.join(LIBRARY_DIR, fileName);
      counter++;
      if (counter > 100) {
        throw new Error(`Unable to generate unique filename after 100 attempts for '${data.name}'`);
      }
    }

    // Write file to disk
    await fs.writeFile(filePath, data.content, 'utf-8');

    // Extract metadata
    const metadata = this.parser.extractMetadata(parsed);

    // Create database record
    const script = await this.prisma.script.create({
      data: {
        name: data.name,
        description: data.description || parsed.description || null,
        fileName: fileName,
        category: data.category || parsed.category || null,
        tags: data.tags || parsed.tags || [],
        os: (metadata as any).os as OS[],
        shell: (metadata as any).shell as ShellType,
        createdById: userId
      }
    });

    // Create audit log
    await this.createAuditLog(
      script.id,
      userId,
      'CREATED',
      { name: script.name, category: script.category, os: script.os, shell: script.shell },
      ipAddress,
      userAgent
    )

    return script;
  }

  /**
   * Update an existing script
   */
  async updateScript(id: string, data: UpdateScriptInput, actorUserId: string, ipAddress?: string, userAgent?: string): Promise<Script> {
    // Find existing script
    const existingScript = await this.prisma.script.findUnique({
      where: { id }
    });

    if (!existingScript) {
      throw new Error(`Script with id '${id}' not found`);
    }

    // Check if it's a system template (cannot be updated)
    if (existingScript.createdById === null) {
      throw new Error('System template scripts cannot be modified');
    }

    let updateData: any = {};

    // Handle file renaming if name is being updated
    let oldFilePath: string | null = null;
    let newFilePath: string | null = null;
    let newFileName: string | null = null;

    if (data.name !== undefined && data.name !== existingScript.name) {
      // Extract extension from existing fileName
      const extension = existingScript.fileName.endsWith('.yaml') ? '.yaml' : '.json';

      // Generate sanitized base name
      const baseFileName = this.sanitizeFileName(data.name);

      // Validate that sanitized name is not empty
      if (!baseFileName) {
        throw new Error(`Invalid script name '${data.name}': name must contain at least one alphanumeric character`);
      }

      newFileName = baseFileName + extension;

      // Store old and new file paths
      oldFilePath = path.join(LIBRARY_DIR, existingScript.fileName);
      newFilePath = path.join(LIBRARY_DIR, newFileName);

      // Handle fileName collision with numeric suffix (similar to createScript)
      if (newFileName !== existingScript.fileName) {
        let counter = 1;
        while (await this.fileExists(newFilePath)) {
          newFileName = `${baseFileName}-${counter}${extension}`;
          newFilePath = path.join(LIBRARY_DIR, newFileName);
          counter++;
          if (counter > 100) {
            throw new Error(`Unable to generate unique filename after 100 attempts for '${data.name}'`);
          }
        }

        // Rename the file on disk
        try {
          // Check if old file exists before attempting rename
          if (await this.fileExists(oldFilePath)) {
            await fs.rename(oldFilePath, newFilePath);
          } else {
            // Log warning but continue with database update
            console.warn(`Script file not found at ${oldFilePath}, continuing with database update only`);
            // Don't set newFileName if file doesn't exist, so we don't update fileName in DB
            newFileName = null;
          }
        } catch (error) {
          throw new Error(`Failed to rename script file: ${(error as Error).message}`);
        }

        // Add fileName to updateData if rename was successful
        if (newFileName) {
          updateData.fileName = newFileName;
        }
      }
    }

    // Wrap all post-rename operations in try-catch for comprehensive rollback
    try {
      // If content is provided, parse and validate
      if (data.content) {
        const format = existingScript.fileName.endsWith('.yaml') ? 'yaml' : 'json';
        let parsed: ParsedScript;
        if (format === 'yaml') {
          parsed = this.parser.parseYAML(data.content);
        } else {
          parsed = this.parser.parseJSON(data.content);
        }

        // Validate schema
        this.parser.validateSchema(parsed);

        // Validate template variables (always check, even if no inputs defined)
        this.templateEngine.validateTemplateVariables(parsed.script, parsed.inputs || []);

        // Update file on disk - use new filename if rename succeeded, otherwise use existing
        const currentFileName = newFileName || existingScript.fileName;
        const filePath = path.join(LIBRARY_DIR, currentFileName);
        await fs.writeFile(filePath, data.content, 'utf-8');

        // Extract metadata
        const metadata = this.parser.extractMetadata(parsed);
        updateData.os = (metadata as any).os as OS[];
        updateData.shell = (metadata as any).shell as ShellType;
        updateData.category = (metadata as any).category;
        updateData.tags = (metadata as any).tags;
      }

      // Update other fields
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.tags !== undefined) updateData.tags = data.tags;

      // Update database record
      const script = await this.prisma.script.update({
        where: { id },
        data: updateData
      });

      // Create audit log with change details (within try block to ensure script exists)
      await this.createAuditLogWithChanges(script, existingScript, data, newFileName, actorUserId, ipAddress, userAgent);

      // Invalidate cache after successful update
      ScriptManager.invalidateCache(id);

      return script;
    } catch (error) {
      // If any error occurs after file rename, rollback the rename
      if (oldFilePath && newFilePath && newFileName) {
        try {
          await fs.rename(newFilePath, oldFilePath);
          console.log(`Successfully rolled back file rename from ${newFilePath} to ${oldFilePath}`);
        } catch (rollbackError) {
          console.error(`Failed to rollback file rename: ${(rollbackError as Error).message}`);
        }
      }
      // Re-throw the original error
      throw error;
    }
  }

  /**
   * Helper method to create audit log with changes
   */
  private async createAuditLogWithChanges(
    script: Script,
    existingScript: Script,
    data: UpdateScriptInput,
    newFileName: string | null,
    actorUserId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Create audit log with change details
    const changes: Record<string, unknown> = {}
    if (data.name) changes.name = { from: existingScript.name, to: data.name }
    if (newFileName) changes.fileName = { from: existingScript.fileName, to: newFileName }
    if (data.description !== undefined) changes.description = { from: existingScript.description, to: data.description }
    if (data.category !== undefined) changes.category = { from: existingScript.category, to: data.category }
    if (data.content) changes.contentUpdated = true

    await this.createAuditLog(
      script.id,
      actorUserId,
      'EDITED',
      changes,
      ipAddress,
      userAgent
    );
  }

  /**
   * Delete a script
   */
  async deleteScript(id: string, ipAddress?: string, userAgent?: string): Promise<void> {
    // Find script
    const script = await this.prisma.script.findUnique({
      where: { id }
    });

    if (!script) {
      throw new Error(`Script with id '${id}' not found`);
    }

    // Create audit log before deletion
    await this.createAuditLog(
      script.id,
      script.createdById,
      'DELETED',
      { name: script.name, fileName: script.fileName },
      ipAddress,
      userAgent
    )

    // Invalidate cache before deletion
    ScriptManager.invalidateCache(id)

    // Delete file from disk
    const filePath = path.join(LIBRARY_DIR, script.fileName);
    if (await this.fileExists(filePath)) {
      await fs.unlink(filePath);
    }

    // Delete database record (cascade will handle executions, assignments, audit logs)
    await this.prisma.script.delete({
      where: { id }
    });
  }

  /**
   * Get a script by ID with content and parsed inputs
   */
  async getScript(id: string): Promise<ScriptWithContent> {
    // Find script in database
    const script = await this.prisma.script.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        _count: {
          select: {
            executions: true,
            departmentAssignments: true
          }
        }
      }
    });

    if (!script) {
      throw new Error(`Script with id '${id}' not found`);
    }

    // Read file content
    // Try library directory first, fall back to templates directory if not found
    let filePath = path.join(LIBRARY_DIR, script.fileName);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      // If file not found in library, try templates directory (for system templates)
      const templatePath = path.join(TEMPLATES_DIR, script.fileName);
      try {
        content = await fs.readFile(templatePath, 'utf-8');
        filePath = templatePath; // Update path for error messages
      } catch (templateError) {
        throw new Error(`Failed to read script file from both library and templates directories: ${(error as Error).message}`);
      }
    }

    // Check cache first
    const cached = ScriptManager.getCachedScript(id)
    let parsed: ParsedScript

    if (cached) {
      parsed = cached
    } else {
      // Parse content to extract inputs
      const format = script.fileName.endsWith('.yaml') ? 'yaml' : 'json';
      if (format === 'yaml') {
        parsed = this.parser.parseYAML(content);
      } else {
        parsed = this.parser.parseJSON(content);
      }

      // Cache the parsed script
      ScriptManager.setCachedScript(id, parsed)
    }

    const parsedInputs = this.parser.extractInputs(parsed);
    const hasInputs = this.parser.hasInputs(parsed);
    const inputCount = this.parser.getInputCount(parsed);

    return {
      ...script,
      content,
      scriptBody: parsed.script,
      parsedInputs,
      hasInputs,
      inputCount
    } as ScriptWithContent;
  }

  /**
   * List scripts with optional filters
   */
  async listScripts(filters?: ScriptFilters): Promise<Script[]> {
    const where: Prisma.ScriptWhereInput = {};

    if (filters) {
      if (filters.category) {
        where.category = filters.category;
      }

      if (filters.os) {
        where.os = {
          has: filters.os
        };
      }

      if (filters.tags && filters.tags.length > 0) {
        where.tags = {
          hasSome: filters.tags
        };
      }

      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } }
        ];
      }
    }

    const scripts = await this.prisma.script.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        _count: {
          select: {
            executions: true,
            departmentAssignments: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return scripts;
  }

  /**
   * Import a script from file content
   */
  async importScript(fileContent: string, format: 'yaml' | 'json', userId: string): Promise<Script> {
    // Parse content
    let parsed: ParsedScript;
    if (format === 'yaml') {
      parsed = this.parser.parseYAML(fileContent);
    } else {
      parsed = this.parser.parseJSON(fileContent);
    }

    // Validate schema
    this.parser.validateSchema(parsed);

    // Create script using createScript
    return this.createScript({
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      tags: parsed.tags,
      content: fileContent,
      format
    }, userId);
  }

  /**
   * Export a script
   */
  async exportScript(id: string, format: 'yaml' | 'json'): Promise<string> {
    const script = await this.getScript(id);
    return script.content;
  }

  /**
   * Get scripts assigned to a department
   */
  async getDepartmentScripts(departmentId: string): Promise<Script[]> {
    const scripts = await this.prisma.script.findMany({
      where: {
        departmentAssignments: {
          some: {
            departmentId
          }
        }
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        _count: {
          select: {
            executions: true,
            departmentAssignments: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    return scripts;
  }

  /**
   * Assign a script to a department
   */
  async assignScriptToDepartment(scriptId: string, departmentId: string, userId: string): Promise<void> {
    // Check if script exists
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId }
    });

    if (!script) {
      throw new Error(`Script with id '${scriptId}' not found`);
    }

    // Check if department exists
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId }
    });

    if (!department) {
      throw new Error(`Department with id '${departmentId}' not found`);
    }

    // Check if already assigned
    const existing = await this.prisma.departmentScript.findUnique({
      where: {
        departmentId_scriptId: {
          departmentId,
          scriptId
        }
      }
    });

    if (existing) {
      throw new Error('Script is already assigned to this department');
    }

    // Create assignment
    await this.prisma.departmentScript.create({
      data: {
        scriptId,
        departmentId,
        assignedById: userId
      }
    });
  }

  /**
   * Unassign a script from a department
   */
  async unassignScriptFromDepartment(scriptId: string, departmentId: string): Promise<void> {
    const assignment = await this.prisma.departmentScript.findUnique({
      where: {
        departmentId_scriptId: {
          departmentId,
          scriptId
        }
      }
    });

    if (!assignment) {
      throw new Error('Script is not assigned to this department');
    }

    await this.prisma.departmentScript.delete({
      where: {
        departmentId_scriptId: {
          departmentId,
          scriptId
        }
      }
    });
  }

  // Cache methods (static for shared access)

  private static getCachedScript(scriptId: string): ParsedScript | null {
    if (!ScriptManager.cacheConfig.enabled) return null

    const entry = ScriptManager.cache.get(scriptId)
    if (!entry) return null

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      ScriptManager.cache.delete(scriptId)
      return null
    }

    return entry.data
  }

  private static setCachedScript(scriptId: string, data: ParsedScript): void {
    if (!ScriptManager.cacheConfig.enabled) return

    // Check cache size limit
    if (ScriptManager.cache.size >= ScriptManager.cacheConfig.maxSize) {
      // Remove oldest entry
      const oldestKey = Array.from(ScriptManager.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0]
      if (oldestKey) ScriptManager.cache.delete(oldestKey)
    }

    ScriptManager.cache.set(scriptId, {
      data,
      timestamp: Date.now(),
      ttl: ScriptManager.cacheConfig.ttlMinutes * 60 * 1000
    })
  }

  public static invalidateCache(scriptId?: string): void {
    if (scriptId) {
      ScriptManager.cache.delete(scriptId)
    } else {
      ScriptManager.cache.clear()
    }
  }

  private static startCacheMaintenance(): void {
    // Run maintenance every 5 minutes
    ScriptManager.maintenanceTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of ScriptManager.cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          ScriptManager.cache.delete(key)
        }
      }
    }, 5 * 60 * 1000)
  }

  public static dispose(): void {
    if (ScriptManager.maintenanceTimer) {
      clearInterval(ScriptManager.maintenanceTimer)
      ScriptManager.maintenanceTimer = null
    }
    ScriptManager.cache.clear()
  }

  // Helper methods

  /**
   * Sanitize filename by removing special characters
   */
  private sanitizeFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Ensure directory exists, create if not
   */
  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
