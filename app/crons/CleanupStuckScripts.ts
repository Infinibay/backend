import { CronJob } from 'cron'
import { PrismaClient, ExecutionStatus } from '@prisma/client'
import { Debugger } from '@utils/debug'

const debug = new Debugger('CleanupStuckScripts')

/**
 * Cron job to cleanup stuck script executions
 * Runs every 5 minutes to find scripts in RUNNING status that have exceeded their timeout
 * or have been running for more than 2 hours (maximum safe threshold)
 */
export class CleanupStuckScripts {
  private job: CronJob
  private prisma: PrismaClient
  private isRunning = false

  // Maximum runtime before considering a script stuck (2 hours in milliseconds)
  private readonly MAX_RUNTIME_MS = 2 * 60 * 60 * 1000

  constructor (prisma: PrismaClient) {
    this.prisma = prisma

    // Run every 5 minutes
    this.job = new CronJob('*/5 * * * *', () => {
      this.cleanupStuckExecutions().catch(error => {
        debug.log('error', `Failed to cleanup stuck scripts: ${error.message}`)
        console.error('CleanupStuckScripts error:', error)
      })
    })
  }

  /**
   * Start the cron job
   */
  start (): void {
    if (!this.job.running) {
      debug.log('Starting CleanupStuckScripts cron job')
      this.job.start()
    }
  }

  /**
   * Stop the cron job
   */
  stop (): void {
    if (this.job.running) {
      debug.log('Stopping CleanupStuckScripts cron job')
      this.job.stop()
    }
  }

  /**
   * Check if the cron job is running
   */
  isJobRunning (): boolean {
    return this.job.running
  }

  /**
   * Find and cleanup stuck script executions
   */
  private async cleanupStuckExecutions (): Promise<void> {
    // Prevent overlapping executions
    if (this.isRunning) {
      debug.log('warn', 'CleanupStuckScripts already running, skipping this cycle')
      return
    }

    this.isRunning = true

    try {
      const now = new Date()

      // Find all scripts in RUNNING status
      const runningExecutions = await this.prisma.scriptExecution.findMany({
        where: {
          status: ExecutionStatus.RUNNING
        },
        include: {
          script: {
            select: {
              name: true
            }
          },
          machine: {
            select: {
              name: true
            }
          }
        }
      })

      if (runningExecutions.length === 0) {
        debug.log('No running script executions found')
        return
      }

      debug.log(`Found ${runningExecutions.length} running script executions, checking for stuck scripts`)

      const stuckExecutions = []

      for (const execution of runningExecutions) {
        const isStuck = this.isExecutionStuck(execution, now)

        if (isStuck) {
          stuckExecutions.push(execution)
        }
      }

      if (stuckExecutions.length === 0) {
        debug.log('No stuck script executions found')
        return
      }

      debug.log(`Found ${stuckExecutions.length} stuck script executions, marking as TIMEOUT`)

      // Update stuck executions
      const results = await Promise.allSettled(
        stuckExecutions.map(async (execution) => {
          try {
            const runtimeMs = now.getTime() - new Date(execution.startedAt!).getTime()
            const runtimeSeconds = Math.floor(runtimeMs / 1000)

            await this.prisma.scriptExecution.update({
              where: { id: execution.id },
              data: {
                status: ExecutionStatus.TIMEOUT,
                completedAt: now,
                error: `Script execution timed out or VM lost connection. Runtime: ${runtimeSeconds}s. Script may have exceeded configured timeout or the VM/InfiniService lost connectivity.`,
                // Don't overwrite stdout/stderr if they exist
                ...(execution.stdout === null && { stdout: '' }),
                ...(execution.stderr === null && { stderr: 'Script execution timeout or connection lost' })
              }
            })

            debug.log(`Marked script execution as TIMEOUT: ${execution.script.name} on ${execution.machine.name} (runtime: ${runtimeSeconds}s)`)

            return {
              executionId: execution.id,
              scriptName: execution.script.name,
              machineName: execution.machine.name,
              success: true
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            debug.log('error', `Failed to mark execution ${execution.id} as TIMEOUT: ${errorMessage}`)
            return {
              executionId: execution.id,
              scriptName: execution.script.name,
              machineName: execution.machine.name,
              success: false,
              error: errorMessage
            }
          }
        })
      )

      // Log summary
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length
      const failed = results.length - successful

      debug.log(`Cleanup complete: ${successful} scripts marked as TIMEOUT, ${failed} failed`)

      // Log details for failed updates
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.success) {
          debug.log('error', `Failed to cleanup execution ${result.value.executionId}: ${result.value.error}`)
        } else if (result.status === 'rejected') {
          debug.log('error', `Update rejected: ${result.reason}`)
        }
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      debug.log('error', `Critical error in cleanupStuckExecutions: ${errorMessage}`)
      console.error('CleanupStuckScripts critical error:', error)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Determine if a script execution is stuck
   * A script is considered stuck if:
   * 1. It has been running for more than 2 hours (MAX_RUNTIME_MS)
   * 2. OR it has a timeout configured and has exceeded it
   */
  private isExecutionStuck (execution: any, now: Date): boolean {
    if (!execution.startedAt) {
      // Script in RUNNING but never started? Definitely stuck
      return true
    }

    const runtimeMs = now.getTime() - new Date(execution.startedAt).getTime()

    // Check if exceeded maximum runtime threshold (2 hours)
    if (runtimeMs > this.MAX_RUNTIME_MS) {
      return true
    }

    // If script has a timeout configured, check if exceeded
    // Note: timeout is stored in ScriptExecution but we need to get it from the related script
    // For now, we'll rely on the 2 hour max runtime check
    // TODO: If timeout needs to be checked per-execution, add timeout field to ScriptExecution

    return false
  }

  /**
   * Manually trigger cleanup (for testing/debugging)
   */
  async triggerManualRun (): Promise<void> {
    debug.log('Manual trigger of stuck scripts cleanup')
    await this.cleanupStuckExecutions()
  }

  /**
   * Get statistics about stuck scripts
   */
  async getStats (): Promise<{
    totalRunningScripts: number
    potentiallyStuckScripts: number
  }> {
    const now = new Date()

    const runningExecutions = await this.prisma.scriptExecution.findMany({
      where: {
        status: ExecutionStatus.RUNNING
      },
      select: {
        id: true,
        startedAt: true
      }
    })

    const potentiallyStuck = runningExecutions.filter(execution => {
      return this.isExecutionStuck(execution, now)
    })

    return {
      totalRunningScripts: runningExecutions.length,
      potentiallyStuckScripts: potentiallyStuck.length
    }
  }
}

// Export the class for use in other parts of the application
export default CleanupStuckScripts
