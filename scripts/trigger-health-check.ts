#!/usr/bin/env ts-node

/**
 * Script to manually trigger health checks for a specific VM
 * Usage: npx ts-node scripts/trigger-health-check.ts <vmId>
 */

import { PrismaClient, TaskStatus, TaskPriority, HealthCheckType } from '@prisma/client'

async function main () {
  const vmId = process.argv[2]

  if (!vmId) {
    console.error('Usage: npx ts-node scripts/trigger-health-check.ts <vmId>')
    console.error('Example: npx ts-node scripts/trigger-health-check.ts a0814a28-4d94-4a0c-b75b-43ada1d7887c')
    process.exit(1)
  }

  const prisma = new PrismaClient()

  const startTime = Date.now()
  try {
    // Check if VM exists
    const vm = await prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true, name: true, status: true }
    })

    if (!vm) {
      console.error(`❌ VM with ID ${vmId} not found`)
      process.exit(1)
    }

    console.log(`🔍 Found VM: ${vm.name} (${vm.id}) - Status: ${vm.status}`)

    console.log('📋 Queueing health checks directly to database...')

    // Define standard health checks
    const healthChecks = [
      HealthCheckType.OVERALL_STATUS,
      HealthCheckType.DISK_SPACE,
      HealthCheckType.RESOURCE_OPTIMIZATION,
      HealthCheckType.WINDOWS_UPDATES,
      HealthCheckType.WINDOWS_DEFENDER,
      HealthCheckType.APPLICATION_INVENTORY
    ]

    // Queue each health check
    for (const checkType of healthChecks) {
      await prisma.vMHealthCheckQueue.create({
        data: {
          machineId: vmId,
          checkType,
          priority: TaskPriority.MEDIUM,
          status: TaskStatus.PENDING,
          attempts: 0,
          scheduledFor: new Date(),
          payload: {}
        }
      })
      console.log(`  ✅ Queued: ${checkType}`)
    }

    console.log('✅ All health checks queued successfully!')

    // Show queued items
    const queueItems = await prisma.vMHealthCheckQueue.findMany({
      where: { machineId: vmId },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    console.log(`\n📊 Queued Health Checks (${queueItems.length} items):`)
    queueItems.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.checkType} - ${item.status} (Priority: ${item.priority})`)
    })

    // Get overall queue statistics
    const [pending, running, completed, failed] = await Promise.all([
      prisma.vMHealthCheckQueue.count({ where: { status: TaskStatus.PENDING } }),
      prisma.vMHealthCheckQueue.count({ where: { status: TaskStatus.RUNNING } }),
      prisma.vMHealthCheckQueue.count({ where: { status: TaskStatus.COMPLETED } }),
      prisma.vMHealthCheckQueue.count({ where: { status: TaskStatus.FAILED } })
    ])

    console.log('\n📈 Overall Queue Statistics:')
    console.log(`  - Pending: ${pending}`)
    console.log(`  - Running: ${running}`)
    console.log(`  - Completed: ${completed}`)
    console.log(`  - Failed: ${failed}`)

    console.log('\n🎯 Health checks have been queued and will be processed when the VM comes online.')
    console.log('💡 You can monitor progress in Prisma Studio or through the GraphQL API.')

    const executionTime = Date.now() - startTime
    console.log(`✅ Queueing completed in ${executionTime}ms`)
    console.log('🔧 Configured timeouts:', {
      WINDOWS_DEFENDER: process.env.HEALTH_CHECK_TIMEOUT_WINDOWS_DEFENDER || '300000ms',
      RESOURCE_OPTIMIZATION: process.env.HEALTH_CHECK_TIMEOUT_RESOURCE_OPTIMIZATION || '240000ms',
      WINDOWS_UPDATES: process.env.HEALTH_CHECK_TIMEOUT_WINDOWS_UPDATES || '300000ms',
      OVERALL_STATUS: process.env.HEALTH_CHECK_TIMEOUT_OVERALL_STATUS || '300000ms',
      DISK_SPACE: process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE || '60000ms',
      APPLICATION_INVENTORY: process.env.HEALTH_CHECK_TIMEOUT_APPLICATION_INVENTORY || '180000ms'
    })
  } catch (error) {
    const executionTime = Date.now() - startTime
    const msg = (error as Error).message || String(error)
    console.error('❌ Error triggering health checks:', error)
    if (/timeout/i.test(msg)) {
      console.error('💡 This appears to be a timeout error. Consider increasing health check timeout values in your environment configuration.')
    }
    console.error(`⏱️ Queueing failed after ${executionTime}ms`)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(console.error)
