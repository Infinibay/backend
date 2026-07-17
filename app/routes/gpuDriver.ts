import logger from '@main/logger'
import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import { constants } from 'fs'

const router = express.Router()

// Base directory for staged infinigpu guest-driver artifacts (mirrors the
// infiniservice served-binary layout under INFINIBAY_BASE_DIR).
const getGpuDriverDir = (): string => {
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  return path.join(baseDir, 'gpu-driver')
}

/**
 * Serve the infinigpu guest DRM driver source tarball. The OS auto-install fetches
 * this, extracts it, and runs the bundled install.sh, which registers the module
 * with DKMS so it builds against the installed kernel on first boot.
 *
 * GET /gpu-driver/:platform/source   (platform ∈ {linux, windows})
 *
 * Only 'linux' is staged today; 'windows' 404s until that driver is buildable.
 */
router.get('/:platform/source', async (req, res) => {
  try {
    const { platform } = req.params

    if (!['linux', 'windows'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Must be "linux" or "windows"' })
    }

    const file = path.join(getGpuDriverDir(), platform, 'source.tar.gz')

    try {
      await fs.access(file, constants.R_OK)
    } catch {
      return res.status(404).json({ error: `GPU driver not staged for platform: ${platform} (run the infinigpu build)` })
    }

    const stats = await fs.stat(file)
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Length', stats.size.toString())
    res.setHeader('Content-Disposition', `attachment; filename="infinigpu-driver-${platform}.tar.gz"`)
    res.send(await fs.readFile(file))
  } catch (error) {
    logger.error('Error serving GPU driver source:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
