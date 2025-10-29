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
      console.log(`📜 Handling script event: ${action}`, { scriptId: scriptData?.id, triggeredBy })

      // Get fresh script data from database if we only have an ID
      const script = await this.getScriptData(scriptData)
      if (!script) {
        console.warn(`⚠️ Script not found for event: ${scriptData?.id}`)
        return
      }

      // Determine which users should receive this event
      const targetUsers = await this.getTargetUsers(script, action)

      // Create event payload
      const payload: EventPayload = {
        status: 'success',
        data: script
      }

      // Send event to each target user
      for (const userId of targetUsers) {
        this.socketService.sendToUser(userId, 'scripts', action, payload)
      }

      console.log(`✅ Script event sent to ${targetUsers.length} users: ${action}`)
    } catch (error) {
      console.error(`❌ Error handling script event ${action}:`, error)
      throw error
    }
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
}
