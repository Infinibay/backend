import UpdateVmStatusJob from './UpdateVmStatus'
import UpdateGraphicsInformationJob from './UpdateGraphicsInformation'
import { createProcessHealthQueueJob } from './ProcessHealthQueue'
import { createScheduleOverallScansJob } from './ScheduleOverallScans'
import { createMetricsWatchdogJob } from './MetricsWatchdog'
import { createCleanupOrphanedHealthTasksJob } from './CleanupOrphanedHealthTasks'
import ProcessMaintenanceQueue from './ProcessMaintenanceQueue'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'

export async function startCrons () {
  UpdateVmStatusJob.start()
  UpdateGraphicsInformationJob.start()

  // Start health monitoring cron jobs
  const eventManager = getEventManager()
  const processHealthQueueJob = createProcessHealthQueueJob(prisma, eventManager)
  const scheduleOverallScansJob = createScheduleOverallScansJob(prisma, eventManager)
  const metricsWatchdogJob = createMetricsWatchdogJob(prisma)
  const cleanupOrphanedHealthTasksJob = createCleanupOrphanedHealthTasksJob(prisma)

  processHealthQueueJob.start()
  scheduleOverallScansJob.start()
  metricsWatchdogJob.start()
  cleanupOrphanedHealthTasksJob.start()

  // Start maintenance queue processing
  const maintenanceQueue = new ProcessMaintenanceQueue(prisma)
  maintenanceQueue.start()
}
