import { PrismaClient } from '@prisma/client'
import { SocketService } from './SocketService'
import { ResourceEventManager, EventAction, EventPayload } from './EventManager'

// Scripts Event Manager - handles script-specific real-time events
export class ScriptsEventManager implements ResourceEventManager {
  private socketService: SocketService
  private prisma: PrismaClient

  constructor (socketService: SocketService, prisma: PrismaClient) {
    this.socketService = socketService
    this.prisma = prisma
  }

  // Main event handler for script events
  async handleEvent (action: EventAction, scriptData: any, triggeredBy?: string): Promise<void> {
    try {
      console.log(`📜 Handling script event: ${action}`, { scriptId: scriptData?.id, eventType: scriptData?.action, triggeredBy })

      // Determine event type from scriptData.action or fallback to action parameter
      const eventType = scriptData?.action || action

      // Route to specific handlers based on event type
      if (eventType === 'schedule_created') {
        await this.handleScheduleCreated(scriptData, triggeredBy)
      } else if (eventType === 'schedule_updated') {
        await this.handleScheduleUpdated(scriptData, triggeredBy)
      } else if (eventType === 'schedule_cancelled') {
        await this.handleScheduleCancelled(scriptData, triggeredBy)
      } else if (eventType === 'execution_started') {
        await this.handleExecutionStarted(scriptData, triggeredBy)
      } else if (eventType === 'execution_completed') {
        await this.handleExecutionCompleted(scriptData, triggeredBy)
      } else {
        // For regular script CRUD events
        await this.handleGenericScriptEvent(action, scriptData, triggeredBy)
      }

      console.log(`✅ Script event handled: ${eventType}`)
    } catch (error) {
      console.error(`❌ Error handling script event ${action}:`, error)
      // Don't throw - log and continue to prevent operation failure
    }
  }

  // Handle schedule creation events
  private async handleScheduleCreated (scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) return

    const payload: EventPayload = {
      status: 'success',
      data: {
        eventType: 'schedule_created',
        scriptId: scriptData.id || script.id,
        scriptName: script.name,
        executionIds: scriptData.executionIds || [],
        scheduleType: scriptData.scheduleType,
        machineIds: scriptData.machineIds || [],
        triggeredBy,
        timestamp: new Date().toISOString()
      }
    }

    const targetUsers = await this.getTargetUsers(script, 'create')
    this.sendEventToUsers(targetUsers, 'scripts', 'schedule_created', payload)
  }

  // Handle schedule update events
  private async handleScheduleUpdated (scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) return

    const payload: EventPayload = {
      status: 'success',
      data: {
        eventType: 'schedule_updated',
        scriptId: scriptData.id || script.id,
        executionId: scriptData.executionId,
        triggeredBy,
        timestamp: new Date().toISOString()
      }
    }

    const targetUsers = await this.getTargetUsers(script, 'update')
    this.sendEventToUsers(targetUsers, 'scripts', 'schedule_updated', payload)
  }

  // Handle schedule cancellation events
  private async handleScheduleCancelled (scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) return

    const payload: EventPayload = {
      status: 'success',
      data: {
        eventType: 'schedule_cancelled',
        scriptId: scriptData.id || script.id,
        executionId: scriptData.executionId,
        triggeredBy,
        timestamp: new Date().toISOString()
      }
    }

    const targetUsers = await this.getTargetUsers(script, 'delete')
    this.sendEventToUsers(targetUsers, 'scripts', 'schedule_cancelled', payload)
  }

  // Handle execution started events
  private async handleExecutionStarted (scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) return

    const payload: EventPayload = {
      status: 'success',
      data: {
        eventType: 'execution_started',
        scriptId: scriptData.id || script.id,
        executionId: scriptData.executionId,
        machineId: scriptData.machineId,
        triggeredBy,
        timestamp: new Date().toISOString()
      }
    }

    const targetUsers = await this.getTargetUsersForExecution(script, scriptData.machineId)
    this.sendEventToUsers(targetUsers, 'scripts', 'execution_started', payload)
  }

  // Handle execution completed events
  private async handleExecutionCompleted (scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) return

    const payload: EventPayload = {
      status: 'success',
      data: {
        eventType: 'execution_completed',
        scriptId: scriptData.id || script.id,
        executionId: scriptData.executionId,
        machineId: scriptData.machineId,
        status: scriptData.status,
        exitCode: scriptData.exitCode,
        triggeredBy,
        timestamp: new Date().toISOString()
      }
    }

    const targetUsers = await this.getTargetUsersForExecution(script, scriptData.machineId)
    this.sendEventToUsers(targetUsers, 'scripts', 'execution_completed', payload)
  }

  // Handle generic script CRUD events
  private async handleGenericScriptEvent (action: EventAction, scriptData: any, triggeredBy?: string): Promise<void> {
    const script = await this.getScriptData(scriptData)
    if (!script) {
      console.warn(`⚠️ Script not found for event: ${scriptData?.id}`)
      return
    }

    const payload: EventPayload = {
      status: 'success',
      data: script
    }

    const targetUsers = await this.getTargetUsers(script, action)
    this.sendEventToUsers(targetUsers, 'scripts', action, payload)
  }

  // Send event to multiple users
  private sendEventToUsers (userIds: string[], resource: string, action: string, payload: EventPayload): void {
    for (const userId of userIds) {
      try {
        this.socketService.sendToUser(userId, resource, action, payload)
      } catch (error) {
        console.error(`❌ Failed to send event to user ${userId}:`, error)
        // Continue sending to other users even if one fails
      }
    }
    console.log(`✅ Event sent to ${userIds.length} users: ${resource}:${action}`)
  }

  // Get complete script data from database
  private async getScriptData (scriptData: any): Promise<any> {
    try {
      // If we already have complete data, use it
      if (scriptData && typeof scriptData === 'object' && scriptData.name) {
        return scriptData
      }

      // If we only have an ID, fetch from database
      const scriptId = typeof scriptData === 'string' ? scriptData : scriptData?.id
      if (!scriptId) {
        return null
      }

      const script = await this.prisma.script.findUnique({
        where: { id: scriptId },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          departmentAssignments: {
            include: {
              department: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      })

      return script
    } catch (error) {
      console.error('❌ Error fetching script data:', error)
      return null
    }
  }

  // Determine which users should receive this event
  private async getTargetUsers (script: any, action: EventAction): Promise<string[]> {
    const targetUsers = new Set<string>()

    try {
      // Add script creator
      if (script.createdById) {
        targetUsers.add(script.createdById)
      }

      // Add all admins
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deleted: false },
        select: { id: true }
      })
      admins.forEach(admin => targetUsers.add(admin.id))

      // For department-assigned scripts, add all users in those departments
      if (script.departmentAssignments && script.departmentAssignments.length > 0) {
        const departmentIds = script.departmentAssignments.map((assignment: any) => assignment.departmentId)

        // Get all machines in these departments
        const machines = await this.prisma.machine.findMany({
          where: {
            departmentId: { in: departmentIds }
          },
          select: { userId: true }
        })

        machines.forEach(machine => {
          if (machine.userId) {
            targetUsers.add(machine.userId)
          }
        })
      }
    } catch (error) {
      console.error('❌ Error determining target users for script event:', error)
    }

    return Array.from(targetUsers)
  }

  // Determine target users for execution events (includes machine owner)
  private async getTargetUsersForExecution (script: any, machineId?: string): Promise<string[]> {
    const targetUsers = new Set<string>()

    try {
      // Add script creator
      if (script.createdById) {
        targetUsers.add(script.createdById)
      }

      // Add all admins
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deleted: false },
        select: { id: true }
      })
      admins.forEach(admin => targetUsers.add(admin.id))

      // Add machine owner if provided
      if (machineId) {
        const machine = await this.prisma.machine.findUnique({
          where: { id: machineId },
          select: { userId: true }
        })

        if (machine?.userId) {
          targetUsers.add(machine.userId)
        }
      }

      // For department-assigned scripts, add department users
      if (script.departmentAssignments && script.departmentAssignments.length > 0) {
        const departmentIds = script.departmentAssignments.map((assignment: any) => assignment.departmentId)

        const machines = await this.prisma.machine.findMany({
          where: {
            departmentId: { in: departmentIds }
          },
          select: { userId: true }
        })

        machines.forEach(machine => {
          if (machine.userId) {
            targetUsers.add(machine.userId)
          }
        })
      }
    } catch (error) {
      console.error('❌ Error determining target users for execution event:', error)
    }

    return Array.from(targetUsers)
  }
}
