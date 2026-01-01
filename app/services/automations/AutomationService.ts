import { PrismaClient, Automation, AutomationStatus, AutomationScope, Prisma, RecommendationType } from '@prisma/client';
import { BlocklyCodeGenerator } from './BlocklyCodeGenerator';
import { BlockRegistry, getBlockRegistry } from './BlockRegistry';
import { EventManager } from '../EventManager';

const debug = require('debug')('infinibay:automation:service');

export interface CreateAutomationInput {
  name: string;
  description?: string;
  blocklyWorkspace: Record<string, unknown>;
  targetScope?: AutomationScope;
  departmentId?: string;
  targetMachineIds?: string[];
  priority?: number;
  cooldownMinutes?: number;
  recommendationType?: string;
  recommendationText?: string;
  recommendationActionText?: string;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  blocklyWorkspace?: Record<string, unknown>;
  targetScope?: AutomationScope;
  departmentId?: string;
  priority?: number;
  cooldownMinutes?: number;
  recommendationType?: string;
  recommendationText?: string;
  recommendationActionText?: string;
}

export interface AutomationFilters {
  status?: AutomationStatus[];
  isEnabled?: boolean;
  departmentId?: string;
  search?: string;
  createdById?: string;
}

interface User {
  id: string;
  roles?: string[];
}

export class AutomationService {
  private codeGenerator: BlocklyCodeGenerator | null = null;
  private registry: BlockRegistry | null = null;

  constructor(
    private prisma: PrismaClient,
    private user: User | null,
    private eventManager?: EventManager
  ) {}

  /**
   * Initialize the code generator with block registry
   */
  private async getCodeGenerator(): Promise<BlocklyCodeGenerator> {
    if (!this.codeGenerator) {
      this.registry = await getBlockRegistry(this.prisma);
      this.codeGenerator = new BlocklyCodeGenerator(this.registry);
    }
    return this.codeGenerator;
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async createAutomation(input: CreateAutomationInput): Promise<Automation> {
    debug('Creating automation: %s', input.name);

    const codeGenerator = await this.getCodeGenerator();

    // 1. Generate code from workspace
    const generatedCode = codeGenerator.generate(input.blocklyWorkspace);

    // 2. Validate syntax
    const validation = codeGenerator.validateSyntax(generatedCode);
    if (!validation.valid) {
      throw new Error(`Invalid automation code: ${validation.error}`);
    }

    // 3. Create automation
    const automation = await this.prisma.automation.create({
      data: {
        name: input.name,
        description: input.description,
        blocklyWorkspace: input.blocklyWorkspace as Prisma.InputJsonValue,
        generatedCode,
        targetScope: input.targetScope ?? 'ALL_VMS',
        departmentId: input.departmentId,
        priority: input.priority ?? 100,
        cooldownMinutes: input.cooldownMinutes ?? 60,
        recommendationType: input.recommendationType as RecommendationType | undefined,
        recommendationText: input.recommendationText,
        recommendationActionText: input.recommendationActionText,
        status: 'DRAFT',
        createdById: this.user?.id,
      },
      include: this.defaultInclude,
    });

    // 4. If specific VMs, create targets
    if (input.targetScope === 'SPECIFIC_VMS' && input.targetMachineIds?.length) {
      await this.prisma.automationTarget.createMany({
        data: input.targetMachineIds.map(machineId => ({
          automationId: automation.id,
          machineId,
        })),
      });
    }

    // 5. Create initial version
    await this.createVersion(automation.id, 'Initial creation');

    // 6. Emit event
    this.eventManager?.emitCRUD('automations', 'create', automation.id, { automation });

    debug('Created automation: %s', automation.id);
    return automation;
  }

  async updateAutomation(id: string, input: UpdateAutomationInput): Promise<Automation> {
    debug('Updating automation: %s', id);

    const existing = await this.getAutomation(id);
    if (!existing) throw new Error('Automation not found');

    // If workspace changes, regenerate code
    let generatedCode = existing.generatedCode;
    let isCompiled = existing.isCompiled;

    if (input.blocklyWorkspace) {
      const codeGenerator = await this.getCodeGenerator();
      generatedCode = codeGenerator.generate(input.blocklyWorkspace);

      // Validate syntax
      const validation = codeGenerator.validateSyntax(generatedCode);
      if (!validation.valid) {
        throw new Error(`Invalid automation code: ${validation.error}`);
      }

      isCompiled = false;
    }

    const automation = await this.prisma.automation.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        blocklyWorkspace: input.blocklyWorkspace as Prisma.InputJsonValue,
        generatedCode,
        isCompiled,
        compiledCode: isCompiled ? existing.compiledCode : null,
        compilationError: null,
        targetScope: input.targetScope,
        departmentId: input.departmentId,
        priority: input.priority,
        cooldownMinutes: input.cooldownMinutes,
        recommendationType: input.recommendationType as RecommendationType | undefined,
        recommendationText: input.recommendationText,
        recommendationActionText: input.recommendationActionText,
      },
      include: this.defaultInclude,
    });

    // Create version if workspace changed
    if (input.blocklyWorkspace) {
      await this.createVersion(id, 'Updated blocks');
    }

    this.eventManager?.emitCRUD('automations', 'update', id, { automation });

    return automation;
  }

  async deleteAutomation(id: string): Promise<void> {
    debug('Deleting automation: %s', id);

    await this.prisma.automation.delete({ where: { id } });
    this.eventManager?.emitCRUD('automations', 'delete', id);
  }

  async getAutomation(id: string): Promise<Automation | null> {
    return this.prisma.automation.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  async listAutomations(filters?: AutomationFilters): Promise<Automation[]> {
    const where: Prisma.AutomationWhereInput = {};

    if (filters?.status?.length) {
      where.status = { in: filters.status };
    }
    if (filters?.isEnabled !== undefined) {
      where.isEnabled = filters.isEnabled;
    }
    if (filters?.departmentId) {
      where.departmentId = filters.departmentId;
    }
    if (filters?.createdById) {
      where.createdById = filters.createdById;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.automation.findMany({
      where,
      include: this.defaultInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // WORKFLOW OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async submitForApproval(id: string): Promise<Automation> {
    debug('Submitting automation for approval: %s', id);

    // First compile to validate
    await this.compileAutomation(id);

    return this.prisma.automation.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
      include: this.defaultInclude,
    });
  }

  async approveAutomation(id: string): Promise<Automation> {
    debug('Approving automation: %s', id);

    // Verify user has approval permissions
    if (!this.user?.roles?.includes('admin')) {
      throw new Error('Only admins can approve automations');
    }

    return this.prisma.automation.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: this.user.id,
        approvedAt: new Date(),
      },
      include: this.defaultInclude,
    });
  }

  async rejectAutomation(id: string, reason: string): Promise<Automation> {
    debug('Rejecting automation: %s, reason: %s', id, reason);

    return this.prisma.automation.update({
      where: { id },
      data: {
        status: 'REJECTED',
        compilationError: reason,
      },
      include: this.defaultInclude,
    });
  }

  async enableAutomation(id: string): Promise<Automation> {
    const automation = await this.getAutomation(id);
    if (automation?.status !== 'APPROVED') {
      throw new Error('Only approved automations can be enabled');
    }

    return this.prisma.automation.update({
      where: { id },
      data: { isEnabled: true },
      include: this.defaultInclude,
    });
  }

  async disableAutomation(id: string): Promise<Automation> {
    return this.prisma.automation.update({
      where: { id },
      data: { isEnabled: false },
      include: this.defaultInclude,
    });
  }

  async archiveAutomation(id: string): Promise<Automation> {
    return this.prisma.automation.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        isEnabled: false,
      },
      include: this.defaultInclude,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPILATION
  // ═══════════════════════════════════════════════════════════════

  async compileAutomation(id: string): Promise<Automation> {
    debug('Compiling automation: %s', id);

    const automation = await this.getAutomation(id);
    if (!automation) throw new Error('Automation not found');

    try {
      const codeGenerator = await this.getCodeGenerator();

      // 1. Regenerate code from workspace
      const generatedCode = codeGenerator.generate(
        automation.blocklyWorkspace as Record<string, unknown>
      );

      // 2. Validate syntax
      const validation = codeGenerator.validateSyntax(generatedCode);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 3. Wrap code for execution
      const compiledCode = this.wrapForExecution(generatedCode);

      // 4. Update
      return this.prisma.automation.update({
        where: { id },
        data: {
          generatedCode,
          compiledCode,
          isCompiled: true,
          compilationError: null,
        },
        include: this.defaultInclude,
      });
    } catch (error) {
      // Save compilation error
      await this.prisma.automation.update({
        where: { id },
        data: {
          isCompiled: false,
          compilationError: error instanceof Error ? error.message : 'Unknown compilation error',
        },
      });
      throw error;
    }
  }

  private wrapForExecution(code: string): string {
    return `
      (function evaluate(context) {
        ${code}
      })
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCRIPT LINKING
  // ═══════════════════════════════════════════════════════════════

  async linkScript(
    automationId: string,
    scriptId: string,
    os: 'WINDOWS' | 'LINUX',
    options?: {
      executionOrder?: number;
      executeOnTrigger?: boolean;
    }
  ): Promise<void> {
    await this.prisma.automationScript.create({
      data: {
        automationId,
        scriptId,
        os,
        executionOrder: options?.executionOrder ?? 0,
        isEnabled: options?.executeOnTrigger ?? true,
      },
    });
  }

  async linkSystemScript(
    automationId: string,
    systemScriptId: string,
    os: 'WINDOWS' | 'LINUX',
    options?: {
      executionOrder?: number;
      executeOnTrigger?: boolean;
    }
  ): Promise<void> {
    await this.prisma.automationScript.create({
      data: {
        automationId,
        systemScriptId,
        os,
        executionOrder: options?.executionOrder ?? 0,
        isEnabled: options?.executeOnTrigger ?? true,
      },
    });
  }

  async unlinkScript(automationId: string, scriptId: string, os: 'WINDOWS' | 'LINUX'): Promise<void> {
    await this.prisma.automationScript.deleteMany({
      where: {
        automationId,
        scriptId,
        os,
      },
    });
  }

  async unlinkSystemScript(automationId: string, systemScriptId: string, os: 'WINDOWS' | 'LINUX'): Promise<void> {
    await this.prisma.automationScript.deleteMany({
      where: {
        automationId,
        systemScriptId,
        os,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TARGET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  async setTargetMachines(automationId: string, machineIds: string[]): Promise<void> {
    // Delete existing targets
    await this.prisma.automationTarget.deleteMany({
      where: { automationId },
    });

    // Create new targets
    if (machineIds.length > 0) {
      await this.prisma.automationTarget.createMany({
        data: machineIds.map(machineId => ({
          automationId,
          machineId,
        })),
      });
    }
  }

  async addTargetMachine(automationId: string, machineId: string): Promise<void> {
    await this.prisma.automationTarget.create({
      data: { automationId, machineId },
    });
  }

  async removeTargetMachine(automationId: string, machineId: string): Promise<void> {
    await this.prisma.automationTarget.deleteMany({
      where: { automationId, machineId },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VERSIONING
  // ═══════════════════════════════════════════════════════════════

  private async createVersion(automationId: string, changeReason: string): Promise<void> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
    });

    if (!automation) return;

    // Get current max version
    const lastVersion = await this.prisma.automationVersion.findFirst({
      where: { automationId },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (lastVersion?.version ?? 0) + 1;

    await this.prisma.automationVersion.create({
      data: {
        automationId,
        version: nextVersion,
        blocklyWorkspace: automation.blocklyWorkspace as Prisma.InputJsonValue,
        generatedCode: automation.generatedCode,
        changedById: this.user?.id,
        changeReason,
      },
    });
  }

  async getVersions(automationId: string): Promise<Array<{
    id: string;
    version: number;
    changeReason: string | null;
    createdAt: Date;
    changedBy: { id: string; firstName: string; lastName: string } | null;
  }>> {
    return this.prisma.automationVersion.findMany({
      where: { automationId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        changeReason: true,
        createdAt: true,
        changedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async restoreVersion(automationId: string, versionId: string): Promise<Automation> {
    const version = await this.prisma.automationVersion.findUnique({
      where: { id: versionId },
    });

    if (!version || version.automationId !== automationId) {
      throw new Error('Version not found');
    }

    // Update automation with version data
    const automation = await this.prisma.automation.update({
      where: { id: automationId },
      data: {
        blocklyWorkspace: version.blocklyWorkspace as Prisma.InputJsonValue,
        generatedCode: version.generatedCode,
        isCompiled: false,
        compiledCode: null,
      },
      include: this.defaultInclude,
    });

    // Create new version for the restore
    await this.createVersion(automationId, `Restored from version ${version.version}`);

    return automation;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private defaultInclude = {
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    department: { select: { id: true, name: true } },
    automationScripts: {
      include: {
        script: { select: { id: true, name: true, os: true } },
        systemScript: { select: { id: true, name: true, displayName: true } },
      },
    },
    targets: {
      include: {
        machine: { select: { id: true, name: true } },
      },
    },
    _count: {
      select: { executions: true },
    },
  };
}
