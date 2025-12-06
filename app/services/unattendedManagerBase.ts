import { Application } from '@prisma/client'
import { Builder } from 'xml2js'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promises as fsPromises } from 'fs'

import { Debugger } from '@utils/debug'
// ... other imports ...

export class UnattendedManagerBase {
  protected debug: Debugger = new Debugger('unattended-manager-base')

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

  /**
   * Generates a new image.
   *
   * @returns A Promise that resolves to the path of the generated image.
   * @throws If there is an error generating the image.
   */
  async generateNewImage (): Promise<string> {
    this.debug.log('Starting to generate new image')
    let extractDir: string | null = null
    try {
      this.debug.log('Validating ISO path')
      if (!this.isoPath) {
        throw Error('No ISO path specified')
      }
      this.debug.log('Generating config')
      const configContent = await this.generateConfig()
      this.debug.log(configContent)

      // Validate the generated configuration
      this.debug.log('Validating generated configuration')
      const validation = await this.validateConfig(configContent)
      if (!validation.valid) {
        const errorMsg = `Configuration validation failed: ${validation.errors.join('; ')}`
        this.debug.log('error', errorMsg)
        throw new Error(errorMsg)
      }
      this.debug.log('Configuration validation passed')

      this.debug.log('Validating output path')
      // Use the temp ISO directory for generated ISOs
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')
      const outputPath = this.validatePath(tempIsoDir, '/opt/infinibay/iso/temp')

      this.debug.log('Generating random file name for new ISO')
      const newIsoName = this.generateRandomFileName()
      const newIsoPath = path.join(outputPath, newIsoName)

      this.debug.log('Extracting ISO')
      extractDir = await this.extractISO(this.isoPath)
      if (this.configFileName) {
        this.debug.log('Adding autoinstall config file')
        console.log('Adding autoinstall config file')
        console.log(configContent)
        await this.addAutonistallConfigFile(configContent, extractDir, this.configFileName)
      } else {
        this.debug.log('Error: configFileName is not set')
        throw new Error('configFileName is not set')
      }
      this.debug.log('Creating new ISO')
      await this.createISO(newIsoPath, extractDir)
      // TODO: We may need to delete the iso file in the future, after finishing the installation process

      // Optional: Clean up extracted files
      this.debug.log('Cleaning up extracted files')
      await this.cleanup(extractDir)

      this.debug.log('New image generated successfully')
      return newIsoPath
    } catch (error) {
      this.debug.log(`Error generating new image: ${error}`)
      if (extractDir) {
        this.debug.log('Cleaning up extracted files due to error')
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
      this.debug.log(`Path does not exist, creating: ${finalPath}`)
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
    return Math.random().toString(36).substring(2, 15) + '.iso'
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
   * This method extracts the ISO file to a temporary directory.
   * It uses the 7z command to extract the ISO file.
   * @param {string} isoPath - The path to the ISO file.
   * @returns {Promise<string>} The path to the directory where the ISO file was extracted.
   */
  protected async extractISO (isoPath: string): Promise<string> {
    const extractDir = path.join(os.tmpdir(), 'extracted_iso_' + Date.now())
    await fsPromises.mkdir(extractDir, { recursive: true })
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
    this.debug.log(`Starting to add Autonistall Config File: ${fileName}`)
    const destPath = path.join(extractDir, fileName)
    await fsPromises.writeFile(destPath, content)
    this.debug.log(`Successfully added Autonistall Config File: ${fileName}`)
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

      this.debug.log(`Starting cleanup of directory: ${extractDir}`)

      await fsPromises.rm(extractDir, { recursive: true, force: true })

      this.debug.log(`Successfully cleaned up directory: ${extractDir}`)
    } catch (error) {
      this.debug.log(`Error during cleanup: ${error}`)
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
        console.error(`stderr: ${data}`)
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output)
        } else {
          console.error(`Command failed with exit code ${code}: ${commandParts.join(' ')}`)
          reject(new Error(`Command failed with exit code ${code}`))
        }
      })

      process.on('error', (error) => {
        console.error(`Error occurred while executing command: ${commandParts.join(' ')}`)
        reject(error)
      })
    })
  }
}
