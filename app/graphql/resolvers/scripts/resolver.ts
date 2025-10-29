import { Resolver, Query, Mutation, Arg, Ctx, ID, Int, Authorized } from 'type-graphql';
import { UserInputError } from 'apollo-server-errors';
import { ScriptManager } from '../../../services/scripts/ScriptManager';
import { ScriptExecutor } from '../../../services/scripts/ScriptExecutor';
import { getEventManager } from '../../../services/EventManager';
import {
  ScriptType,
  ScriptResponseType,
  ScriptExecutionType,
  ScriptExecutionResponseType,
  CreateScriptInput,
  UpdateScriptInput,
  ExecuteScriptInput,
  ScriptFiltersInput
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
      const script = await scriptManager.updateScript(id, updateData, ctx.user!.id, ipAddress, userAgent);

      // Dispatch event for real-time updates
      getEventManager().dispatchEvent('scripts', 'update', { id: script.id }, ctx.user!.id);

      return {
        success: true,
        message: 'Script updated successfully',
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
   * Mutation: Delete a script
   */
  @Mutation(() => ScriptResponseType)
  @Authorized('ADMIN')
  async deleteScript(
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<ScriptResponseType> {
    try {
      const { ipAddress, userAgent } = extractRequestMetadata(ctx)
      const scriptManager = new ScriptManager(ctx.prisma);
      await scriptManager.deleteScript(id, ipAddress, userAgent);

      // Dispatch event for real-time updates
      getEventManager().dispatchEvent('scripts', 'delete', { id }, ctx.user!.id);

      return {
        success: true,
        message: 'Script deleted successfully'
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
}
