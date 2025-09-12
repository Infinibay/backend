import UpdateVmStatusJob from './UpdateVmStatus'
import CheckRunningServicesJob from './CheckRunningServices'
import UpdateGraphicsInformationJob from './UpdateGraphicsInformation'
import FlushFirewallJob from './flushFirewall'
import { createProcessHealthQueueJob } from './ProcessHealthQueue'
import { createScheduleOverallScansJob } from './ScheduleOverallScans'
import { createMetricsWatchdogJob } from './MetricsWatchdog'
import { createCleanupOrphanedHealthTasksJob } from './CleanupOrphanedHealthTasks'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'

export async function startCrons() {
  UpdateVmStatusJob.start()
  CheckRunningServicesJob.start()
  UpdateGraphicsInformationJob.start()
  FlushFirewallJob.start()

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
}
