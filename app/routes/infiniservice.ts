import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import { constants } from 'fs'

const router = express.Router()

// Get base directory for InfiniService binaries
const getInfiniServiceDir = (): string => {
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  return path.join(baseDir, 'infiniservice')
}

// Platform-specific binary and script paths
const INFINISERVICE_FILES = {
  windows: {
    binary: 'infiniservice.exe',
    script: 'install-windows.ps1'
  },
  linux: {
    binary: 'infiniservice',
    script: 'install-linux.sh'
  }
}

/**
 * Serve InfiniService binary for the specified platform
 * GET /infiniservice/:platform/binary
 */
router.get('/:platform/binary', async (req, res) => {
  try {
    const { platform } = req.params

    if (!['windows', 'linux'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Must be "windows" or "linux"' })
    }

    const infiniDir = getInfiniServiceDir()
    const binaryName = INFINISERVICE_FILES[platform as keyof typeof INFINISERVICE_FILES].binary
    const binaryPath = path.join(infiniDir, 'binaries', platform, binaryName)

    // Check if binary exists
    try {
      await fs.access(binaryPath, constants.R_OK)
    } catch {
      return res.status(404).json({ error: `Binary not found for platform: ${platform}` })
    }

    // Get file stats for headers
    const stats = await fs.stat(binaryPath)

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', stats.size.toString())
    res.setHeader('Content-Disposition', `attachment; filename="${binaryName}"`)

    // Stream the file
    const fileStream = await fs.readFile(binaryPath)
    res.send(fileStream)
  } catch (error) {
    console.error('Error serving InfiniService binary:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Serve InfiniService installation script for the specified platform
 * GET /infiniservice/:platform/script
 */
router.get('/:platform/script', async (req, res) => {
  try {
    const { platform } = req.params

    if (!['windows', 'linux'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform. Must be "windows" or "linux"' })
    }

    const infiniDir = getInfiniServiceDir()
    const scriptName = INFINISERVICE_FILES[platform as keyof typeof INFINISERVICE_FILES].script
    const scriptPath = path.join(infiniDir, 'install', scriptName)

    // Check if script exists
    try {
      await fs.access(scriptPath, constants.R_OK)
    } catch {
      return res.status(404).json({ error: `Installation script not found for platform: ${platform}` })
    }

    // Get file stats for headers
    const stats = await fs.stat(scriptPath)

    // Set appropriate headers
    const contentType = platform === 'windows' ? 'text/plain' : 'application/x-sh'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', stats.size.toString())
    res.setHeader('Content-Disposition', `attachment; filename="${scriptName}"`)

    // Stream the file
    const fileContent = await fs.readFile(scriptPath, 'utf-8')
    res.send(fileContent)
  } catch (error) {
    console.error('Error serving InfiniService script:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Get InfiniService metadata (version, checksums, etc.)
 * GET /infiniservice/metadata
 */
router.get('/metadata', async (req, res) => {
  try {
    const infiniDir = getInfiniServiceDir()
    const metadataPath = path.join(infiniDir, 'metadata.json')

    // Check if metadata exists
    try {
      await fs.access(metadataPath, constants.R_OK)
      const metadata = await fs.readFile(metadataPath, 'utf-8')
      res.json(JSON.parse(metadata))
    } catch {
      // Return default metadata if file doesn't exist
      res.json({
        version: '1.0.0',
        platforms: ['windows', 'linux'],
        updated: new Date().toISOString()
      })
    }
  } catch (error) {
    console.error('Error serving InfiniService metadata:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
