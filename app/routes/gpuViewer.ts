import logger from '@main/logger'
import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import { constants } from 'fs'

const router = express.Router()

// Base directory for staged infinigpu native-viewer binaries (the desktop client
// users run to watch a GPU VM's infiniPixel stream). Mirrors the served-binary
// layout under INFINIBAY_BASE_DIR.
const getGpuViewerDir = (): string => {
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  return path.join(baseDir, 'gpu-viewer')
}

const VIEWER_FILES: Record<string, string> = {
  linux: 'infinigpu-viewer',
  windows: 'infinigpu-viewer.exe'
}

/**
 * Serve the infinigpu native viewer for the user's OS. The Settings download card
 * links here; the user runs the binary and points it at the ws:// URL from
 * gpuConsoleStream. GET /gpu-viewer/:platform/binary  (platform ∈ {linux, windows})
 * 404s until the binary is staged (built + copied into the infinibay_base volume).
 */
router.get('/:platform/binary', async (req, res) => {
  try {
    const { platform } = req.params

    if (!VIEWER_FILES[platform]) {
      return res.status(400).json({ error: 'Invalid platform. Must be "linux" or "windows"' })
    }

    const name = VIEWER_FILES[platform]
    const file = path.join(getGpuViewerDir(), platform, name)

    try {
      await fs.access(file, constants.R_OK)
    } catch {
      return res.status(404).json({ error: `Viewer not staged for platform: ${platform} (run the infinigpu build)` })
    }

    const stats = await fs.stat(file)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', stats.size.toString())
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    res.send(await fs.readFile(file))
  } catch (error) {
    logger.error('Error serving GPU viewer binary:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
