import { Router } from 'express'
import { promises as fs } from 'fs'
import path from 'path'

const router = Router()

interface WallpaperResponse {
  id: string;
  name: string;
  url: string;
  isDefault: boolean;
}

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

// Use environment variable for wallpapers directory
const WALLPAPERS_DIR = process.env.INFINIBAY_WALLPAPERS_DIR || '/opt/infinibay/wallpapers'

/**
 * GET /api/wallpapers
 * Returns list of available wallpaper files from the configured wallpapers directory
 */
router.get('/', async (_req, res) => {
  try {
    // Check if directory exists
    try {
      await fs.access(WALLPAPERS_DIR)
    } catch (error) {
      console.warn(`Wallpapers directory not found: ${WALLPAPERS_DIR}`)
      return res.json([])
    }

    // Read directory contents
    const files = await fs.readdir(WALLPAPERS_DIR)

    // Filter for image files and process them
    const wallpapers: WallpaperResponse[] = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase()
        return SUPPORTED_EXTENSIONS.includes(ext)
      })
      .map((file) => {
        const ext = path.extname(file)
        const nameWithoutExt = path.basename(file, ext)

        return {
          id: file, // Use full filename as ID to avoid duplicates
          name: nameWithoutExt,
          url: `/api/wallpapers/image/${file}`, // URL to serve the image through backend
          isDefault: false // Initialize as false
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically

    // Set the first wallpaper as default after sorting
    if (wallpapers.length > 0) {
      wallpapers[0].isDefault = true
    }

    console.log(`Found ${wallpapers.length} wallpapers in ${WALLPAPERS_DIR}`)
    res.json(wallpapers)
  } catch (error) {
    console.error('Error reading wallpapers directory:', error)
    res.status(500).json({
      error: 'Failed to load wallpapers',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * GET /api/wallpapers/image/:filename
 * Serves wallpaper images from the configured directory
 */
router.get('/image/:filename', async (req, res) => {
  try {
    const filename = req.params.filename

    // Validate filename (security check)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' })
    }

    const ext = path.extname(filename).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type' })
    }

    const filePath = path.join(WALLPAPERS_DIR, filename)

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch (error) {
      return res.status(404).json({ error: 'Wallpaper not found' })
    }

    // Set appropriate content type
    let contentType = 'image/jpeg'
    switch (ext) {
    case '.png':
      contentType = 'image/png'
      break
    case '.webp':
      contentType = 'image/webp'
      break
    case '.gif':
      contentType = 'image/gif'
      break
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400') // Cache for 24 hours

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('Error serving wallpaper image:', error)
    res.status(500).json({
      error: 'Failed to serve wallpaper',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

export default router
