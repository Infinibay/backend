/**
 * UpdateGraphicsInformation Cron Job
 *
 * Detects (and logs) corrupted VM graphics configuration so operators can spot
 * VMs that need repair.
 *
 * IMPORTANT — history / why this job no longer writes anything:
 * This job USED to overwrite a `0.0.0.0`/null `graphicHost` on running VMs with
 * the host's *current* primary IP (systeminformation → getLocalIP). `graphicHost`
 * is the address QEMU BINDS the SPICE/VNC server to, so freezing an ephemeral IP
 * into it made the VM permanently unstartable the moment that IP changed
 * (container restart, DHCP renewal, host reboot, or the VM migrating to another
 * node): QEMU dies at startup with `failed to initialize spice server`. It was
 * also wrong for multi-node — it wrote the MASTER's IP for a VM whose display
 * binds on a remote node.
 *
 * The bind address is now kept stable (0.0.0.0 / loopback) and self-healed at
 * start time by infinization (resolveBindAddress); the client-facing connect host
 * is resolved at read time. There is therefore nothing for this job to persist.
 */
import logger from '@main/logger'
import { CronJob } from 'cron'
import prisma from '../utils/database'

const debug = logger.child({ module: 'cron:update-graphics' })

const UpdateGraphicsInformationJob = new CronJob('*/1 * * * *', async () => {
  try {
    // Only configuration is needed for the corruption check.
    const machines = await prisma.machine.findMany({
      include: {
        configuration: true
      }
    })

    for (const machine of machines) {
      try {
        if (!machine.configuration) {
          continue
        }

        const config = machine.configuration

        // Detect and log corrupted configurations (port -1 with protocol configured).
        // This indicates a valid port was previously overwritten. Read-only: we do
        // NOT mutate graphics config here (see the file header for why).
        if (config.graphicPort === -1 && config.graphicProtocol) {
          debug.warn(`Corrupted graphics config detected for ${machine.name}: port=-1 but protocol=${config.graphicProtocol}. This VM may need repair.`)
        }
      } catch (err) {
        debug.error(`Error processing machine ${machine.name}: ${err}`)
      }
    }
  } catch (err) {
    debug.error(`Error in UpdateGraphicsInformationJob: ${err}`)
  }
})

export default UpdateGraphicsInformationJob
