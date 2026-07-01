import logger from '@main/logger'
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

    // Reject non-string query params before use. Express parses e.g.
    // ?executionId[x]=1 into an object; passing that to prisma.findUnique throws a
    // PrismaClientValidationError whose text (model/field names) would leak to this
    // unauthenticated caller. This also removes the need for the `as string` casts.
    if (typeof vmId !== 'string' || typeof executionId !== 'string' || typeof format !== 'string') {
      return res.status(400).json({ error: 'vmId, executionId and format must be provided as strings' })
    }

    // Validate format parameter
    if (format !== 'bash' && format !== 'powershell') {
      return res.status(400).json({
        error: 'format parameter is required and must be either "bash" or "powershell"'
      })
    }

    // Fetch script execution record
    const execution = await prisma.scriptExecution.findUnique({
      where: { id: executionId },
      include: { script: true }
    })

    // Fail closed with an IDENTICAL 404 for every mismatch (missing row, wrong
    // scriptId, wrong machineId). Returning distinct 404-vs-403 codes previously
    // formed an enumeration oracle for this unauthenticated endpoint.
    if (!execution || execution.scriptId !== scriptId || execution.machineId !== vmId) {
      return res.status(404).json({ error: 'Script execution not found' })
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
    // Log server-side only; never return raw error text (fs ENOENT with absolute
    // host paths, js-yaml parse errors, or Prisma internals) to this unauthenticated
    // caller — that hands an anonymous client host-layout reconnaissance.
    logger.error('Error serving script content:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
