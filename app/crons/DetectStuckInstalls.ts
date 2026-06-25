/**
 * DetectStuckInstalls Cron Job
 *
 * Host-side safety net for hung unattended installs. The "install finished"
 * signal (first infiniservice handshake -> setupComplete=true) only fires on
 * SUCCESS; its absence is exactly the hung state, so we cannot wait for it. A VM
 * whose install never completes keeps QEMU running forever with status stuck and
 * setupComplete=false and no error.
 *
 * This job fails any install that has been running longer than the per-OS budget
 * (getInstallationTimeout) since installStartedAt: force-stop the VM, mark it
 * 'error', and record a lastError the UI can show. Purely host-side, OS-agnostic,
 * survives backend restarts (the anchor is a DB column).
 */
import logger from '@main/logger'
import { CronJob } from 'cron'
import { getInstallationTimeout } from '@infinibay/infinization'
import type { OSType } from '@infinibay/infinization'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'
import { getInfinization } from '../services/InfinizationService'

const debug = logger.child({ module: 'cron:detect-stuck-installs' })

async function runDetectStuckInstalls (): Promise<void> {
  // Candidates: powered-on VMs still in the pre-setup install phase with a
  // recorded boot anchor and a live QEMU pid.
  const candidates = await prisma.machine.findMany({
    where: {
      status: { in: ['running', 'starting'] },
      configuration: {
        setupComplete: { not: true },
        installStartedAt: { not: null },
        qemuPid: { not: null }
      }
    },
    include: { configuration: true }
  })

  const now = Date.now()
  for (const vm of candidates) {
    const startedAt = vm.configuration?.installStartedAt
    if (!startedAt) continue

    const timeoutMs = getInstallationTimeout((vm.os ?? '') as OSType)
    const elapsedMs = now - startedAt.getTime()
    if (elapsedMs <= timeoutMs) continue

    const minutes = Math.round(timeoutMs / 60000)
    debug.warn(
      `VM ${vm.name} (${vm.id}) install exceeded its ${minutes}m budget ` +
      `(${Math.round(elapsedMs / 60000)}m elapsed) — marking as error`
    )

    // Best-effort force-stop the hung QEMU before flipping status.
    try {
      const infinization = await getInfinization()
      await infinization.stopVM(vm.id, { graceful: false, force: true })
    } catch (err) {
      debug.warn(`Failed to stop hung install VM ${vm.id}: ${(err as Error).message}`)
    }

    try {
      const updated = await prisma.machine.update({
        where: { id: vm.id },
        data: {
          status: 'error',
          configuration: {
            update: { lastError: `Installation timed out after ${minutes} minutes` }
          }
        },
        include: { user: true, template: true, department: true, configuration: true }
      })
      try {
        await getEventManager().dispatchEvent('vms', 'update', updated)
      } catch (eventErr) {
        debug.warn(`Failed to emit update event for stuck-install VM ${vm.id}: ${(eventErr as Error).message}`)
      }
    } catch (err) {
      debug.error(`Failed to mark stuck-install VM ${vm.id} as error: ${(err as Error).message}`)
    }
  }
}

// Every 2 minutes. Cheap: a single indexed query that returns nothing once all
// installs have completed.
const DetectStuckInstallsJob = new CronJob('*/2 * * * *', async () => {
  try {
    await runDetectStuckInstalls()
  } catch (error) {
    debug.error(`DetectStuckInstalls tick failed: ${(error as Error).message}`)
  }
})

export default DetectStuckInstallsJob
