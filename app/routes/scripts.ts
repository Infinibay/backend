import express from 'express'
import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import { ScriptParser } from '../services/scripts/ScriptParser'
import { TemplateEngine } from '../services/scripts/TemplateEngine'

const router = express.Router()
const prisma = new PrismaClient()
const scriptParser = new ScriptParser()
const templateEngine = new TemplateEngine()

/**
 * Serve script content with interpolated input values
 * GET /scripts/:scriptId/content
 * Query params: vmId, executionId, format (powershell|bash)
 */
router.get('/:scriptId/content', async (req, res) => {
  try {
    const { scriptId } = req.params
    const { vmId, executionId, format } = req.query

    // Validate required parameters
    if (!vmId || !executionId) {
      return res.status(400).json({ error: 'vmId and executionId are required' })
    }

    // Validate format parameter
    if (!format || (format !== 'bash' && format !== 'powershell')) {
      return res.status(400).json({
        error: 'format parameter is required and must be either "bash" or "powershell"'
      })
    }

    // Fetch script execution record
    const execution = await prisma.scriptExecution.findUnique({
      where: { id: executionId as string },
      include: { script: true }
    })

    if (!execution || execution.scriptId !== scriptId) {
      return res.status(404).json({ error: 'Script execution not found' })
    }

    // Verify VM ID matches
    if (execution.machineId !== vmId) {
      return res.status(403).json({ error: 'VM ID mismatch' })
    }

    // Read script file from disk
    const scriptsDir = path.join(process.env.INFINIBAY_BASE_DIR || '/opt/infinibay', 'scripts')
    const scriptPath = path.join(scriptsDir, 'library', execution.script.fileName)
    const scriptContent = await fs.readFile(scriptPath, 'utf-8')

    // Parse the script file to get the script body and metadata
    const parsedScript = scriptParser.parseYAML(scriptContent)

    // Interpolate input values into the script content
    const inputValues = (execution.inputValues as Record<string, any>) || {}
    const interpolated = templateEngine.interpolate(parsedScript.script, inputValues)

    // Set appropriate content type and file extension
    const contentType = format === 'bash' ? 'application/x-sh' : 'application/octet-stream'
    const fileExtension = format === 'bash' ? 'sh' : 'ps1'

    // Sanitize filename: replace spaces with underscores, keep only safe chars, truncate to 60 chars
    let sanitizedName = execution.script.name
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .substring(0, 60)

    // Ensure we have a valid filename
    if (!sanitizedName) {
      sanitizedName = 'script'
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}.${fileExtension}"`)

    // Send interpolated script
    res.send(interpolated)
  } catch (error) {
    console.error('Error serving script content:', error)
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

export default router
