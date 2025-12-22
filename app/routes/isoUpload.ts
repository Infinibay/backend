// External Libraries
import express from 'express'
import path from 'node:path'
import cors from 'cors'
import fs from 'fs/promises'
import multer from 'multer'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as yaml from 'js-yaml'
import * as os from 'os'

// Import admin authentication middleware
import { adminAuthMiddleware } from '../middleware/adminAuth'

// Import ISO Service
import ISOService from '../services/ISOService'

const execAsync = promisify(exec)

// Types
interface UploadMetadata {
  fileName: string;
  os: string;
  fileSize: number;
}

const VALID_OS_TYPES = ['windows10', 'windows11', 'ubuntu', 'fedora'] as const
type ValidOSType = typeof VALID_OS_TYPES[number];

// Helper functions
async function ensureDirectoryExists (dir: string): Promise<void> {
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { recursive: true })
  }
}

async function validateMetadata (
  fileName: string,
  os: string | undefined,
  fileSize: number
): Promise<UploadMetadata> {
  if (!os) {
    throw new Error('Missing required field: os')
  }

  const normalizedOs = os.toLowerCase()
  if (!VALID_OS_TYPES.includes(normalizedOs as ValidOSType)) {
    throw new Error(`Invalid OS type ${os}, expected one of ${VALID_OS_TYPES.join(', ')}`)
  }

  if (!fileName || !fileName.toLowerCase().endsWith('.iso')) {
    throw new Error('Invalid file type. Only ISO files are allowed')
  }

  return {
    fileName,
    os: normalizedOs,
    fileSize
  }
}

/**
 * Validates that an Ubuntu ISO is a Desktop variant, not Server.
 * Reads casper/install-sources.yaml from the ISO to check available installation sources.
 *
 * @param isoPath - Path to the uploaded ISO file
 * @returns Object with valid boolean and optional error message
 */
async function validateUbuntuDesktopISO (isoPath: string): Promise<{ valid: boolean; error?: string }> {
  const tempDir = path.join(os.tmpdir(), `iso-validate-${Date.now()}`)

  try {
    // Create temp directory for extraction
    await fs.mkdir(tempDir, { recursive: true })

    // Extract only casper/install-sources.yaml from the ISO using 7z
    try {
      await execAsync(`7z e "${isoPath}" "casper/install-sources.yaml" -o"${tempDir}" -y`, {
        timeout: 30000 // 30 second timeout
      })
    } catch (extractError) {
      // If casper/install-sources.yaml doesn't exist, it's likely not a valid Ubuntu ISO
      // or it's an older format - we'll allow it but log a warning
      console.warn('Could not extract install-sources.yaml from ISO - may be an older Ubuntu format')
      return { valid: true } // Allow for backwards compatibility
    }

    // Read and parse the install-sources.yaml
    const installSourcesPath = path.join(tempDir, 'install-sources.yaml')

    try {
      await fs.access(installSourcesPath)
    } catch {
      // File wasn't extracted - likely not a standard Ubuntu ISO
      console.warn('install-sources.yaml not found in ISO')
      return { valid: true } // Allow for backwards compatibility
    }

    const content = await fs.readFile(installSourcesPath, 'utf-8')
    const sources = yaml.load(content) as Array<{ id: string; [key: string]: unknown }>

    if (!Array.isArray(sources)) {
      console.warn('install-sources.yaml has unexpected format')
      return { valid: true } // Allow for backwards compatibility
    }

    // Check if this is a Desktop ISO (has ubuntu-desktop or ubuntu-desktop-minimal)
    const hasDesktopSource = sources.some(
      source => source.id === 'ubuntu-desktop' || source.id === 'ubuntu-desktop-minimal'
    )

    // Check if this is a Server ISO (has ubuntu-server or ubuntu-server-minimal)
    const hasServerSource = sources.some(
      source => source.id === 'ubuntu-server' || source.id === 'ubuntu-server-minimal'
    )

    if (hasServerSource && !hasDesktopSource) {
      return {
        valid: false,
        error: 'Este ISO es Ubuntu Server. Infinibay requiere Ubuntu Desktop para proporcionar ' +
               'una experiencia de escritorio completa. Por favor descarga Ubuntu Desktop desde ' +
               'https://ubuntu.com/download/desktop'
      }
    }

    if (!hasDesktopSource && !hasServerSource) {
      // Unknown ISO type - allow it but log
      console.warn('ISO does not contain recognized ubuntu-desktop or ubuntu-server sources')
      return { valid: true }
    }

    return { valid: true }
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Create and configure the router
const router = express.Router()

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const baseDir = process.env.INFINIBAY_BASE_DIR
    if (!baseDir) {
      return cb(new Error('INFINIBAY_BASE_DIR not configured'), '')
    }
    const tempDir = path.join(baseDir, 'temp')
    await ensureDirectoryExists(tempDir)
    cb(null, tempDir)
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024 * 100 // 100GB
  }
})

router.post('/',
  cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600
  }),
  (req, res, next) => {
    // Set timeout to 30 minutes for large file uploads
    req.setTimeout(30 * 60 * 1000)
    res.setTimeout(30 * 60 * 1000)
    next()
  },
  adminAuthMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        throw new Error('No file uploaded')
      }

      // Validate metadata
      const uploadMetadata = await validateMetadata(
        req.file.originalname,
        req.body.os,
        req.file.size
      )

      // For Ubuntu ISOs, validate that it's a Desktop variant (not Server)
      if (uploadMetadata.os === 'ubuntu') {
        const validation = await validateUbuntuDesktopISO(req.file.path)
        if (!validation.valid) {
          // Delete the uploaded temp file
          await fs.unlink(req.file.path).catch(() => {})
          throw new Error(validation.error || 'Invalid Ubuntu ISO')
        }
      }

      // Ensure ISO directory exists
      const baseDir = process.env.INFINIBAY_BASE_DIR
      if (!baseDir) {
        throw new Error('INFINIBAY_BASE_DIR not configured')
      }
      const isoDir = path.join(baseDir, 'iso')
      await ensureDirectoryExists(isoDir)

      // Move file to target location
      const targetPath = path.join(isoDir, `${uploadMetadata.os}.iso`)
      await fs.rename(req.file.path, targetPath)

      // Register ISO in database
      const isoService = ISOService.getInstance()
      const iso = await isoService.registerISO(
        `${uploadMetadata.os}.iso`,
        uploadMetadata.os,
        req.file.size,
        targetPath
      )

      res.status(200).json({
        message: 'File uploaded successfully',
        bytesReceived: req.file.size,
        fileName: uploadMetadata.fileName,
        os: uploadMetadata.os,
        isoId: iso.id
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('limit')) {
          res.status(413).json({ error: 'File size exceeds limit (100GB)' })
        } else if (error.message.includes('timeout')) {
          res.status(408).json({ error: 'Request timed out' })
        } else {
          res.status(400).json({ error: error.message })
        }
      } else {
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  }
)

export default router
