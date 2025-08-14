import { Application } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { Eta } from 'eta'

import { UnattendedManagerBase } from './unattendedManagerBase'

/**
 * UnattendedRedHatManager is a class that extends UnattendedManagerBase.
 * It is used to generate a Kickstart configuration file for unattended Red Hat installations.
 * The class takes a username, password, and a list of applications as parameters.
 * It generates a configuration file that includes the user credentials and the post-installation scripts for the applications (TODO).
 *
 * Usage:
 * const unattendedManager = new UnattendedRedHatManager(username, password, applications);
 * const config = unattendedManager.generateConfig();
 *
 * For more information on Kickstart installations, refer to the Red Hat documentation:
 * https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/installation_guide/chap-kickstart-installations
 */

export class UnattendedRedHatManager extends UnattendedManagerBase {
  private username: string
  private password: string
  private applications: Application[]
  private vmId: string = ''
  // protected debug: Debugger = new Debugger('unattended-redhat-manager');

  constructor (username: string, password: string, applications: Application[], vmId?: string) {
    super()
    this.debug.log('Initializing UnattendedRedHatManager')
    if (!username || !password) {
      this.debug.log('error', 'Username and password are required')
      throw new Error('Username and password are required')
    }
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'fedora.iso')
    this.username = username
    this.password = password
    this.applications = applications
    this.vmId = vmId || ''
    this.configFileName = 'ks.cfg'
    this.debug.log('UnattendedRedHatManager initialized')
  }

  async generateConfig (): Promise<string> {
    this.debug.log('Generating RedHat kickstart configuration')
    const applicationsPostCommands = await this.generateApplicationsConfig()
    const infiniServicePostCommands = this.generateInfiniServiceConfig()
    this.debug.log('Applications and InfiniService post commands generated')

    // Initialize Eta template engine
    const eta = new Eta({
      views: path.join(process.env.INFINIBAY_BASE_DIR ?? path.join(__dirname, '..'), 'templates'),
      cache: true
    })

    try {
      const templatePath = path.join(__dirname, '../templates/redhat_kickstart.cfg.eta')
      const templateContent = fs.readFileSync(templatePath, 'utf8')

      // Render the template with our data
      const renderedConfig = eta.renderString(templateContent, {
        username: this.username,
        password: this.password,
        applicationsPostCommands,
        infiniServicePostCommands
      })

      this.debug.log('RedHat kickstart configuration generated successfully')
      return renderedConfig
    } catch (error) {
      this.debug.log('error', `Failed to render RedHat kickstart template: ${error}`)
      throw error
    }
  }

  public async generateApplicationsConfig (): Promise<string> {
    if (!this.applications || this.applications.length === 0) {
      return ''
    }

    // Filter applications compatible with RedHat/Fedora
    const redHatApps = this.applications.filter(app =>
      app.os.includes('redhat') || app.os.includes('fedora')
    )

    if (redHatApps.length === 0) {
      return ''
    }

    let postInstallScript = '%post --log=/root/ks-post.log\n'
    postInstallScript += 'echo "Starting application installation..."\n'

    const installCommands: string[] = []

    redHatApps.forEach(app => {
      // Find the Red Hat/Fedora OS index
      const osIndex = app.os.findIndex(os => os === 'redhat' || os === 'fedora')
      // Ensure installCommand is an array and the command exists for the found OS index
      if (osIndex !== -1 && Array.isArray(app.installCommand) && app.installCommand.length > osIndex && app.installCommand[osIndex]) {
        // Assuming installCommand contains the package name for dnf
        installCommands.push(app.installCommand[osIndex] as string)
      }
    })

    if (installCommands.length > 0) {
      postInstallScript += `dnf install -y ${installCommands.join(' ')}\n`
      postInstallScript += 'echo "Application installation finished."\n'
    } else {
      postInstallScript += 'echo "No compatible applications found or install commands missing."\n'
    }

    postInstallScript += '%end\n'

    return postInstallScript
  }

  /**
   * Generates post-install commands to install InfiniService on RedHat/Fedora.
   * Downloads the binary and installation script from the backend server.
   * 
   * @returns Post-install script for InfiniService installation
   */
  private generateInfiniServiceConfig (): string {
    const backendHost = process.env.APP_HOST || 'localhost'
    const backendPort = process.env.PORT || '4000'
    const baseUrl = `http://${backendHost}:${backendPort}`
    
    let postInstallScript = '%post --log=/root/infiniservice-install.log\n'
    postInstallScript += 'echo "Starting InfiniService installation..."\n'
    postInstallScript += '\n'
    postInstallScript += '# Create temp directory for InfiniService\n'
    postInstallScript += 'mkdir -p /tmp/infiniservice\n'
    postInstallScript += 'cd /tmp/infiniservice\n'
    postInstallScript += '\n'
    postInstallScript += '# Download InfiniService binary\n'
    postInstallScript += 'echo "Downloading InfiniService binary..."\n'
    postInstallScript += `if curl -f -o infiniservice "${baseUrl}/infiniservice/linux/binary"; then\n`
    postInstallScript += '    echo "Binary downloaded successfully"\n'
    postInstallScript += 'else\n'
    postInstallScript += '    echo "Failed to download InfiniService binary"\n'
    postInstallScript += '    exit 1\n'
    postInstallScript += 'fi\n'
    postInstallScript += '\n'
    postInstallScript += '# Download installation script\n'
    postInstallScript += 'echo "Downloading InfiniService installation script..."\n'
    postInstallScript += `if curl -f -o install-linux.sh "${baseUrl}/infiniservice/linux/script"; then\n`
    postInstallScript += '    echo "Script downloaded successfully"\n'
    postInstallScript += 'else\n'
    postInstallScript += '    echo "Failed to download InfiniService installation script"\n'
    postInstallScript += '    exit 1\n'
    postInstallScript += 'fi\n'
    postInstallScript += '\n'
    postInstallScript += '# Make files executable\n'
    postInstallScript += 'chmod +x infiniservice install-linux.sh\n'
    postInstallScript += '\n'
    postInstallScript += '# Run installation script with VM ID\n'
    postInstallScript += `echo "Installing InfiniService with VM ID: ${this.vmId}"\n`
    postInstallScript += `if ./install-linux.sh normal "${this.vmId}"; then\n`
    postInstallScript += '    echo "InfiniService installed successfully"\n'
    postInstallScript += 'else\n'
    postInstallScript += '    echo "InfiniService installation failed"\n'
    postInstallScript += '    # Continue with installation even if InfiniService fails\n'
    postInstallScript += 'fi\n'
    postInstallScript += '\n'
    postInstallScript += '# Clean up temp files\n'
    postInstallScript += 'cd /\n'
    postInstallScript += 'rm -rf /tmp/infiniservice\n'
    postInstallScript += '\n'
    postInstallScript += 'echo "InfiniService installation process completed"\n'
    postInstallScript += '%end\n'
    
    return postInstallScript
  }

  /**
   * Modifies the GRUB configuration file to add Kickstart parameters.
   * @param grubCfgPath - Path to the grub.cfg file.
   */
  private async modifyGrubConfigForKickstart (grubCfgPath: string): Promise<void> {
    this.debug.log(`Attempting to modify GRUB config for Kickstart: ${grubCfgPath}`)
    try {
      let content = await fs.promises.readFile(grubCfgPath, 'utf-8')

      // Add inst.ks parameter to linux/linuxefi lines
      // Regex to find linux/linuxefi lines, capturing indentation and the rest of the line
      const linuxLineRegex = /^(\s*)(linux|linuxefi)(\s+.*)$/gm
      let modified = false

      content = content.replace(linuxLineRegex, (match, indent, command, args) => {
        // Avoid adding if already present (simple check)
        if (args.includes('inst.ks=')) {
          this.debug.log(`Kickstart parameter already found in line: ${match.trim()}`)
          return match // Return original match
        }
        // Append the kickstart parameter
        let modifiedLine = `${indent}${command}${args.trimEnd()} inst.ks=cdrom:/ks.cfg`
        modifiedLine = modifiedLine.replace(/(\s*rd.live.check\s*)/gm, ' ')
        modifiedLine = modifiedLine.replace(/(\s*rd.live.image\s*)/gm, ' ')
        this.debug.log(`Modifying GRUB line: ${match.trim()} -> ${modifiedLine.trim()}`)
        modified = true
        return modifiedLine
      })

      // AAAAAAAAAAAAA
      // Set GRUB timeout to 3 seconds
      const timeoutRegex = /^\s*set\s+timeout\s*=\s*\d+\s*$/gm
      if (timeoutRegex.test(content)) {
        // Replace existing timeout setting
        content = content.replace(timeoutRegex, (match) => {
          const indent = match.match(/^\s*/)?.[0] || ''
          this.debug.log(`Changing GRUB timeout: ${match.trim()} -> ${indent}set timeout=3`)
          modified = true
          return `${indent}set timeout=3`
        })
      } else {
        // Add timeout setting if not found
        // Look for a good place to insert it - typically after the first few lines
        const lines = content.split('\n')
        let insertIndex = 0

        // Find a good insertion point - after initial comments and set commands
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          if (lines[i].trim().startsWith('set ')) {
            insertIndex = i + 1
          }
        }

        lines.splice(insertIndex, 0, 'set timeout=3')
        content = lines.join('\n')
        this.debug.log(`Added GRUB timeout setting at line ${insertIndex + 1}: set timeout=3`)
        modified = true
      }

      if (modified) {
        await fs.promises.writeFile(grubCfgPath, content, 'utf-8')
        this.debug.log(`Successfully modified GRUB config: ${grubCfgPath}`)
      } else {
        this.debug.log('warning', `No suitable linux/linuxefi lines found or modified in ${grubCfgPath}`)
      }
    } catch (error) {
      this.debug.log('error', `Failed to modify GRUB config ${grubCfgPath}: ${error}`)
      // Decide if this should be a fatal error or just a warning
      // For now, log as error but don't throw, ISO creation might still work if user manually specifies ks
    }
  }

  /**
   * Creates a new ISO image with the Kickstart configuration.
   *
   * @param {string} newIsoPath - The path to the new ISO image file
   * @param {string} extractDir - The directory containing the extracted ISO
   * @returns {Promise<void>}
   */
  async createISO (newIsoPath: string, extractDir: string): Promise<void> {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error(`Extraction directory does not exist: ${extractDir}`)
    }

    this.debug.log('Creating Kickstart configuration file...')

    // Generate the configuration
    const config = await this.generateConfig()

    // Write ks.cfg to the root of the extracted directory
    const kickstartPath = path.join(extractDir, 'ks.cfg')
    await fs.promises.writeFile(kickstartPath, config)
    this.debug.log(`Kickstart configuration written to ${kickstartPath}`)

    // Find and modify GRUB configurations
    // Common paths for GRUB config in Fedora/RHEL ISOs
    const potentialGrubPaths = [
      path.join(extractDir, 'boot/grub2/grub.cfg'), // Non-EFI boot
      path.join(extractDir, 'EFI/BOOT/grub.cfg') // EFI boot
    ]

    let grubModified = false
    for (const grubPath of potentialGrubPaths) {
      if (fs.existsSync(grubPath)) {
        await this.modifyGrubConfigForKickstart(grubPath)
        grubModified = true // Assume modification attempt means success for this flag
      }
    }

    if (!grubModified) {
      this.debug.log('warning', 'Could not find any GRUB configuration files at expected paths to modify for Kickstart.')
      // Consider if this is a fatal error
    }

    // Extract the original Volume ID from the source ISO
    let volumeId = 'INFINIBAY-FEDORA' // Default fallback
    try {
      this.debug.log(`Extracting Volume ID using isoinfo from: ${this.isoPath}`)
      console.log(`Extracting Volume ID using isoinfo from: ${this.isoPath}`)
      const volIdOutput = await this.executeCommand(['isoinfo', '-d', '-i', this.isoPath as string]) as string

      // Match 'Volume id: VALUE' from isoinfo output
      const match = volIdOutput.match(/^Volume id:\s*(.*)$/m)
      console.log(`Volume ID output: ${volIdOutput}`)
      console.log(`Volume ID match: ${match}`)
      if (match && match[1]) {
        volumeId = match[1]
        this.debug.log(`Extracted original volume ID: ${volumeId}`)
      } else {
        console.log('warning', `Could not parse volume ID from isoinfo output string: ${volIdOutput}. Using default: ${volumeId}`)
        this.debug.log(`warning', 'Could not parse volume ID from isoinfo output string: ${volIdOutput}. Using default: ${volumeId}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.log('error', `Failed to extract volume ID from ${this.isoPath}: ${errorMsg}. Using default: ${volumeId}`)
      this.debug.log(`error', 'Failed to extract volume ID from ${this.isoPath}: ${errorMsg}. Using default: ${volumeId}`)
    }

    this.debug.log('Checking necessary files for ISO recreation...')
    // Paths derived from xorriso report for Fedora
    const biosBootImg = path.join(extractDir, 'images/eltorito.img')
    const efiBootPath = path.join(extractDir, 'EFI/BOOT') // Directory for EFI boot files

    if (!fs.existsSync(biosBootImg)) {
      this.debug.log('warning', `BIOS boot image not found at expected path: ${biosBootImg}. ISO creation might fail.`)
    }
    if (!fs.existsSync(efiBootPath)) {
      this.debug.log('warning', `EFI boot directory not found at expected path: ${efiBootPath}. ISO creation might fail.`)
    }

    this.debug.log('Constructing xorriso command...')

    // Arguments inspired by the xorriso report for Fedora
    // Paths like `/images/eltorito.img` are relative to extractDir when running mkisofs
    // Intervals referencing this.isoPath need to be correct
    const isoCreationCommandParts = [
      'xorriso',
      '-as', 'mkisofs',
      '-V', volumeId,
      // MBR and GPT specifics from report
      '--grub2-mbr', `--interval:local_fs:0s-15s:zero_mbrpt,zero_gpt:${this.isoPath}`,
      '--protective-msdos-label',
      '-partition_cyl_align', 'off',
      '-partition_offset', '16',
      '-partition_hd_cyl', '64',
      '-partition_sec_hd', '32',
      // Appended partition for EFI - critical to get right
      // Using the partition details directly from the report, referencing this.isoPath
      '-append_partition', '2', '28732ac11ff8d211ba4b00a0c93ec93b', `--interval:local_fs:1819116d-1844979d::${this.isoPath}`,
      '-appended_part_as_gpt',
      '-iso_mbr_part_type', 'a2a0d0ebe5b9334487c068b6b72699c7',
      // Boot options
      '--boot-catalog-hide', // From report
      '-b', 'images/eltorito.img', // BIOS boot image path (relative to extractDir)
      '-no-emul-boot',
      '-boot-load-size', '4',
      '-boot-info-table',
      '--grub2-boot-info',
      // EFI boot option
      '-eltorito-alt-boot',
      // Reference the EFI boot image via interval - use the one from report
      '-e', '--interval:appended_partition_2_start_454779s_size_25864d:all::', // Updated interval from Fedora report
      '-no-emul-boot',
      // boot-load-size must match the size of the EFI image referenced by -e
      // The Fedora report showed 25864 * 512 bytes for EFI image size. boot-load-size is in 512-byte sectors.
      '-boot-load-size', '25864', // Updated size from Fedora report
      // Output file
      '-o', newIsoPath,
      // Source directory
      extractDir
    ]

    // Execute the command
    try {
      this.debug.log(`Creating Kickstart ISO with command: ${isoCreationCommandParts.join(' ')}`)
      await this.executeCommand(isoCreationCommandParts)
      this.debug.log(`Successfully created Kickstart ISO at ${newIsoPath}`)

      // Clean up the extracted directory
      this.debug.log(`Removing temporary directory: ${extractDir}`)
      await this.executeCommand(['rm', '-rf', extractDir])
      this.debug.log(`Removed temporary directory ${extractDir}`)
    } catch (error) {
      this.debug.log('error', `Failed to create Kickstart ISO: ${error}`)
      // Attempt cleanup even on failure
      try {
        if (fs.existsSync(extractDir)) {
          this.debug.log(`Attempting cleanup of failed build directory: ${extractDir}`)
          await this.executeCommand(['rm', '-rf', extractDir])
        }
      } catch (cleanupError) {
        this.debug.log('error', `Failed to cleanup temporary directory ${extractDir} after error: ${cleanupError}`)
      }
      throw error // Re-throw the original error
    }
  }
  // ... other methods ...
}
