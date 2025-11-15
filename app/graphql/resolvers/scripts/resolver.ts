import { Resolver, Query, Mutation, Arg, Ctx, ID, Int, Authorized } from 'type-graphql';
import { UserInputError } from 'apollo-server-errors';
import { ScriptManager } from '../../../services/scripts/ScriptManager';
import { ScriptExecutor } from '../../../services/scripts/ScriptExecutor';
import { ScriptScheduler } from '../../../services/scripts/ScriptScheduler';
import { getEventManager } from '../../../services/EventManager';
import {
  ScriptType,
  ScriptResponseType,
  ScriptExecutionType,
  ScriptExecutionResponseType,
  ScriptExecutionsResponseType,
  CreateScriptInput,
  UpdateScriptInput,
  ExecuteScriptInput,
  ScriptFiltersInput,
  ScriptExecutionsFiltersInput,
  ScheduleScriptInput,
  UpdateScheduledScriptInput,
  ScheduledScriptsFiltersInput,
  ScheduleScriptResponseType,
  ScheduledScriptType,
  ScheduleType
} from './type';
import { InfinibayContext } from '../../../utils/context';
import { ExecutionStatus, ExecutionType } from '@prisma/client';

// Helper function to extract request metadata
function extractRequestMetadata(ctx: InfinibayContext): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress || undefined,
    userAgent: ctx.req.headers['user-agent'] || undefined
  }
}

// Helper function to normalize execution inputValues (ensure never null)
function normalizeExecution(execution: any): any {
  return {
    ...execution,
    inputValues: execution.inputValues ?? {}
  };
}

// Helper function to normalize array of executions
function normalizeExecutions(executions: any[]): any[] {
  return executions.map(normalizeExecution);
}

// Helper function to normalize script (convert null to undefined for optional fields)
function normalizeScript(script: any): any {
  return {
    ...script,
    description: script.description ?? undefined,
    category: script.category ?? undefined,
    createdBy: script.createdBy ?? undefined,
  };
}

@Resolver()
export class ScriptResolver {
  /**
   * Query: Get all scripts with optional filters
   */
  @Query(() => [ScriptType])
  @Authorized('USER')
  async scripts(
    @Arg('filters', () => ScriptFiltersInput, { nullable: true }) filters: ScriptFiltersInput | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<any[]> {
    const scriptManager = new ScriptManager(ctx.prisma);
    const scripts = await scriptManager.listScripts(filters || undefined);

    // Map scripts to include computed fields
    return scripts.map(script => ({
      ...script,
      hasInputs: false, // Will be computed when content is loaded
      inputCount: 0,    // Will be computed when content is loaded
      parsedInputs: [],
      executionCount: (script as any)._count?.executions || 0,
      departmentCount: (script as any)._count?.departmentAssignments || 0
    }));
  }

  /**
   * Query: Get a single script by ID with full details
   */
  @Query(() => ScriptType, { nullable: true })
  @Authorized('USER')
  async script(
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<any | null> {
    try {
      const scriptManager = new ScriptManager(ctx.prisma);
      const script = await scriptManager.getScript(id);

      return {
        ...script,
        executionCount: (script as any)._count?.executions || 0,
        departmentCount: (script as any)._count?.departmentAssignments || 0
      };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Query: Get scripts assigned to a department
   */
  @Query(() => [ScriptType])
  @Authorized('USER')
  async departmentScripts(
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<any[]> {
    const scriptManager = new ScriptManager(ctx.prisma);
    const scripts = await scriptManager.getDepartmentScripts(departmentId);

    return scripts.map(script => ({
      ...script,
      hasInputs: false,
      inputCount: 0,
      parsedInputs: [],
      executionCount: (script as any)._count?.executions || 0,
      departmentCount: (script as any)._count?.departmentAssignments || 0
    }));
  }

  /**
   * Query: Get script executions for a machine
   */
  @Query(() => [ScriptExecutionType])
  @Authorized('USER')
  async scriptExecutions(
    @Arg('machineId', () => ID) machineId: string,
    @Arg('status', () => ExecutionStatus, { nullable: true }) status: ExecutionStatus | null,
    @Arg('limit', () => Int, { nullable: true, defaultValue: 50 }) limit: number,
    @Ctx() ctx: InfinibayContext
  ): Promise<any[]> {
    const where: any = { machineId };
    if (status) {
      where.status = status;
    }

    const executions = await ctx.prisma.scriptExecution.findMany({
      where,
      include: {
        script: {
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        machine: {
          select: {
            id: true,
            name: true,
            status: true,
            os: true
          }
        },
        triggeredBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    });

    return normalizeExecutions(executions);
  }

  /**
   * Query: Get script executions with advanced filtering and pagination
   */
  @Query(() => ScriptExecutionsResponseType)
  @Authorized('USER')
  async scriptExecutionsFiltered(
    @Arg('filters', () => ScriptExecutionsFiltersInput) filters: ScriptExecutionsFiltersInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<any> {
    // Validate inputs
    if (filters.limit && filters.limit > 100) {
      throw new UserInputError('Limit cannot exceed 100');
    }
    if (filters.offset && filters.offset < 0) {
      throw new UserInputError('Offset must be non-negative');
    }
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      throw new UserInputError('Start date must be before end date');
    }

    // Require at least one identifier for efficient querying
    if (!filters.scriptId && !filters.machineId && !filters.departmentId) {
      throw new UserInputError('At least one of scriptId, machineId, or departmentId must be provided');
    }

    // Build Prisma where clause
    const where: any = {};

    // Filter by script ID
    if (filters.scriptId) {
      where.scriptId = filters.scriptId;
    }

    // Filter by machine ID (prefer specific machine over department)
    if (filters.machineId) {
      where.machineId = filters.machineId;
    } else if (filters.departmentId) {
      // Filter by department (expand to all VMs in department) only if no specific machine
      const machines = await ctx.prisma.machine.findMany({
        where: { departmentId: filters.departmentId },
        select: { id: true }
      });
      const machineIds = machines.map(m => m.id);
      where.machineId = { in: machineIds };
    }

    // Filter by status
    if (filters.status) {
      where.status = filters.status;
    }

    // Filter by execution type
    if (filters.executionType) {
      where.executionType = filters.executionType;
    }

    // Filter by date range
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.createdAt.lte = filters.endDate;
      }
    }

    // Authorization check
    if (!ctx.user) {
      return {
        executions: [],
        total: 0,
        hasMore: false,
        offset: filters.offset,
        limit: filters.limit
      };
    }

    const isAdmin = ctx.user.role === 'ADMIN';

    // If not admin, verify user has access
    if (!isAdmin) {
      if (filters.scriptId) {
        const script = await ctx.prisma.script.findUnique({
          where: { id: filters.scriptId },
          select: { createdById: true }
        });
        if (!script || script.createdById !== ctx.user.id) {
          return {
            executions: [],
            total: 0,
            hasMore: false,
            offset: filters.offset,
            limit: filters.limit
          };
        }
      }

      if (filters.machineId) {
        const machine = await ctx.prisma.machine.findUnique({
          where: { id: filters.machineId },
          select: { userId: true }
        });
        if (!machine || machine.userId !== ctx.user.id) {
          return {
            executions: [],
            total: 0,
            hasMore: false,
            offset: filters.offset,
            limit: filters.limit
          };
        }
      }

      if (filters.departmentId) {
        // Check if user has access to any machines in the department
        const machineCount = await ctx.prisma.machine.count({
          where: {
            departmentId: filters.departmentId,
            userId: ctx.user.id
          }
        });
        if (machineCount === 0) {
          return {
            executions: [],
            total: 0,
            hasMore: false,
            offset: filters.offset,
            limit: filters.limit
          };
        }
      }
    }

    // Get total count
    const total = await ctx.prisma.scriptExecution.count({ where });

    // Get paginated executions
    const limit = filters.limit;
    const offset = filters.offset;

    const executions = await ctx.prisma.scriptExecution.findMany({
      where,
      include: {
        script: {
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        machine: {
          select: {
            id: true,
            name: true,
            status: true,
            os: true,
            department: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        triggeredBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: offset,
      take: limit
    });

    const hasMore = total > offset + executions.length;

    return {
      executions: normalizeExecutions(executions),
      total,
      hasMore,
      offset,
      limit
    };
  }

  /**
   * Query: Get a single script execution by ID
   */
  @Query(() => ScriptExecutionType, { nullable: true })
  @Authorized('USER')
  async scriptExecution(
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<any | null> {
    const execution = await ctx.prisma.scriptExecution.findUnique({
      where: { id },
      include: {
        script: {
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        machine: {
          select: {
            id: true,
            name: true,
            status: true,
            os: true
          }
        },
        triggeredBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    return execution ? normalizeExecution(execution) : null;
  }

  /**
   * Query: Get list of users on a VM for "Run As" selection
   */
  @Query(() => [String])
  @Authorized('USER')
  async vmUsers(
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<string[]> {
    // Initialize with Windows defaults (fallback)
    let defaultUsers: string[] = ['administrator', 'system']

    try {
      // Check user access to machine
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: machineId },
        select: { userId: true, status: true, os: true }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isOwner = machine.userId === ctx.user!.id
      const isAdmin = ctx.user!.role === 'ADMIN'

      if (!isOwner && !isAdmin) {
        throw new Error('Access denied')
      }

      // Determine OS-aware defaults
      const isLinux = machine.os.toLowerCase().includes('linux')
      defaultUsers = isLinux
        ? ['root', 'system']
        : ['administrator', 'system']

      // Check if VM is running
      if (machine.status !== 'running') {
        return defaultUsers // Return OS-aware defaults if VM is not running
      }

      // Get user list from infiniservice
      if (!ctx.virtioSocketWatcher) {
        return defaultUsers // Return OS-aware defaults if service not available
      }

      const response = await ctx.virtioSocketWatcher.getUserList(machineId, 10000)

      if (!response.success || !response.data) {
        return defaultUsers // Return OS-aware defaults on error
      }

      // Extract usernames from response
      const users = (response.data as any[]).map((user: any) => user.username)

      // Always include OS-aware defaults
      const userSet = new Set([...defaultUsers, ...users])
      return Array.from(userSet)
    } catch (error) {
      console.error('Error fetching VM users:', error)
      // Return OS-aware defaults on error
      return defaultUsers
    }
  }

  /**
   * Mutation: Create a new script
   */
  @Mutation(() => ScriptResponseType)
  @Authorized('ADMIN')
  async createScript(
    @Arg('input', () => CreateScriptInput) input: CreateScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptResponseType> {
    try {
      const { ipAddress, userAgent } = extractRequestMetadata(ctx)
      const scriptManager = new ScriptManager(ctx.prisma);
      const script = await scriptManager.createScript(input, ctx.user!.id, ipAddress, userAgent);

      // Dispatch event for real-time updates
      getEventManager().dispatchEvent('scripts', 'create', { id: script.id }, ctx.user!.id);

      return {
        success: true,
        message: 'Script created successfully',
        script: {
          ...script,
          hasInputs: false,
          inputCount: 0,
          parsedInputs: []
        } as any
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Update an existing script
   */
  @Mutation(() => ScriptResponseType)
  @Authorized('ADMIN')
  async updateScript(
    @Arg('input', () => UpdateScriptInput) input: UpdateScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptResponseType> {
    try {
      const { ipAddress, userAgent } = extractRequestMetadata(ctx)
      const scriptManager = new ScriptManager(ctx.prisma);
      const { id, ...updateData } = input;
      await scriptManager.updateScript(id, updateData, ctx.user!.id, ipAddress, userAgent);

      // Fetch the complete updated script with parsed inputs
      const updatedScript = await scriptManager.getScript(id);

      // Dispatch event for real-time updates
      getEventManager().dispatchEvent('scripts', 'update', { id: updatedScript.id }, ctx.user!.id);

      return {
        success: true,
        message: 'Script updated successfully',
        script: normalizeScript({
          ...updatedScript,
          executionCount: (updatedScript as any)._count?.executions || 0,
          departmentCount: (updatedScript as any)._count?.departmentAssignments || 0
        })
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Delete a script
   */
  @Mutation(() => ScriptResponseType)
  @Authorized('ADMIN')
  async deleteScript(
    @Arg('id', () => ID) id: string,
    @Arg('force', { nullable: true, defaultValue: false }) force: boolean,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptResponseType> {
    try {
      // Check for active schedules before deletion
      const scheduler = new ScriptScheduler(ctx.prisma);
      const activeSchedules = await scheduler.hasActiveSchedules(id);

      if (activeSchedules.count > 0 && !force) {
        const vmNames = activeSchedules.affectedVMs.map(vm => vm.name).slice(0, 5).join(', ');
        const moreText = activeSchedules.affectedVMs.length > 5 ? ` and ${activeSchedules.affectedVMs.length - 5} more` : '';

        return {
          success: false,
          error: `Cannot delete script with ${activeSchedules.count} active schedule${activeSchedules.count > 1 ? 's' : ''}. Affected VMs: ${vmNames}${moreText}. Set force=true to cancel schedules and delete.`
        };
      }

      // If force=true and there are active schedules, cancel them first
      if (activeSchedules.count > 0 && force) {
        const executions = await ctx.prisma.scriptExecution.findMany({
          where: {
            scriptId: id,
            status: {
              in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING]
            }
          },
          select: { id: true }
        });

        // Cancel all active schedules
        for (const exec of executions) {
          await scheduler.cancelScheduledScript(exec.id, ctx.user!.id);
        }
      }

      const { ipAddress, userAgent } = extractRequestMetadata(ctx)
      const scriptManager = new ScriptManager(ctx.prisma);
      await scriptManager.deleteScript(id, ipAddress, userAgent);

      // Dispatch event for real-time updates
      getEventManager().dispatchEvent('scripts', 'delete', { id }, ctx.user!.id);

      return {
        success: true,
        message: force && activeSchedules.count > 0
          ? `Script deleted successfully. Cancelled ${activeSchedules.count} active schedule${activeSchedules.count > 1 ? 's' : ''}.`
          : 'Script deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Assign a script to a department
   */
  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async assignScriptToDepartment(
    @Arg('scriptId', () => ID) scriptId: string,
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const scriptManager = new ScriptManager(ctx.prisma);
    await scriptManager.assignScriptToDepartment(scriptId, departmentId, ctx.user!.id);
    return true;
  }

  /**
   * Mutation: Unassign a script from a department
   */
  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async unassignScriptFromDepartment(
    @Arg('scriptId', () => ID) scriptId: string,
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const scriptManager = new ScriptManager(ctx.prisma);
    await scriptManager.unassignScriptFromDepartment(scriptId, departmentId);
    return true;
  }

  /**
   * Mutation: Execute a script on a machine
   */
  @Mutation(() => ScriptExecutionResponseType)
  @Authorized('USER')
  async executeScript(
    @Arg('input', () => ExecuteScriptInput) input: ExecuteScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptExecutionResponseType> {
    try {
      // Check user access to machine (owner or admin)
      const machine = await ctx.prisma.machine.findUnique({
        where: { id: input.machineId },
        select: { userId: true, departmentId: true }
      });

      if (!machine) {
        return {
          success: false,
          error: 'Machine not found'
        };
      }

      const isOwner = machine.userId === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'ADMIN';

      if (!isOwner && !isAdmin) {
        return {
          success: false,
          error: 'You do not have permission to execute scripts on this machine'
        };
      }

      // Verify script is assigned to machine's department
      if (machine.departmentId) {
        const scriptAssignment = await ctx.prisma.departmentScript.findUnique({
          where: {
            departmentId_scriptId: {
              departmentId: machine.departmentId,
              scriptId: input.scriptId
            }
          }
        });

        if (!scriptAssignment) {
          return {
            success: false,
            error: 'This script is not assigned to the machine\'s department'
          };
        }
      }

      // Extract request metadata
      const { ipAddress, userAgent } = extractRequestMetadata(ctx)

      // Create ScriptExecutor instance
      const scriptExecutor = new ScriptExecutor(ctx.prisma);

      // Execute the script
      const result = await scriptExecutor.executeScript({
        scriptId: input.scriptId,
        machineId: input.machineId,
        inputValues: input.inputValues || {},
        executionType: ExecutionType.ON_DEMAND,
        triggeredById: ctx.user!.id,
        runAs: input.runAs,
        ipAddress,
        userAgent
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      // Query the created execution with relations
      const execution = await ctx.prisma.scriptExecution.findUnique({
        where: { id: result.executionId },
        include: {
          script: {
            include: {
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          machine: {
            select: {
              id: true,
              name: true,
              status: true,
              os: true
            }
          },
          triggeredBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      });

      return {
        success: true,
        message: 'Script execution started',
        execution: execution ? normalizeExecution(execution) : null
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Cancel a running or pending script execution
   */
  @Mutation(() => ScriptExecutionResponseType)
  @Authorized('USER')
  async cancelScriptExecution(
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptExecutionResponseType> {
    try {
      // Query execution to check ownership
      const execution = await ctx.prisma.scriptExecution.findUnique({
        where: { id },
        include: {
          machine: {
            select: { userId: true }
          }
        }
      });

      if (!execution) {
        return {
          success: false,
          error: 'Execution not found'
        };
      }

      // Check permissions: triggeredBy, machine owner, or admin
      const isTriggeredBy = execution.triggeredById === ctx.user!.id;
      const isOwner = execution.machine.userId === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'ADMIN';

      if (!isTriggeredBy && !isOwner && !isAdmin) {
        return {
          success: false,
          error: 'You do not have permission to cancel this execution'
        };
      }

      // Create ScriptExecutor instance
      const scriptExecutor = new ScriptExecutor(ctx.prisma);

      // Cancel the execution
      await scriptExecutor.cancelScriptExecution(id);

      // Query updated execution with relations
      const updatedExecution = await ctx.prisma.scriptExecution.findUnique({
        where: { id },
        include: {
          script: {
            include: {
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          machine: {
            select: {
              id: true,
              name: true,
              status: true,
              os: true
            }
          },
          triggeredBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      });

      return {
        success: true,
        message: 'Script execution cancelled',
        execution: updatedExecution ? normalizeExecution(updatedExecution) : null
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  // ========================================
  // Scheduling Queries and Mutations
  // ========================================

  /**
   * Helper: Compute schedule type from execution record
   */
  private computeScheduleType(execution: any): ScheduleType {
    if (execution.repeatIntervalMinutes !== null) {
      return ScheduleType.PERIODIC;
    }

    const now = new Date();
    const scheduledFor = new Date(execution.scheduledFor);

    if (Math.abs(scheduledFor.getTime() - now.getTime()) < 60000) {
      return ScheduleType.IMMEDIATE;
    }

    return ScheduleType.ONE_TIME;
  }

  /**
   * Helper: Compute next execution time for periodic schedules
   */
  private computeNextExecutionAt(execution: any): Date | null {
    if (!execution.repeatIntervalMinutes) {
      return null;
    }

    const lastExecuted = execution.lastExecutedAt ? new Date(execution.lastExecutedAt) : new Date();
    const nextExecution = new Date(lastExecuted);
    nextExecution.setMinutes(nextExecution.getMinutes() + execution.repeatIntervalMinutes);

    return nextExecution;
  }

  /**
   * Query: Get scheduled scripts with filters
   */
  @Query(() => [ScheduledScriptType])
  @Authorized('USER')
  async scheduledScripts(
    @Arg('filters', () => ScheduledScriptsFiltersInput, { nullable: true }) filters: ScheduledScriptsFiltersInput | null,
    @Ctx() ctx: InfinibayContext
  ): Promise<any[]> {
    const scheduler = new ScriptScheduler(ctx.prisma);

    // Convert ScheduleType enum to query filters
    const queryFilters: any = { ...filters };
    if (filters?.scheduleType) {
      queryFilters.scheduleType = filters.scheduleType === ScheduleType.PERIODIC ? 'periodic' : 'one-time';
    }

    const executions = await scheduler.getScheduledScripts(queryFilters);

    // Map to ScheduledScriptType with computed fields
    return executions.map(execution => ({
      ...normalizeExecution(execution),
      scheduleType: this.computeScheduleType(execution),
      nextExecutionAt: this.computeNextExecutionAt(execution),
      isActive: execution.status === ExecutionStatus.PENDING || execution.status === ExecutionStatus.RUNNING
    }));
  }

  /**
   * Query: Get a single scheduled script by execution ID
   */
  @Query(() => ScheduledScriptType, { nullable: true })
  @Authorized('USER')
  async scheduledScript(
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<any | null> {
    const execution = await ctx.prisma.scriptExecution.findUnique({
      where: { id },
      include: {
        script: {
          include: {
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            }
          }
        },
        machine: {
          select: {
            id: true,
            name: true,
            status: true,
            os: true,
            userId: true
          }
        },
        triggeredBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!execution || execution.executionType !== ExecutionType.SCHEDULED) {
      return null;
    }

    // Check permissions: triggeredBy, machine owner, or admin
    const isTriggeredBy = execution.triggeredById === ctx.user!.id;
    const isOwner = execution.machine && (execution.machine as any).userId === ctx.user!.id;
    const isAdmin = ctx.user!.role === 'ADMIN';

    if (!isTriggeredBy && !isOwner && !isAdmin) {
      return null;
    }

    return {
      ...normalizeExecution(execution),
      scheduleType: this.computeScheduleType(execution),
      nextExecutionAt: this.computeNextExecutionAt(execution),
      isActive: execution.status === ExecutionStatus.PENDING || execution.status === ExecutionStatus.RUNNING
    };
  }

  /**
   * Mutation: Schedule a script for execution
   */
  @Mutation(() => ScheduleScriptResponseType)
  @Authorized('USER')
  async scheduleScript(
    @Arg('input', () => ScheduleScriptInput) input: ScheduleScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScheduleScriptResponseType> {
    try {
      // Validate input
      if (!input.machineIds && !input.departmentId) {
        return {
          success: false,
          error: 'Either machineIds or departmentId must be provided'
        };
      }

      if (input.scheduleType === ScheduleType.ONE_TIME && !input.scheduledFor) {
        return {
          success: false,
          error: 'scheduledFor is required for ONE_TIME schedules'
        };
      }

      if (input.scheduleType === ScheduleType.ONE_TIME && input.scheduledFor && input.scheduledFor <= new Date()) {
        return {
          success: false,
          error: 'scheduledFor must be in the future for ONE_TIME schedules'
        };
      }

      if (input.scheduleType === ScheduleType.PERIODIC && (!input.repeatIntervalMinutes || input.repeatIntervalMinutes <= 0)) {
        return {
          success: false,
          error: 'repeatIntervalMinutes must be greater than 0 for PERIODIC schedules'
        };
      }

      // Verify script exists
      const script = await ctx.prisma.script.findUnique({
        where: { id: input.scriptId },
        select: { createdById: true }
      });

      if (!script) {
        return {
          success: false,
          error: 'Script not found'
        };
      }

      const isScriptCreator = script.createdById === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'ADMIN';

      // If departmentId provided, verify user has access to department
      if (input.departmentId) {
        const department = await ctx.prisma.department.findUnique({
          where: { id: input.departmentId }
        });

        if (!department) {
          return {
            success: false,
            error: 'Department not found'
          };
        }

        // Only admin can schedule for department-wide
        if (!isAdmin) {
          return {
            success: false,
            error: 'Only administrators can schedule scripts for departments'
          };
        }
      }

      // If machineIds provided, verify user has access to all machines
      let hasAccessToAllMachines = false;
      if (input.machineIds && input.machineIds.length > 0) {
        hasAccessToAllMachines = true;
        for (const machineId of input.machineIds) {
          const machine = await ctx.prisma.machine.findUnique({
            where: { id: machineId },
            select: { userId: true }
          });

          if (!machine) {
            return {
              success: false,
              error: `Machine ${machineId} not found`
            };
          }

          const isOwner = machine.userId === ctx.user!.id;
          if (!isOwner && !isAdmin) {
            hasAccessToAllMachines = false;
            return {
              success: false,
              error: 'You do not have permission to schedule scripts on one or more of the specified machines'
            };
          }
        }
      }

      // Combined permission check: admin OR script creator OR has access to all target machines
      if (!isAdmin && !isScriptCreator && !hasAccessToAllMachines) {
        return {
          success: false,
          error: 'You do not have permission to schedule this script'
        };
      }

      // Create scheduler instance
      const scheduler = new ScriptScheduler(ctx.prisma);

      // Build config
      const config: any = {
        scriptId: input.scriptId,
        inputValues: input.inputValues || {},
        userId: ctx.user!.id,
        runAs: input.runAs
      };

      // Map ScheduleType enum to scheduleType string
      if (input.scheduleType === ScheduleType.IMMEDIATE) {
        config.scheduleType = 'immediate';
      } else if (input.scheduleType === ScheduleType.ONE_TIME) {
        config.scheduleType = 'one-time';
        config.scheduledFor = input.scheduledFor;
      } else if (input.scheduleType === ScheduleType.PERIODIC) {
        config.scheduleType = 'periodic';
        config.repeatIntervalMinutes = input.repeatIntervalMinutes;
        config.maxExecutions = input.maxExecutions;
      }

      if (input.machineIds) {
        config.machineIds = input.machineIds;
      }

      if (input.departmentId) {
        config.departmentId = input.departmentId;
      }

      // Schedule the script
      const result = await scheduler.scheduleScript(config);

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      // Query created executions with full relations
      const executions = await ctx.prisma.scriptExecution.findMany({
        where: {
          id: { in: result.executionIds }
        },
        include: {
          script: {
            include: {
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          machine: {
            select: {
              id: true,
              name: true,
              status: true,
              os: true
            }
          },
          triggeredBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      });

      // Map to ScheduledScriptType
      const scheduledScripts = executions.map(execution => ({
        ...normalizeExecution(execution),
        scheduleType: this.computeScheduleType(execution),
        nextExecutionAt: this.computeNextExecutionAt(execution),
        isActive: execution.status === ExecutionStatus.PENDING || execution.status === ExecutionStatus.RUNNING
      }));

      return {
        success: true,
        message: 'Script scheduled successfully',
        executionIds: result.executionIds,
        executions: scheduledScripts,
        warnings: result.warnings
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Update a scheduled script
   */
  @Mutation(() => ScheduleScriptResponseType)
  @Authorized('USER')
  async updateScheduledScript(
    @Arg('input', () => UpdateScheduledScriptInput) input: UpdateScheduledScriptInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScheduleScriptResponseType> {
    try {
      // Query existing execution to verify it exists and is PENDING
      const execution = await ctx.prisma.scriptExecution.findUnique({
        where: { id: input.executionId },
        include: {
          machine: {
            select: { userId: true }
          }
        }
      });

      if (!execution) {
        return {
          success: false,
          error: 'Scheduled script execution not found'
        };
      }

      if (execution.status !== ExecutionStatus.PENDING) {
        return {
          success: false,
          error: `Cannot update execution with status ${execution.status}. Only PENDING executions can be updated.`
        };
      }

      // Verify user has permission (triggeredBy, machine owner, or admin)
      const isTriggeredBy = execution.triggeredById === ctx.user!.id;
      const isOwner = execution.machine.userId === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'ADMIN';

      if (!isTriggeredBy && !isOwner && !isAdmin) {
        return {
          success: false,
          error: 'You do not have permission to update this scheduled script'
        };
      }

      // Create scheduler instance
      const scheduler = new ScriptScheduler(ctx.prisma);

      // Update the schedule
      const result = await scheduler.updateScheduledScript(input.executionId, input, ctx.user!.id);

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      // Query updated execution with relations
      const updatedExecution = await ctx.prisma.scriptExecution.findUnique({
        where: { id: input.executionId },
        include: {
          script: {
            include: {
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            }
          },
          machine: {
            select: {
              id: true,
              name: true,
              status: true,
              os: true
            }
          },
          triggeredBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      });

      const scheduledScript = updatedExecution ? {
        ...normalizeExecution(updatedExecution),
        scheduleType: this.computeScheduleType(updatedExecution),
        nextExecutionAt: this.computeNextExecutionAt(updatedExecution),
        isActive: updatedExecution.status === ExecutionStatus.PENDING || updatedExecution.status === ExecutionStatus.RUNNING
      } : null;

      return {
        success: true,
        message: 'Schedule updated successfully',
        executionIds: [input.executionId],
        executions: scheduledScript ? [scheduledScript] : []
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Mutation: Cancel a scheduled script
   */
  @Mutation(() => ScheduleScriptResponseType)
  @Authorized('USER')
  async cancelScheduledScript(
    @Arg('executionId', () => ID) executionId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScheduleScriptResponseType> {
    try {
      // Query execution to verify exists and check permissions
      const execution = await ctx.prisma.scriptExecution.findUnique({
        where: { id: executionId },
        include: {
          machine: {
            select: { userId: true }
          }
        }
      });

      if (!execution) {
        return {
          success: false,
          error: 'Scheduled script execution not found'
        };
      }

      if (execution.status !== ExecutionStatus.PENDING && execution.status !== ExecutionStatus.RUNNING) {
        return {
          success: false,
          error: `Cannot cancel execution with status ${execution.status}`
        };
      }

      // Verify user has permission
      const isTriggeredBy = execution.triggeredById === ctx.user!.id;
      const isOwner = execution.machine.userId === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'ADMIN';

      if (!isTriggeredBy && !isOwner && !isAdmin) {
        return {
          success: false,
          error: 'You do not have permission to cancel this scheduled script'
        };
      }

      // Create scheduler instance
      const scheduler = new ScriptScheduler(ctx.prisma);

      // Cancel the schedule
      await scheduler.cancelScheduledScript(executionId, ctx.user!.id);

      return {
        success: true,
        message: 'Schedule cancelled successfully',
        executionIds: [executionId]
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}
