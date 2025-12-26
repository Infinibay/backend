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
 * Locale/Keyboard/Timezone Configuration:
 * - locale: Language and country code with optional encoding (e.g., 'en_US', 'es_ES', 'en_US.UTF-8')
 * - keyboard: X keyboard layout (e.g., 'us', 'uk', 'es', 'fr', 'de', 'br')
 * - timezone: IANA timezone (e.g., 'America/New_York', 'Europe/Madrid', 'UTC')
 *
 * For more information on Kickstart installations, refer to the Red Hat documentation:
 * https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/installation_guide/chap-kickstart-installations
 * https://docs.fedoraproject.org/en-US/fedora/latest/install-guide/appendixes/Kickstart_Syntax_Reference/
 */

export class UnattendedRedHatManager extends UnattendedManagerBase {
  private username: string
  private password: string
  private applications: Application[]
  private vmId: string = ''
  private locale: string
  private keyboard: string
  private timezone: string
  // protected debug: Debugger = new Debugger('unattended-redhat-manager');

  constructor (
    username: string,
    password: string,
    applications: Application[],
    vmId?: string,
    locale?: string,
    keyboard?: string,
    timezone?: string
  ) {
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

    // Store locale as-is, defaulting to en_US.UTF-8
    this.locale = locale || 'en_US.UTF-8'

    this.keyboard = keyboard || 'us'
    this.timezone = timezone || 'America/New_York'
    this.configFileName = 'ks.cfg'
    this.debug.log(`UnattendedRedHatManager initialized with locale=${this.locale}, keyboard=${this.keyboard}, timezone=${this.timezone}`)
  }

  async generateConfig (): Promise<string> {
    this.debug.log('Generating RedHat kickstart configuration')

    // Validate locale format (xx_XX with optional encoding suffix like .UTF-8)
    if (!/^[a-z]{2}_[A-Z]{2}(\.[A-Za-z0-9-]+)?$/.test(this.locale)) {
      this.debug.log('warn', `Invalid locale format: ${this.locale}, using default: en_US.UTF-8`)
      this.locale = 'en_US.UTF-8'
    }

    // Validate keyboard layout (2-3 lowercase characters)
    if (!/^[a-z]{2,3}$/.test(this.keyboard)) {
      this.debug.log('warn', `Invalid keyboard layout: ${this.keyboard}, using default: us`)
      this.keyboard = 'us'
    }

    // Validate timezone is not empty
    if (!this.timezone || this.timezone.trim() === '') {
      this.debug.log('warn', 'Empty timezone, using default: America/New_York')
      this.timezone = 'America/New_York'
    }

    this.debug.log(`Validated configuration: locale=${this.locale}, keyboard=${this.keyboard}, timezone=${this.timezone}`)

    const applicationsPostCommands = await this.generateApplicationsConfig()
    const infiniServicePostCommands = this.generateInfiniServiceConfig()
    const fedoraVersion = await this.extractFedoraVersionFromISO()
    this.debug.log(`Applications and InfiniService post commands generated (Fedora ${fedoraVersion})`)

    // Initialize Eta template engine
    // IMPORTANT: autoEscape must be false for shell scripts (we don't want HTML escaping)
    const eta = new Eta({
      views: path.join(process.env.INFINIBAY_BASE_DIR ?? path.join(__dirname, '..'), 'templates'),
      cache: true,
      autoEscape: false
    })

    try {
      const templatePath = path.join(__dirname, '../templates/redhat_kickstart.cfg.eta')
      const templateContent = fs.readFileSync(templatePath, 'utf8')

      // Render the template with our data
      const renderedConfig = eta.renderString(templateContent, {
        username: this.username,
        password: this.password,
        locale: this.locale,
        keyboard: this.keyboard,
        timezone: this.timezone,
        fedoraVersion,
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

    let postInstallScript = '%post --log=/root/ks-post-apps.log\n'
    postInstallScript += 'echo "Starting application installation..."\n\n'

    let hasCommands = false

    redHatApps.forEach(app => {
      // installCommand is an object with OS keys (windows, ubuntu, fedora), not an array
      const installCommands = app.installCommand as Record<string, string>
      const fedoraCommand = installCommands?.fedora || installCommands?.redhat

      if (fedoraCommand) {
        hasCommands = true
        postInstallScript += `echo "Installing ${app.name}..."\n`
        postInstallScript += `${fedoraCommand} || echo "Failed to install ${app.name}"\n\n`
      }
    })

    if (!hasCommands) {
      postInstallScript += 'echo "No compatible applications found or install commands missing."\n'
    }

    postInstallScript += 'echo "Application installation finished."\n'
    postInstallScript += '%end\n'

    return postInstallScript
  }

  /**
   * Generates post-install commands to install InfiniService on RedHat/Fedora.
   * Downloads the binary and installation script from the backend server.
   * Includes network waiting and retry logic similar to Ubuntu implementation.
   *
   * @returns Post-install script for InfiniService installation
   */
  private generateInfiniServiceConfig (): string {
    const backendHost = process.env.APP_HOST || 'localhost'
    const backendPort = process.env.PORT || '4000'
    const baseUrl = `http://${backendHost}:${backendPort}`

    // Build a robust post-install script with network waiting and retries
    const postInstallScript = `%post --log=/root/infiniservice-install.log
echo "=== Starting InfiniService Installation ==="
echo "Timestamp: $(date)"
echo "Backend URL: ${baseUrl}"
echo "VM ID: ${this.vmId}"

# Function to wait for network connectivity
wait_for_network() {
    local max_attempts=\${1:-30}
    local delay=\${2:-2}

    echo "Waiting for network connectivity..."
    for attempt in $(seq 1 $max_attempts); do
        echo "Network check attempt $attempt/$max_attempts"

        # Check if we have an IP address (non-loopback)
        if ip -4 addr show scope global | grep -q "inet "; then
            echo "IP address assigned"

            # Test DNS resolution
            if getent hosts ${backendHost} >/dev/null 2>&1 || ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
                echo "Network connectivity confirmed"
                return 0
            fi
        fi

        sleep $delay
    done

    echo "Network connectivity check failed after $max_attempts attempts"
    return 1
}

# Function to download with retries
download_with_retry() {
    local url="\$1"
    local output="\$2"
    local description="\$3"
    local max_retries=5
    local retry_delay=3

    for attempt in $(seq 1 $max_retries); do
        echo "Downloading $description (attempt $attempt/$max_retries)..."
        if curl -f -s --connect-timeout 10 --max-time 120 -o "\$output" "\$url"; then
            echo "[OK] Downloaded $description successfully"
            return 0
        fi
        echo "Download failed, retrying in \${retry_delay}s..."
        sleep \$retry_delay
    done

    echo "[FAIL] Failed to download $description after $max_retries attempts"
    return 1
}

# Wait for network
if ! wait_for_network 30 2; then
    echo "[FAIL] Network not available, skipping InfiniService installation"
    echo "InfiniService can be installed manually later"
    exit 0
fi

# Log network state
echo "=== Network State ==="
ip addr show
ip route show
cat /etc/resolv.conf
echo "===================="

# Create temp directory
mkdir -p /tmp/infiniservice
cd /tmp/infiniservice

# Download InfiniService binary with retry
if ! download_with_retry "${baseUrl}/infiniservice/linux/binary" "infiniservice" "InfiniService binary"; then
    echo "[FAIL] Could not download InfiniService binary"
    echo "InfiniService can be installed manually later"
    cd / && rm -rf /tmp/infiniservice
    exit 0
fi

# Download installation script with retry
if ! download_with_retry "${baseUrl}/infiniservice/linux/script" "install-linux.sh" "InfiniService installation script"; then
    echo "[FAIL] Could not download installation script"
    echo "InfiniService can be installed manually later"
    cd / && rm -rf /tmp/infiniservice
    exit 0
fi

# Make files executable
chmod +x infiniservice install-linux.sh

# Run installation script with VM ID
echo "Installing InfiniService with VM ID: ${this.vmId}"
if ./install-linux.sh normal "${this.vmId}"; then
    echo "[OK] InfiniService installed successfully"
else
    echo "[WARN] InfiniService installation script returned non-zero"
    echo "Check /var/log for more details"
fi

# Clean up temp files
cd /
rm -rf /tmp/infiniservice

echo "=== InfiniService Installation Completed ==="
%end
`

    return postInstallScript
  }

  /**
   * Extracts the Fedora version number from the ISO's Volume ID.
   * Volume ID format: "Fedora-E-dvd-x86_64-43" or "Fedora-S-dvd-x86_64-43"
   *
   * @returns The Fedora version number (e.g., "43", "41")
   */
  private async extractFedoraVersionFromISO (): Promise<string> {
    try {
      this.debug.log(`[ISO] Extracting Fedora version from: ${this.isoPath}`)
      const volIdOutput = await this.executeCommand(['isoinfo', '-d', '-i', this.isoPath as string]) as string

      // Match 'Volume id: ...' and extract the version number at the end
      // Examples: "Fedora-E-dvd-x86_64-43", "Fedora-S-dvd-x86_64-41", "Fedora-WS-Live-x86_64-40"
      const volIdMatch = volIdOutput.match(/Volume id:\s*(.*)/m)
      if (volIdMatch && volIdMatch[1]) {
        const volumeId = volIdMatch[1].trim()
        this.debug.log(`[ISO] Volume ID: ${volumeId}`)

        // Extract version number (last number in the Volume ID)
        const versionMatch = volumeId.match(/-(\d+)$/)
        if (versionMatch && versionMatch[1]) {
          const version = versionMatch[1]
          this.debug.log(`[ISO] Detected Fedora version: ${version}`)
          return version
        }
      }

      this.debug.log('warning', '[ISO] Could not detect Fedora version, assuming latest (99)')
      return '99'
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.debug.log('warning', `[ISO] Failed to extract Fedora version: ${errorMsg}. Assuming latest (99)`)
      return '99'
    }
  }

  /**
   * Modifies the GRUB configuration file to add Kickstart parameters.
   * Uses inst.ks=cdrom:/ks.cfg for reliable detection - explicit path to kickstart file.
   *
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
        // Remove any existing inst.ks= parameter (we'll add the correct one)
        let cleanedArgs = args.replace(/\s+inst\.ks=[^\s]*/g, '')
        // Remove any existing inst.stage2= parameter (we'll add the correct one)
        cleanedArgs = cleanedArgs.replace(/\s+inst\.stage2=[^\s]*/g, '')
        // Remove rd.live.check (integrity check - slows boot)
        cleanedArgs = cleanedArgs.replace(/\s+rd\.live\.check/g, '')
        // Clean up any double spaces
        cleanedArgs = cleanedArgs.replace(/\s+/g, ' ').trimEnd()

        // Build the modified line for netinstall/Everything ISO kickstart:
        // - inst.ks=cdrom:/ks.cfg tells Anaconda where to find the kickstart file
        // - inst.stage2=cdrom tells Anaconda to use the CDROM as installation source
        const modifiedLine = `${indent}${command}${cleanedArgs} inst.ks=cdrom:/ks.cfg inst.stage2=cdrom`
        this.debug.log(`[GRUB] Modifying line: ${match.trim()} -> ${modifiedLine.trim()}`)
        modified = true
        return modifiedLine
      })

      // Set GRUB timeout to 3 seconds for automatic boot
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

        // Log modified lines for debugging
        const modifiedLines = content.split('\n').filter(line =>
          line.includes('inst.ks=cdrom:/ks.cfg') || line.includes('inst.stage2=cdrom')
        )
        this.debug.log(`[GRUB] Modified ${modifiedLines.length} boot entries with kickstart parameters`)
        modifiedLines.forEach((line, idx) => {
          this.debug.log(`[GRUB] Entry ${idx + 1}: ${line.trim()}`)
        })
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
   * Modifies the isolinux configuration file to add Kickstart parameters for BIOS boot.
   * Uses inst.ks=cdrom:/ks.cfg for reliable detection - explicit path to kickstart file.
   *
   * @param isolinuxCfgPath - Path to the isolinux.cfg file.
   */
  private async modifyIsolinuxConfigForKickstart (isolinuxCfgPath: string): Promise<void> {
    this.debug.log(`[ISOLINUX] Attempting to modify isolinux config: ${isolinuxCfgPath}`)
    try {
      let content = await fs.promises.readFile(isolinuxCfgPath, 'utf-8')

      // Add ks parameter to append lines
      // Regex to find append lines, capturing indentation and the rest of the line
      const appendLineRegex = /^(\s*)(append)(\s+.*)$/gm
      let modified = false

      content = content.replace(appendLineRegex, (match, indent, command, args) => {
        // Remove any existing ks= or inst.ks= parameter (we'll add the correct one)
        let cleanedArgs = args.replace(/\s+ks=[^\s]*/g, '')
        cleanedArgs = cleanedArgs.replace(/\s+inst\.ks=[^\s]*/g, '')
        // Remove any existing inst.stage2= parameter (we'll add the correct one)
        cleanedArgs = cleanedArgs.replace(/\s+inst\.stage2=[^\s]*/g, '')
        // Remove rd.live.check (integrity check - slows boot)
        cleanedArgs = cleanedArgs.replace(/\s+rd\.live\.check/g, '')
        // Clean up any double spaces
        cleanedArgs = cleanedArgs.replace(/\s+/g, ' ').trimEnd()

        // Build the modified line for netinstall/Everything ISO kickstart:
        // - inst.ks=cdrom:/ks.cfg tells Anaconda where to find the kickstart file
        // - inst.stage2=cdrom tells Anaconda to use the CDROM as installation source
        const modifiedLine = `${indent}${command}${cleanedArgs} inst.ks=cdrom:/ks.cfg inst.stage2=cdrom`
        this.debug.log(`[ISOLINUX] Modifying line: ${match.trim()} -> ${modifiedLine.trim()}`)
        modified = true
        return modifiedLine
      })

      if (modified) {
        await fs.promises.writeFile(isolinuxCfgPath, content, 'utf-8')
        this.debug.log(`[ISOLINUX] Successfully modified isolinux config: ${isolinuxCfgPath}`)

        // Log modified lines for debugging
        const modifiedLines = content.split('\n').filter(line =>
          line.includes('inst.ks=cdrom:/ks.cfg') || line.includes('inst.stage2=cdrom')
        )
        this.debug.log(`[ISOLINUX] Modified ${modifiedLines.length} boot entries with kickstart parameters`)
        modifiedLines.forEach((line, idx) => {
          this.debug.log(`[ISOLINUX] Entry ${idx + 1}: ${line.trim()}`)
        })
      } else {
        this.debug.log('warning', `[ISOLINUX] No suitable append lines found or modified in ${isolinuxCfgPath}`)
      }
    } catch (error) {
      this.debug.log('error', `[ISOLINUX] Failed to modify isolinux config ${isolinuxCfgPath}: ${error}`)
    }
  }

  /**
   * Extracts xorriso parameters from the original ISO using report_el_torito.
   * This ensures the rebuilt ISO has correct boot parameters matching the original.
   *
   * @param {string} isoPath - Path to the original ISO
   * @returns {Promise<string[]>} - Array of xorriso command arguments
   */
  private async getXorrisoParamsFromISO (isoPath: string): Promise<string[]> {
    try {
      this.debug.log(`[XORRISO] Extracting boot parameters from: ${isoPath}`)

      // Run xorriso to get the mkisofs-compatible parameters
      const output = await this.executeCommand([
        'xorriso', '-indev', isoPath, '-report_el_torito', 'as_mkisofs'
      ])

      this.debug.log(`[XORRISO] Raw report_el_torito output:\n${output}`)

      // Parse the output to extract useful parameters
      // The output contains mkisofs-style arguments that we can use
      const lines = output.split('\n').filter(line => line.trim())

      // Build the command from the report
      const params: string[] = []

      for (const line of lines) {
        // Skip comment lines
        if (line.trim().startsWith('#')) continue

        // Each line is a mkisofs-compatible argument
        // Parse it respecting quoted strings (e.g., Volume ID with spaces)
        const trimmedLine = line.trim()
        if (trimmedLine) {
          // Use shell-style argument parsing to handle quotes properly
          const parts = this.parseShellArgs(trimmedLine)
          params.push(...parts)
        }
      }

      this.debug.log(`[XORRISO] Extracted ${params.length} parameters: ${params.join(' ')}`)
      return params
    } catch (error) {
      this.debug.log('error', `[XORRISO] Failed to extract parameters from ISO: ${error}`)
      // Return empty array, caller will use default parameters
      return []
    }
  }

  /**
   * Parses a shell-style argument string respecting single and double quotes.
   * For example: "-V 'Fedora 41 x86_64'" becomes ["-V", "Fedora 41 x86_64"]
   *
   * @param {string} line - The line to parse
   * @returns {string[]} - Array of parsed arguments
   */
  private parseShellArgs (line: string): string[] {
    const args: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        // Don't include the quote character in the argument
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        // Don't include the quote character in the argument
      } else if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
        // Space outside quotes - end current argument
        if (current.length > 0) {
          args.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }

    // Don't forget the last argument
    if (current.length > 0) {
      args.push(current)
    }

    return args
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

    this.debug.log('[ISO] Creating Kickstart configuration file...')

    // Generate the configuration
    const config = await this.generateConfig()

    // Write ks.cfg to the root of the extracted directory
    const kickstartPath = path.join(extractDir, 'ks.cfg')
    await fs.promises.writeFile(kickstartPath, config)
    this.debug.log(`[KICKSTART] Configuration written to ${kickstartPath}`)

    // Verify kickstart file was written
    const kickstartStats = await fs.promises.stat(kickstartPath)
    this.debug.log(`[KICKSTART] File size: ${kickstartStats.size} bytes`)

    // Log first few lines for debugging
    const kickstartPreview = config.split('\n').slice(0, 10).join('\n')
    this.debug.log(`[KICKSTART] Preview:\n${kickstartPreview}`)

    // Find and modify GRUB configurations
    // Common paths for GRUB config in Fedora/RHEL ISOs
    const potentialGrubPaths = [
      path.join(extractDir, 'boot/grub2/grub.cfg'), // Non-EFI boot
      path.join(extractDir, 'EFI/BOOT/grub.cfg') // EFI boot
    ]

    let grubModified = false
    for (const grubPath of potentialGrubPaths) {
      if (fs.existsSync(grubPath)) {
        this.debug.log(`[GRUB] Modifying GRUB configuration at ${grubPath}`)
        await this.modifyGrubConfigForKickstart(grubPath)
        grubModified = true
      }
    }

    if (!grubModified) {
      this.debug.log('warning', '[GRUB] Could not find any GRUB configuration files at expected paths to modify for Kickstart.')
    }

    // Find and modify isolinux configuration for BIOS boot
    const potentialIsolinuxPaths = [
      path.join(extractDir, 'isolinux/isolinux.cfg'),
      path.join(extractDir, 'syslinux/isolinux.cfg')
    ]

    let isolinuxModified = false
    for (const isolinuxPath of potentialIsolinuxPaths) {
      if (fs.existsSync(isolinuxPath)) {
        this.debug.log(`[ISOLINUX] Modifying isolinux configuration at ${isolinuxPath}`)
        await this.modifyIsolinuxConfigForKickstart(isolinuxPath)
        isolinuxModified = true
      }
    }

    if (!isolinuxModified) {
      this.debug.log('warning', '[ISOLINUX] Could not find isolinux.cfg (BIOS boot may not work)')
    }

    // Extract the original Volume ID from the source ISO (used for xorriso)
    let volumeId = 'INFINIBAY-FEDORA' // Default fallback
    try {
      this.debug.log(`[ISO] Extracting Volume ID using isoinfo from: ${this.isoPath}`)
      const volIdOutput = await this.executeCommand(['isoinfo', '-d', '-i', this.isoPath as string]) as string

      // Match 'Volume id: VALUE' from isoinfo output
      const match = volIdOutput.match(/^Volume id:\s*(.*)$/m)
      if (match && match[1]) {
        volumeId = match[1].trim()
        this.debug.log(`[ISO] Extracted original volume ID: ${volumeId}`)
      } else {
        this.debug.log('warning', `[ISO] Could not parse volume ID from isoinfo output. Using default: ${volumeId}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.debug.log('warning', `[ISO] Failed to extract volume ID from ${this.isoPath}: ${errorMsg}. Using default: ${volumeId}`)
    }

    this.debug.log('[ISO] Checking necessary files for ISO recreation...')
    // Paths derived from xorriso report for Fedora
    const biosBootImg = path.join(extractDir, 'images/eltorito.img')
    const efiBootPath = path.join(extractDir, 'EFI/BOOT')

    if (!fs.existsSync(biosBootImg)) {
      this.debug.log('warning', `[ISO] BIOS boot image not found at: ${biosBootImg}`)
    }
    if (!fs.existsSync(efiBootPath)) {
      this.debug.log('warning', `[ISO] EFI boot directory not found at: ${efiBootPath}`)
    }

    // Get dynamic xorriso parameters from the original ISO
    const dynamicParams = await this.getXorrisoParamsFromISO(this.isoPath as string)

    let isoCreationCommandParts: string[]

    if (dynamicParams.length > 0) {
      // Use dynamic parameters from the original ISO
      this.debug.log('[XORRISO] Using dynamic parameters extracted from original ISO')

      isoCreationCommandParts = [
        'xorriso',
        '-as', 'mkisofs',
        ...dynamicParams.map(param => {
          // Keep references to original ISO for interval reads
          if (param.includes(this.isoPath as string)) {
            return param
          }
          return param
        }),
        '-o', newIsoPath,
        extractDir
      ]
    } else {
      // Fallback to default parameters if extraction failed
      this.debug.log('[XORRISO] Using fallback parameters (extraction failed)')

      isoCreationCommandParts = [
        'xorriso',
        '-as', 'mkisofs',
        '-V', volumeId,
        '--grub2-mbr', `--interval:local_fs:0s-15s:zero_mbrpt,zero_gpt:${this.isoPath}`,
        '--protective-msdos-label',
        '-partition_cyl_align', 'off',
        '-partition_offset', '16',
        '-partition_hd_cyl', '64',
        '-partition_sec_hd', '32',
        '-append_partition', '2', '28732ac11ff8d211ba4b00a0c93ec93b', `--interval:local_fs:1819116d-1844979d::${this.isoPath}`,
        '-appended_part_as_gpt',
        '-iso_mbr_part_type', 'a2a0d0ebe5b9334487c068b6b72699c7',
        '--boot-catalog-hide',
        '-b', 'images/eltorito.img',
        '-no-emul-boot',
        '-boot-load-size', '4',
        '-boot-info-table',
        '--grub2-boot-info',
        '-eltorito-alt-boot',
        '-e', '--interval:appended_partition_2_start_454779s_size_25864d:all::',
        '-no-emul-boot',
        '-boot-load-size', '25864',
        '-o', newIsoPath,
        extractDir
      ]
    }

    // Execute the command
    try {
      this.debug.log(`[XORRISO] Creating Kickstart ISO with command:\n${isoCreationCommandParts.join(' ')}`)
      await this.executeCommand(isoCreationCommandParts)
      this.debug.log(`[ISO] Successfully created Kickstart ISO at ${newIsoPath}`)

      // Diagnose the generated ISO for debugging
      await this.diagnoseGeneratedISO(newIsoPath)

      // Clean up the extracted directory
      this.debug.log(`[ISO] Removing temporary directory: ${extractDir}`)
      await this.executeCommand(['rm', '-rf', extractDir])
      this.debug.log(`[ISO] Removed temporary directory ${extractDir}`)
    } catch (error) {
      this.debug.log('error', `[ISO] Failed to create Kickstart ISO: ${error}`)
      // Attempt cleanup even on failure
      try {
        if (fs.existsSync(extractDir)) {
          this.debug.log(`[ISO] Attempting cleanup of failed build directory: ${extractDir}`)
          await this.executeCommand(['rm', '-rf', extractDir])
        }
      } catch (cleanupError) {
        this.debug.log('error', `[ISO] Failed to cleanup temporary directory ${extractDir} after error: ${cleanupError}`)
      }
      throw error
    }
  }

  /**
   * Diagnoses the generated ISO for debugging purposes.
   * Verifies the ISO structure and boot configuration.
   *
   * @param {string} isoPath - Path to the generated ISO
   */
  private async diagnoseGeneratedISO (isoPath: string): Promise<void> {
    try {
      this.debug.log(`[DIAGNOSE] Analyzing generated ISO: ${isoPath}`)

      // Check ISO exists and get size
      const stats = await fs.promises.stat(isoPath)
      this.debug.log(`[DIAGNOSE] ISO size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`)

      // List root files to verify ks.cfg is present
      try {
        const listOutput = await this.executeCommand(['isoinfo', '-l', '-i', isoPath])
        const hasKickstart = listOutput.includes('ks.cfg') || listOutput.includes('KS.CFG')
        this.debug.log(`[DIAGNOSE] ks.cfg present in ISO root: ${hasKickstart}`)

        if (!hasKickstart) {
          this.debug.log('warning', '[DIAGNOSE] WARNING: ks.cfg not found in ISO root! Kickstart may fail.')
        }
      } catch (listError) {
        this.debug.log('warning', `[DIAGNOSE] Could not list ISO contents: ${listError}`)
      }

      // Get ISO info for Volume ID and boot flags
      try {
        const infoOutput = await this.executeCommand(['isoinfo', '-d', '-i', isoPath])
        this.debug.log(`[DIAGNOSE] ISO info:\n${infoOutput}`)

        // Extract Volume ID for verification
        const volIdMatch = infoOutput.match(/^Volume id:\s*(.*)$/m)
        if (volIdMatch && volIdMatch[1]) {
          this.debug.log(`[DIAGNOSE] Generated ISO Volume ID: ${volIdMatch[1].trim()}`)
        }

        // Check for bootable flag
        const isBootable = infoOutput.includes('Bootable') || infoOutput.includes('El Torito')
        this.debug.log(`[DIAGNOSE] ISO appears bootable: ${isBootable}`)
      } catch (infoError) {
        this.debug.log('warning', `[DIAGNOSE] Could not get ISO info: ${infoError}`)
      }
    } catch (error) {
      this.debug.log('warning', `[DIAGNOSE] ISO diagnosis failed: ${error}`)
      // Don't throw - diagnosis is optional and shouldn't block ISO creation
    }
  }

  /**
   * Validates the Kickstart configuration.
   * Checks for required directives and basic syntax.
   * @param {string} configContent - The Kickstart configuration content
   * @returns {Promise<{ valid: boolean; errors: string[] }>} Validation result
   */
  protected async validateConfig (configContent: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    try {
      const lines = configContent.split('\n')

      // Check for required directives
      const requiredDirectives = [
        { pattern: /^lang\s+/, name: 'lang (language)' },
        { pattern: /^keyboard\s+/, name: 'keyboard' },
        { pattern: /^timezone\s+/, name: 'timezone' },
        { pattern: /^(rootpw|user)\s+/, name: 'rootpw or user' },
        { pattern: /^(autopart|part|clearpart)/, name: 'partitioning (autopart/part/clearpart)' }
      ]

      for (const directive of requiredDirectives) {
        const found = lines.some(line => directive.pattern.test(line.trim()))
        if (!found) {
          errors.push(`Missing required Kickstart directive: ${directive.name}`)
        }
      }

      // Check for %packages section
      const hasPackages = lines.some(line => line.trim() === '%packages')
      if (!hasPackages) {
        errors.push('Missing required %packages section')
      }

      // Check for matching %end tags
      const sectionStarts = lines.filter(line => /^%(packages|pre|post|addon)/.test(line.trim())).length
      const sectionEnds = lines.filter(line => line.trim() === '%end').length
      if (sectionStarts !== sectionEnds) {
        errors.push('Mismatched section start/end tags (check %end directives)')
      }

      if (errors.length > 0) {
        return { valid: false, errors }
      }

      this.debug.log('Kickstart configuration validation passed')
      return { valid: true, errors: [] }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push(`Validation error: ${errorMsg}`)
      return { valid: false, errors }
    }
  }
}
