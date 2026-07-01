import { Logger } from 'winston'
import logger from '@main/logger'
import { Application } from '@prisma/client'
import { Builder } from 'xml2js'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promises as fsPromises } from 'fs'
import { randomUUID } from 'crypto'


export class UnattendedManagerBase {
  protected debug: Logger = logger.child({ module: 'unattended-manager-base' })

  configFileName: string | null = null
  isoPath: string | null = null

  public async generateConfig (): Promise<string> {
    return ''
  }

  /**
   * Validates the generated configuration before creating the ISO.
   * Subclasses should override this method to provide specific validation.
   * @param {string} configContent - The configuration content to validate
   * @returns {Promise<{ valid: boolean; errors: string[] }>} Validation result
   */
  protected async validateConfig (configContent: string): Promise<{ valid: boolean; errors: string[] }> {
    // Base implementation: no validation, always valid
    return { valid: true, errors: [] }
  }

  /** True if `bin` is an executable on PATH (no spawn — a cheap pre-flight check). */
  protected static isToolAvailable (bin: string): boolean {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    return dirs.some((d) => {
      try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true } catch { return false }
    })
  }

  /**
   * Verify the external tools the unattended-ISO pipeline shells out to are actually
   * installed BEFORE doing any work. Without this, a missing dependency surfaces as a
   * cryptic "Command failed with exit code 2" deep inside extraction/repack, which the
   * caller then swallows into a silent base-ISO fallback (a VM that boots the
   * INTERACTIVE installer and never finishes). Fail early with an actionable message.
   */
  protected assertRequiredTools (): void {
    const missing: string[] = []
    if (!UnattendedManagerBase.isToolAvailable('7z')) {
      missing.push("'7z' (install the 'p7zip-full' package)")
    }
    if (!UnattendedManagerBase.isToolAvailable('xorriso') && !UnattendedManagerBase.isToolAvailable('genisoimage')) {
      missing.push("'xorriso' or 'genisoimage'")
    }
    if (missing.length > 0) {
      throw new Error(
        `Unattended install ISO generation is missing required tool(s): ${missing.join(', ')}. ` +
        'Install them on the host/agent that builds VM images and retry.'
      )
    }
  }

  /**
   * Generates a new image.
   *
   * @returns A Promise that resolves to the path of the generated image.
   * @throws If there is an error generating the image.
   */
  async generateNewImage (): Promise<string> {
    this.debug.debug('Starting to generate new image')
    let extractDir: string | null = null
    try {
      this.debug.debug('Validating ISO path')
      if (!this.isoPath) {
        throw Error('No ISO path specified')
      }
      // Fail fast with an actionable message if the extract/repack tooling is absent.
      this.assertRequiredTools()
      this.debug.debug('Generating config')
      const configContent = await this.generateConfig()
      this.debug.debug(this.redactConfigForLog(configContent))

      // Validate the generated configuration
      this.debug.debug('Validating generated configuration')
      const validation = await this.validateConfig(configContent)
      if (!validation.valid) {
        const errorMsg = `Configuration validation failed: ${validation.errors.join('; ')}`
        this.debug.error(errorMsg)
        throw new Error(errorMsg)
      }
      this.debug.debug('Configuration validation passed')

      this.debug.debug('Validating output path')
      // Use the temp ISO directory for generated ISOs
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')
      const outputPath = this.validatePath(tempIsoDir, '/opt/infinibay/iso/temp')

      this.debug.debug('Generating random file name for new ISO')
      const newIsoName = this.generateRandomFileName()
      const newIsoPath = path.join(outputPath, newIsoName)

      this.debug.debug('Extracting ISO')
      extractDir = await this.extractISO(this.isoPath)
      if (this.configFileName) {
        this.debug.debug('Adding autoinstall config file')
        logger.info('Adding autoinstall config file')
        // Log a redacted copy only; addAutonistallConfigFile still gets the raw
        // config (the credential must be present in the ISO that is written).
        logger.info(this.redactConfigForLog(configContent))
        await this.addAutonistallConfigFile(configContent, extractDir, this.configFileName)
      } else {
        this.debug.debug('Error: configFileName is not set')
        throw new Error('configFileName is not set')
      }
      this.debug.debug('Creating new ISO')
      await this.createISO(newIsoPath, extractDir)
      // Note: Temp ISO cleanup is handled by ejectAllCdroms() in InfinizationService.ts

      // Optional: Clean up extracted files
      this.debug.debug('Cleaning up extracted files')
      await this.cleanup(extractDir)

      this.debug.debug('New image generated successfully')
      return newIsoPath
    } catch (error) {
      this.debug.debug(`Error generating new image: ${error}`)
      if (extractDir) {
        this.debug.debug('Cleaning up extracted files due to error')
        await this.cleanup(extractDir)
      }
      throw error
    }
  }

  /**
   * Validates the given path. If the path is not set or invalid, it uses the default path.
   * Also creates the directory if it doesn't exist.
   * @param {string | undefined} envPath - The path to validate.
   * @param {string} defaultPath - The default path to use if the envPath is not set or invalid.
   * @returns {string} The validated path.
   */
  protected validatePath (envPath: string | undefined, defaultPath: string): string {
    const finalPath = envPath || defaultPath

    if (!fs.existsSync(finalPath)) {
      this.debug.debug(`Path does not exist, creating: ${finalPath}`)
      fs.mkdirSync(finalPath, { recursive: true })
    }

    return finalPath
  }

  /**
   * This method generates a random file name for the new ISO.
   * It uses the Math.random function to generate a random number, converts it to a string with base 36,
   * and then takes a substring of the result. It appends the '.iso' extension to the end of the string.
   * @returns {string} The random file name.
   */
  protected generateRandomFileName (): string {
    // randomUUID is collision-proof, unlike Math.random().toString(36) whose
    // short body can clash between concurrent creates in the SHARED temp dir —
    // a clash would let one VM boot another VM's autounattend (its credentials).
    return randomUUID() + '.iso'
  }

  /**
   * Sanitizes a script name for safe use in file paths and log files.
   * - Replaces spaces with underscores
   * - Removes all characters except A-Z, a-z, 0-9, underscore, and hyphen
   * - Truncates to maximum 60 characters
   * - Ensures the result is not empty (fallback to 'script')
   *
   * @param {string} scriptName - The original script name to sanitize
   * @returns {string} The sanitized script name safe for filenames
   */
  protected sanitizeScriptName (scriptName: string): string {
    if (!scriptName || typeof scriptName !== 'string') {
      return 'script'
    }

    // Replace spaces with underscores, then keep only safe characters
    let sanitized = scriptName
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '')

    // Truncate to 60 characters for safety
    if (sanitized.length > 60) {
      sanitized = sanitized.substring(0, 60)
    }

    // Ensure we have a valid result
    return sanitized.length > 0 ? sanitized : 'script'
  }

  /**
   * Returns a redacted copy of a rendered unattended config safe for logging.
   *
   * Generated configs embed the guest password (and product key) in cleartext —
   * Windows autounattend puts them in `<Value>`/`<Password>` elements (AutoLogon,
   * LocalAccount), Ubuntu/RHEL in YAML `password:`/`passwd:`/`rootpw` lines.
   * This masks them structurally (no need to know the literal secret), so the
   * logged copy never leaks credentials. ONLY the logged copy is redacted — the
   * config actually written to the ISO is unchanged.
   */
  protected redactConfigForLog (configContent: string): string {
    return configContent
      // Windows autounattend: <Value>...</Value> (covers Password.Value etc.).
      // Over-redacts non-secret <Value> settings, which is acceptable for a log.
      .replace(/(<Value>)[\s\S]*?(<\/Value>)/gi, '$1**redacted**$2')
      // Explicit <Password>/<PlainText> elements.
      .replace(/(<(?:Password|PlainText)>)[\s\S]*?(<\/(?:Password|PlainText)>)/gi, '$1**redacted**$2')
      // YAML / kickstart credential lines.
      .replace(/^(\s*(?:password|passwd|plain_text_passwd|rootpw)\s*[:=]\s*).*$/gim, '$1**redacted**')
      // Per-VM infiniservice HMAC secret, injected as `export FOO='...'` (Linux)
      // or `$env:FOO='...'` (Windows CommandLine). Mask the single-quoted value.
      .replace(/(INFINISERVICE_SHARED_SECRET\s*=\s*')[^']*(')/gi, '$1**redacted**$2')
      // Windows product key: specialize <ProductKey>KEY</ProductKey> and windowsPE
      // <ProductKey><Key>KEY</Key>...</ProductKey>. Mask the whole block — the
      // non-greedy inner match also redacts the nested <Key> (a real purchased
      // license key must never reach the logs).
      .replace(/(<ProductKey>)[\s\S]*?(<\/ProductKey>)/gi, '$1**redacted**$2')
  }

  /**
   * This method extracts the ISO file to a temporary directory.
   * It uses the 7z command to extract the ISO file.
   * @param {string} isoPath - The path to the ISO file.
   * @returns {Promise<string>} The path to the directory where the ISO file was extracted.
   */
  protected async extractISO (isoPath: string): Promise<string> {
    // mkdtemp atomically creates a fresh, exclusive dir. A Date.now() suffix +
    // recursive mkdir silently MERGES when two concurrent builds hit the same
    // millisecond, letting them share one extraction dir — one VM's autounattend
    // (its cleartext credentials) could bake into another's ISO, and whichever
    // finishes first would rm -rf the dir out from under the other. Same reason
    // generateRandomFileName() uses randomUUID for the output name.
    const extractDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'extracted_iso_'))
    await this.executeCommand(['7z', 'x', isoPath, '-o' + extractDir])
    return extractDir
  }

  /**
   * This method adds fileName to the file system.
   * It copies the XML file from the given path to the destination path.
   * @param {string} xmlPath - The path to the XML file.
   * @param {string} extractDir - The directory where the XML file will be copied.
   * @returns {Promise<void>}
   */
  protected async addAutonistallConfigFile (content: string, extractDir: string, fileName: string): Promise<void> {
    this.debug.debug(`Starting to add Autonistall Config File: ${fileName}`)
    const destPath = path.join(extractDir, fileName)
    await fsPromises.writeFile(destPath, content)
    this.debug.debug(`Successfully added Autonistall Config File: ${fileName}`)
  }

  /**
   * This method creates a new ISO file from the extracted directory.
   * It uses the 'mkisofs' command to create the ISO file.
   * @param {string} newIsoPath - The path where the new ISO file will be created.
   * @param {string} extractDir - The directory from which the ISO file will be created.
   * @returns {Promise<void>}
   */
  protected async createISO (newIsoPath: string, extractDir: string): Promise<void> {
    throw new Error('Not implemented')
  }

  /**
   * This method cleans up the temporary directory used for ISO extraction.
   * It uses the fsPromises.rm method to delete the directory and all its contents.
   * @param {string} extractDir - The directory to be cleaned up.
   * @returns {Promise<void>}
   */
  protected async cleanup (extractDir: string): Promise<void> {
    try {
      // Safety check: Ensure extractDir is not empty and is within the system's temp directory
      if (!extractDir || !extractDir.startsWith(os.tmpdir())) {
        throw new Error('Invalid directory path for cleanup.')
      }

      this.debug.debug(`Starting cleanup of directory: ${extractDir}`)

      await fsPromises.rm(extractDir, { recursive: true, force: true })

      this.debug.debug(`Successfully cleaned up directory: ${extractDir}`)
    } catch (error) {
      this.debug.debug(`Error during cleanup: ${error}`)
      // We'll just log the error and continue, as cleanup failure shouldn't stop the process
    }
  }

  /**
   * This method executes a command using the spawn function from the 'child_process' module.
   * It takes an array of command parts as input, where the first element is the command and the rest are the arguments.
   * The method returns a Promise that resolves when the command finishes successfully, and rejects if the command fails or an error occurs.
   * @param {string[]} commandParts - The command to execute and its arguments.
   * @returns {Promise<void>}
   */
  protected executeCommand (commandParts: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(commandParts[0], commandParts.slice(1))
      let output = ''

      process.stdout.on('data', (data) => {
        output += data
      })

      process.stderr.on('data', (data) => {
        logger.error(`stderr: ${data}`)
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output)
        } else {
          logger.error(`Command failed with exit code ${code}: ${commandParts.join(' ')}`)
          reject(new Error(`Command failed with exit code ${code}`))
        }
      })

      process.on('error', (error) => {
        logger.error(`Error occurred while executing command: ${commandParts.join(' ')}`)
        reject(error)
      })
    })
  }
}
