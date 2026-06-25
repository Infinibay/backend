/**
 * InstallResetTracker — fast-path detection of a hung unattended install via a
 * QMP RESET storm.
 *
 * Complements the DetectStuckInstalls timeout cron: instead of waiting out the
 * whole per-OS budget, this catches a boot/install LOOP early. A normal install
 * reboots once or twice; a guest that keeps crash-rebooting during install
 * (bad autoinstall, no boot device, kernel panic) produces many RESETs quickly.
 * QMP is connected from QEMU start, so RESETs are observable long before the OS
 * or infiniservice exist.
 *
 * In-memory per-VM counter (single backend process). Only acts while the VM is
 * still installing (setupComplete != true).
 */
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { getEventManager } from '../EventManager'
import { getInfinization } from '../InfinizationService'

const debug = logger.child({ module: 'install-reset-tracker' })

// Mirrors infinization's InstallationMonitor DEFAULT_MAX_RESETS.
const MAX_INSTALL_RESETS = 5
const RESET_WINDOW_MS = 10 * 60 * 1000

interface ResetState { count: number, firstAt: number }
const resets = new Map<string, ResetState>()

/** Forget any reset tracking for a VM (e.g. once it finishes installing or stops). */
export function clearInstallResetTracking (vmId: string): void {
  resets.delete(vmId)
}

/**
 * Called on every QMP RESET. Only acts while the VM is still installing
 * (setupComplete != true). If RESETs exceed MAX_INSTALL_RESETS within the
 * window, the install is looping/failing — force-stop and mark 'error'.
 */
export async function handleInstallReset (prisma: PrismaClient, vmId: string): Promise<void> {
  const machine = await prisma.machine.findUnique({
    where: { id: vmId },
    include: { configuration: true }
  })

  // Not installing anymore (already set up) or gone: drop tracking and ignore —
  // a post-install guest reboot is normal and must never trip this.
  if (!machine || machine.configuration?.setupComplete === true) {
    resets.delete(vmId)
    return
  }

  const now = Date.now()
  const prev = resets.get(vmId)
  const state: ResetState = (prev && now - prev.firstAt <= RESET_WINDOW_MS)
    ? { count: prev.count + 1, firstAt: prev.firstAt }
    : { count: 1, firstAt: now }
  resets.set(vmId, state)

  if (state.count < MAX_INSTALL_RESETS) {
    debug.debug(`VM ${vmId} install reset ${state.count}/${MAX_INSTALL_RESETS}`)
    return
  }

  debug.warn(`VM ${vmId} hit ${state.count} resets during install — boot/reset loop, marking error`)
  resets.delete(vmId)

  try {
    const infinization = await getInfinization()
    await infinization.stopVM(vmId, { graceful: false, force: true })
  } catch (err) {
    debug.warn(`Failed to stop reset-looping VM ${vmId}: ${(err as Error).message}`)
  }

  try {
    const updated = await prisma.machine.update({
      where: { id: vmId },
      data: {
        status: 'error',
        configuration: { update: { lastError: `Installation failed: ${state.count} resets (boot/install loop)` } }
      },
      include: { user: true, template: true, department: true, configuration: true }
    })
    await getEventManager().dispatchEvent('vms', 'update', updated)
  } catch (err) {
    debug.error(`Failed to mark reset-looping VM ${vmId} as error: ${(err as Error).message}`)
  }
}
