// External Libraries
import express from 'express'
import path from 'node:path'
import cors from 'cors'
import fs from 'fs/promises'
import multer from 'multer'

// Import admin authentication middleware
import { adminAuthMiddleware } from '../middleware/adminAuth'

// Import ISO Service
import ISOService from '../services/ISOService'

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
