import {
  PrismaClient,
  ExecutionType,
  ExecutionStatus,
  ShellType,
  ScriptExecution,
} from '@prisma/client';
import {
  getVirtioSocketWatcherService,
  CommandResponse,
} from '../VirtioSocketWatcherService';
import { getSocketService } from '../SocketService';
import { ScriptManager, ScriptWithContent } from './ScriptManager';
import { TemplateEngine } from './TemplateEngine';
import { ScriptParser } from './ScriptParser';

const debug = require('debug')('infinibay:service:script-executor');

export interface ExecuteScriptOptions {
  scriptId: string;
  machineId: string;
  inputValues: Record<string, any>;
  executionType?: ExecutionType;
  triggeredById?: string; // nullable for automated executions
  runAs?: string; // 'system', 'administrator', or username
  ipAddress?: string;
  userAgent?: string;
}

export interface ScriptExecutionResult {
  success: boolean;
  executionId: string;
  error?: string;
}

export class ScriptExecutor {
  private prisma: PrismaClient;
  private scriptManager: ScriptManager;
  private templateEngine: TemplateEngine;
  private scriptParser: ScriptParser;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.scriptManager = new ScriptManager(prisma);
    this.templateEngine = new TemplateEngine();
    this.scriptParser = new ScriptParser();
  }

  /**
   * Main method to execute a script on a VM
   */
  async executeScript(
    options: ExecuteScriptOptions
  ): Promise<ScriptExecutionResult> {
    const {
      scriptId,
      machineId,
      inputValues,
      executionType = ExecutionType.ON_DEMAND,
      triggeredById,
      runAs,
    } = options;

    let executionId: string | null = null;

    try {
      // 1. Load and validate script
      debug('Loading script %s', scriptId);
      const script: ScriptWithContent =
        await this.scriptManager.getScript(scriptId);

      if (!script) {
        throw new Error(`Script with ID ${scriptId} not found`);
      }

      // 2. Validate machine and permissions
      debug('Validating machine and OS compatibility');
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        include: { user: true },
      });

      if (!machine) {
        throw new Error(`Machine with ID ${machineId} not found`);
      }

      // Check OS compatibility
      if (
        script.os &&
        script.os.length > 0 &&
        !script.os.includes(machine.os as any)
      ) {
        throw new Error(
          `Script is not compatible with OS ${machine.os}. Compatible OS: ${script.os.join(', ')}`
        );
      }

      // 3. Validate input values
      debug('Validating input values');
      this.templateEngine.validateRequiredInputs(
        script.parsedInputs,
        inputValues
      );

      // Validate each input value
      for (const input of script.parsedInputs) {
        if (inputValues[input.name] !== undefined) {
          this.scriptParser.validateInputValue(input, inputValues[input.name]);
        }
      }

      // Sanitize password inputs for logging (but keep original values for DB)
      const sanitizedInputs =
        this.templateEngine.sanitizeForLogging(inputValues, script.parsedInputs);
      debug('Input values validated (sanitized): %O', sanitizedInputs);

      // 4. Create ScriptExecution record (PENDING)
      debug('Creating ScriptExecution record');
      const execution = await this.prisma.scriptExecution.create({
        data: {
          scriptId,
          machineId,
          executionType,
          triggeredById: triggeredById || null,
          inputValues: options.inputValues, // Store original values, not sanitized
          status: ExecutionStatus.PENDING,
          executedAs: runAs,
          createdAt: new Date(),
          scheduledFor: new Date(),
          repeatIntervalMinutes: null,
          lastExecutedAt: null,
          executionCount: 0,
          maxExecutions: null
        },
      });

      executionId = execution.id;
      debug('Created ScriptExecution with ID %s', executionId);

      // Create audit log for execution
      await this.createExecutionAuditLog(
        options.scriptId,
        options.triggeredById || null,
        execution.id,
        options.machineId,
        options.inputValues,
        options.ipAddress,
        options.userAgent,
        runAs,
        executionType
      )

      // 5. Interpolate script content
      debug('Interpolating script content');
      const interpolatedScript = this.templateEngine.interpolate(
        script.content,
        inputValues
      );

      // 6. Update status to RUNNING and emit started event
      debug('Updating status to RUNNING');
      await this.prisma.scriptExecution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      await this.emitExecutionEvent(
        executionId,
        machineId,
        'script_execution_started',
        {
          executionId,
          scriptId,
          machineId,
          scriptName: script.name,
        },
        triggeredById
      );

      // 7. Execute script via VirtioSocketWatcherService
      debug('Executing script on VM');
      const timeout = 600 * 1000; // Default 600 seconds (10 minutes)
      const shellType = script.shell || ShellType.BASH;
      const virtioService = getVirtioSocketWatcherService();

      // Start progress heartbeat emission (every 5 seconds)
      const progressInterval = setInterval(async () => {
        try {
          await this.emitExecutionEvent(
            executionId!,
            machineId,
            'script_execution_progress',
            {
              executionId,
              scriptId,
              machineId,
              status: ExecutionStatus.RUNNING,
              timestamp: new Date().toISOString(),
            },
            triggeredById
          );
        } catch (error: any) {
          debug('Error emitting progress event: %s', error.message);
        }
      }, 5000);

      let commandResponse: CommandResponse;
      try {
        // Determine execution method based on OS and shell
        const isWindows = machine.os.toLowerCase().includes('windows');
        const isPowerShell = shellType === ShellType.POWERSHELL;

        if (isWindows && isPowerShell) {
          // Use safe command for Windows PowerShell with elevation support
          debug('Using ExecutePowerShellScript safe command with runAs: %s', runAs);
          const shouldElevate = runAs?.toLowerCase() === 'administrator' || runAs?.toLowerCase() === 'system';

          const commandType = {
            action: 'ExecutePowerShellScript' as const,
            params: {
              script: interpolatedScript,
              script_type: 'inline',
              timeout_seconds: Math.ceil(timeout / 1000),
              run_as_admin: shouldElevate
            }
          };

          commandResponse = await virtioService.sendSafeCommand(
            machineId,
            commandType,
            timeout
          );
        } else {
          // TODO: Add Linux safe shell execution with run_as_user support
          // For now, use unsafe command for Linux/other shells
          // This requires a future 'ExecuteShellScript' safe command with user impersonation
          debug('Using unsafe command for shell: %s', shellType);
          commandResponse = await virtioService.sendUnsafeCommand(
            machineId,
            interpolatedScript,
            {
              shell: shellType as string,
            },
            timeout
          );
        }
      } catch (error: any) {
        clearInterval(progressInterval);
        // Handle timeout or connection errors
        if (error.message?.includes('timeout')) {
          await this.prisma.scriptExecution.update({
            where: { id: executionId },
            data: {
              status: ExecutionStatus.TIMEOUT,
              completedAt: new Date(),
              error: 'Script execution timed out',
            },
          });

          await this.emitExecutionEvent(
            executionId,
            machineId,
            'script_execution_completed',
            {
              executionId,
              scriptId,
              machineId,
              status: ExecutionStatus.TIMEOUT,
              error: 'Script execution timed out',
            },
            triggeredById
          );

          return {
            success: false,
            executionId,
            error: 'Script execution timed out',
          };
        }

        throw error;
      } finally {
        clearInterval(progressInterval);
      }

      // 8. Handle command response
      debug('Command response received: %O', {
        success: commandResponse.success,
        exitCode: commandResponse.exit_code,
      });

      let finalStatus: ExecutionStatus;
      let errorMessage: string | null = null;

      if (commandResponse.success) {
        finalStatus = ExecutionStatus.SUCCESS;
      } else {
        finalStatus = ExecutionStatus.FAILED;
        errorMessage = commandResponse.error || 'Script execution failed';
      }

      await this.prisma.scriptExecution.update({
        where: { id: executionId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          exitCode: commandResponse.exit_code,
          stdout: commandResponse.stdout,
          stderr: commandResponse.stderr,
          error: errorMessage,
        },
      });

      // 9. Emit completed event
      await this.emitExecutionEvent(
        executionId,
        machineId,
        'script_execution_completed',
        {
          executionId,
          scriptId,
          machineId,
          status: finalStatus,
          exitCode: commandResponse.exit_code,
        },
        triggeredById
      );

      // 11. Return result
      return {
        success: commandResponse.success,
        executionId,
        error: errorMessage || undefined,
      };
    } catch (error: any) {
      debug('Error executing script: %s', error.message);

      // Update execution record if it was created
      if (executionId) {
        await this.prisma.scriptExecution.update({
          where: { id: executionId },
          data: {
            status: ExecutionStatus.FAILED,
            completedAt: new Date(),
            error: error.message,
          },
        });

        await this.emitExecutionEvent(
          executionId,
          machineId,
          'script_execution_completed',
          {
            executionId,
            scriptId,
            machineId,
            status: ExecutionStatus.FAILED,
            error: error.message,
          },
          triggeredById
        );
      }

      return {
        success: false,
        executionId: executionId || '',
        error: error.message,
      };
    }
  }

  /**
   * Cancel a running or pending script execution
   * Note: This only updates the database state. The actual command on the VM will complete.
   */
  async cancelScriptExecution(executionId: string): Promise<boolean> {
    try {
      debug('Cancelling script execution %s', executionId);

      const execution = await this.prisma.scriptExecution.findUnique({
        where: { id: executionId },
        include: { machine: true },
      });

      if (!execution) {
        throw new Error(`Execution with ID ${executionId} not found`);
      }

      if (
        execution.status !== ExecutionStatus.PENDING &&
        execution.status !== ExecutionStatus.RUNNING
      ) {
        throw new Error(
          `Cannot cancel execution with status ${execution.status}`
        );
      }

      await this.prisma.scriptExecution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.CANCELLED,
          completedAt: new Date(),
          error: 'Execution cancelled by user',
        },
      });

      await this.emitExecutionEvent(
        executionId,
        execution.machineId,
        'script_execution_cancelled',
        {
          executionId,
          scriptId: execution.scriptId,
          machineId: execution.machineId,
        },
        execution.triggeredById || undefined
      );

      debug('Script execution cancelled successfully');
      return true;
    } catch (error: any) {
      debug('Error cancelling script execution: %s', error.message);
      throw error;
    }
  }

  /**
   * Get the status of a script execution
   */
  async getExecutionStatus(executionId: string): Promise<ScriptExecution> {
    const execution = await this.prisma.scriptExecution.findUnique({
      where: { id: executionId },
      include: {
        script: true,
        machine: true,
        triggeredBy: true,
      },
    });

    if (!execution) {
      throw new Error(`Execution with ID ${executionId} not found`);
    }

    return execution;
  }

  /**
   * Create execution audit log
   */
  private async createExecutionAuditLog(
    scriptId: string,
    userId: string | null,
    executionId: string,
    machineId: string,
    inputValues: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    runAs?: string,
    executionType?: ExecutionType
  ): Promise<void> {
    try {
      // Sanitize input values (remove passwords)
      const sanitizedInputs = { ...inputValues }
      Object.keys(sanitizedInputs).forEach(key => {
        if (key.toLowerCase().includes('password')) {
          sanitizedInputs[key] = '***REDACTED***'
        }
      })

      const details: Record<string, any> = {
        executionId,
        machineId,
        inputValues: sanitizedInputs,
        executionType: executionType || 'ON_DEMAND'
      }

      // Include runAs information if provided
      if (runAs) {
        details.runAs = runAs
        details.elevated = runAs?.toLowerCase() === 'administrator' || runAs?.toLowerCase() === 'system'
      }

      await this.prisma.scriptAuditLog.create({
        data: {
          scriptId,
          userId,
          action: 'EXECUTED',
          details,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null
        }
      })
    } catch (error) {
      console.error('Failed to create execution audit log:', error)
    }
  }

  /**
   * Get target users for event emission
   */
  private async getTargetUsers(
    machineId: string,
    triggeredById?: string
  ): Promise<string[]> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { userId: true },
    });

    if (!machine) {
      return [];
    }

    // Get all admin users
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    const adminIds = admins.map((admin) => admin.id);

    // Build set of unique user IDs
    const targetUsers = new Set<string>();

    if (triggeredById) {
      targetUsers.add(triggeredById);
    }

    if (machine.userId) {
      targetUsers.add(machine.userId);
    }

    adminIds.forEach((id) => targetUsers.add(id));

    return Array.from(targetUsers);
  }

  /**
   * Emit script execution event to relevant users
   */
  private async emitExecutionEvent(
    executionId: string,
    machineId: string,
    action: string,
    data: any,
    triggeredById?: string
  ): Promise<void> {
    try {
      const targetUsers = await this.getTargetUsers(machineId, triggeredById);
      const socketService = getSocketService();

      debug('Emitting event %s to users: %O', action, targetUsers);

      for (const userId of targetUsers) {
        socketService.sendToUser(userId, 'scripts', action, {
          status: 'success',
          data,
        });
      }
    } catch (error: any) {
      debug('Error emitting execution event: %s', error.message);
      // Don't throw - event emission failures shouldn't block execution
    }
  }
}
