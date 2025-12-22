import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as unixcrypt from 'unixcrypt'
import { Application, PrismaClient } from '@prisma/client'
import { promises as fsPromises } from 'fs'
import { Eta } from 'eta'

import { UnattendedManagerBase } from './unattendedManagerBase'

/**
 * This class is used to generate an unattended Ubuntu installation configuration.
 */
export class UnattendedUbuntuManager extends UnattendedManagerBase {
  private username: string
  private password: string
  private applications: Application[]
  private scripts: any[] = []
  private vmId: string = ''

  constructor (username: string, password: string, applications: Application[], vmId?: string, scripts: any[] = []) {
    super()
    this.debug.log('Initializing UnattendedUbuntuManager')
    if (!username || !password) {
      this.debug.log('error', 'Username and password are required')
      throw new Error('Username and password are required')
    }
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), 'ubuntu.iso')
    this.username = username
    this.password = password
    this.applications = applications
    this.vmId = vmId || ''
    this.scripts = scripts
    this.configFileName = 'user-data'
    this.debug.log('UnattendedUbuntuManager initialized')
  }

  /**
   * Generates a configuration file in YAML format for Ubuntu autoinstall.
   *
   * @returns {Promise<string>} A promise that resolves to the generated configuration file.
   */
  async generateConfig (): Promise<string> {
    // Generate a random hostname, like ubuntu-xhsdDx
    const hostname = 'ubuntu-' + Math.random().toString(36).substring(7)

    // Create the autoinstall configuration
    const config = {
      autoinstall: {
        version: 1,

        'refresh-installer': {
          update: true,
          channel: 'latest/stable'
        },
        // Use default apt configuration - let Ubuntu auto-detect mirrors
        // Note: Do NOT override apt sources as it breaks package installation
        apt: {
          geoip: true // Let Ubuntu select the best mirror automatically
        },
        codecs: {
          install: true
        },
        drivers: {
          install: true
        },
        oem: {
          install: 'auto'
        },
        // Lets reboot when finish the instalation
        shutdown: 'reboot',
        identity: {
          hostname,
          realname: this.username,
          username: this.username,
          password: unixcrypt.encrypt(this.password) // Properly encrypt password for cloud-init
        },

        keyboard: {
          layout: 'us'
        },

        locale: 'en_US',

        // Network configuration removed - Ubuntu autoinstall uses DHCP by default
        // for interfaces matching 'eth*' or 'en*'. Manual network configuration
        // was causing DHCP issues. See: https://canonical-subiquity.readthedocs-hosted.com/

        // Early commands to force DHCP before installation begins
        // This ensures network connectivity before subiquity tries to configure the network
        'early-commands': [
          // Log network state before any configuration
          'echo "=== Initial Network State ===" | tee -a /var/log/installer/network-debug.log',
          'ip addr show | tee -a /var/log/installer/network-debug.log',
          'ip route show | tee -a /var/log/installer/network-debug.log',

          // Restart systemd-networkd to ensure clean state
          'systemctl restart systemd-networkd',
          'sleep 2',

          // Force DHCP on all ethernet interfaces
          'for iface in $(ip -o link show | grep -E "en[op][0-9]s[0-9]" | awk -F: \'{print $2}\' | tr -d \' \'); do echo "Configuring $iface for DHCP..." | tee -a /var/log/installer/network-debug.log; ip link set $iface up; dhclient -v $iface 2>&1 | tee -a /var/log/installer/network-debug.log; done',

          // Wait for IP assignment with retries (only check for global scope, non-loopback addresses)
          'for attempt in $(seq 1 10); do echo "Checking for IP (attempt $attempt/10)..." | tee -a /var/log/installer/network-debug.log; if ip -4 addr show scope global | grep -q "inet "; then echo "IP assigned successfully" | tee -a /var/log/installer/network-debug.log; ip -4 addr show scope global | tee -a /var/log/installer/network-debug.log; break; fi; sleep 2; done',

          // Configure DNS manually as fallback
          'echo "nameserver 8.8.8.8" > /etc/resolv.conf',
          'echo "nameserver 1.1.1.1" >> /etc/resolv.conf',
          'echo "nameserver 8.8.4.4" >> /etc/resolv.conf',

          // Test connectivity
          'echo "=== Testing Connectivity ===" | tee -a /var/log/installer/network-debug.log',
          'ping -c 2 8.8.8.8 2>&1 | tee -a /var/log/installer/network-debug.log || echo "Ping failed" | tee -a /var/log/installer/network-debug.log',
          'getent hosts ubuntu.com 2>&1 | tee -a /var/log/installer/network-debug.log || echo "DNS resolution failed" | tee -a /var/log/installer/network-debug.log',

          // Log final state
          'echo "=== Final Network State ===" | tee -a /var/log/installer/network-debug.log',
          'ip addr show | tee -a /var/log/installer/network-debug.log',
          'cat /etc/resolv.conf | tee -a /var/log/installer/network-debug.log'
        ],

        timezone: 'UTC', // TODO: Autodetect timezone or get it form system configuration.

        // Source specifies which installation variant to use from the Desktop ISO
        // This is required for Desktop ISO - do NOT use packages: [ubuntu-desktop]
        source: {
          id: 'ubuntu-desktop', // Full desktop installation
          search_drivers: true
        },

        // Note: Additional packages (curl, wget, qemu-guest-agent) are installed
        // in late-commands after apt is configured, since Desktop ISOs don't
        // include these packages and the packages: section may run before
        // apt has full repository access.

        // Use the entire disk with a single partition
        // lets try the default (full disk 1 partition). This do not work
        // if the autoinstall has more than one disk
        // storage: {
        //   layout: ...
        // },

        // Add late-commands for post-installation tasks
        'late-commands': this.generateLateCommands()
      }
    }

    // Append '#cloud-config' to the beginning of the config
    const configStr = '#cloud-config\n' + yaml.dump(config)

    return configStr
  }

  /**
   * Generates late commands for the autoinstall configuration.
   * These commands run during installation but after the system is installed.
   *
   * @returns {string[]} Array of late commands
   */
  private generateLateCommands (): string[] {
    const commands = [
      // Network configuration is now handled by DHCP - no need to manually set DNS
      // Ubuntu's systemd-resolved will use DNS servers from DHCP

      // Create network validation helper script
      `cat > /target/usr/local/bin/wait-for-network.sh << 'NETWORK_HELPER_EOF'
#!/bin/bash
# Network validation helper with exponential backoff
# Usage: wait-for-network.sh [max_attempts] [initial_delay]

MAX_ATTEMPTS=\${1:-15}
INITIAL_DELAY=\${2:-1}
CURRENT_DELAY=\$INITIAL_DELAY

log_network_config() {
    echo "=== Network Configuration Debug Info ==="
    echo "Timestamp: \$(date)"
    echo ""
    echo "--- IP Addresses ---"
    ip addr show || true
    echo ""
    echo "--- Routing Table ---"
    ip route show || true
    echo ""
    echo "--- DNS Configuration ---"
    cat /etc/resolv.conf || true
    echo ""
    echo "--- Active Network Interfaces ---"
    ip link show | grep -E "^[0-9]+:" || true
    echo "========================================"
}

test_connectivity() {
    local test_name=\$1
    local test_command=\$2

    if eval "\$test_command" >/dev/null 2>&1; then
        echo "[OK] \$test_name: SUCCESS"
        return 0
    else
        echo "[FAIL] \$test_name: FAILED"
        return 1
    fi
}

echo "Starting network connectivity validation..."
log_network_config

for attempt in \$(seq 1 \$MAX_ATTEMPTS); do
    echo ""
    echo "Attempt \$attempt/\$MAX_ATTEMPTS (delay: \${CURRENT_DELAY}s)"

    # Test multiple connectivity methods
    PING_PASSED=0
    DNS_PASSED=0

    # Test 1: Ping Google DNS
    test_connectivity "Ping 8.8.8.8" "ping -c 1 -W 2 8.8.8.8" && PING_PASSED=1

    # Test 2: Ping Cloudflare DNS
    if [ \$PING_PASSED -eq 0 ]; then
        test_connectivity "Ping 1.1.1.1" "ping -c 1 -W 2 1.1.1.1" && PING_PASSED=1
    fi

    # Test 3: DNS Resolution (REQUIRED for success)
    # Use getent hosts instead of nslookup as it's available by default (nslookup requires dnsutils)
    test_connectivity "DNS Resolution" "getent hosts archive.ubuntu.com" && DNS_PASSED=1

    # Success requires: Ping must pass AND DNS must pass
    if [ \$PING_PASSED -eq 1 ] && [ \$DNS_PASSED -eq 1 ]; then
        echo ""
        echo "[OK] Network connectivity validated (Ping + DNS passed)"
        log_network_config
        exit 0
    fi

    if [ \$PING_PASSED -eq 0 ]; then
        echo "Network unreachable - no IP connectivity"
    fi
    if [ \$DNS_PASSED -eq 0 ]; then
        echo "DNS resolution FAILED - this is required for apt/downloads to work"
    fi
    echo "Tests passed: Ping=\$PING_PASSED, DNS=\$DNS_PASSED, retrying..."

    # Exponential backoff with max delay of 30s
    sleep \$CURRENT_DELAY
    CURRENT_DELAY=\$((CURRENT_DELAY * 2))
    [ \$CURRENT_DELAY -gt 30 ] && CURRENT_DELAY=30
done

echo ""
echo "[FAIL] Network connectivity validation FAILED after \$MAX_ATTEMPTS attempts"
log_network_config
exit 1
NETWORK_HELPER_EOF`,

      'chmod +x /target/usr/local/bin/wait-for-network.sh',

      // Validate network connectivity before attempting any network operations
      'echo "=== Validating network connectivity before package installation ==="',
      'curtin in-target -- /usr/local/bin/wait-for-network.sh 15 1',

      // Ensure network is still working after early-commands
      'echo "=== Re-validating network before package installation ==="',
      'curtin in-target -- systemctl status systemd-networkd || curtin in-target -- systemctl restart systemd-networkd',
      'sleep 3',

      // Install required packages (must be in late-commands after apt is configured)
      // Desktop ISOs don't include curl/wget, and packages: section may run before apt has repository access
      'curtin in-target -- apt-get update',
      'curtin in-target -- apt-get install -y curl wget qemu-guest-agent',
      'curtin in-target -- systemctl enable qemu-guest-agent',

      // Create directory for per-instance scripts
      'mkdir -p /target/var/lib/cloud/scripts/per-instance',

      // Create InfiniService installation script
      ...this.generateInfiniServiceInstallCommands(),

      // Create first-boot script execution commands
      ...this.generateFirstBootScriptCommands(),

      // Create post-installation script
      `cat > /target/var/lib/cloud/scripts/per-instance/post_install.py << 'EOF'
${this.generateMasterInstallScript()}
EOF`,

      // Make the script executable
      'chmod +x /target/var/lib/cloud/scripts/per-instance/post_install.py',

      // Create individual application installation scripts
      ...this.generateAppScriptCommands(),

      // Run the post-installation script
      'curtin in-target -- /var/lib/cloud/scripts/per-instance/post_install.py',

      // Log final network status
      'echo "=== Final Network Status ==="',
      'curtin in-target -- /usr/local/bin/wait-for-network.sh 5 1 || echo "Warning: Network validation failed at end of installation"',
      'echo "=== Installation Complete ==="'
    ]

    return commands
  }

  /**
   * Generates commands to install InfiniService on Ubuntu.
   * Downloads the binary and installation script from the backend server.
   *
   * @returns Array of late commands for InfiniService installation
   */
  private generateInfiniServiceInstallCommands (): string[] {
    const backendHost = process.env.APP_HOST || 'localhost'
    const backendPort = process.env.PORT || '4000'
    const baseUrl = `http://${backendHost}:${backendPort}`

    const commands = [
      // Create InfiniService installation script
      `cat > /target/var/lib/cloud/scripts/per-instance/install_infiniservice.sh << 'EOF'
#!/bin/bash
set -e

LOG_FILE="/var/log/infiniservice_install.log"
MAX_DOWNLOAD_RETRIES=5
RETRY_DELAY=3

log_message() {
    echo "\$(date '+%Y-%m-%d %H:%M:%S') - \$1" | tee -a \$LOG_FILE
}

download_with_retry() {
    local url=\$1
    local output=\$2
    local description=\$3
    local current_delay=\$RETRY_DELAY

    for attempt in \$(seq 1 \$MAX_DOWNLOAD_RETRIES); do
        log_message "Downloading \$description (attempt \$attempt/\$MAX_DOWNLOAD_RETRIES)..."

        if curl -f --connect-timeout 10 --max-time 60 -o "\$output" "\$url" 2>&1 | tee -a \$LOG_FILE; then
            log_message "[OK] \$description downloaded successfully"
            return 0
        fi

        log_message "[FAIL] Download failed, retrying in \${current_delay}s..."
        sleep \$current_delay
        current_delay=\$((current_delay * 2))
        [ \$current_delay -gt 30 ] && current_delay=30
    done

    log_message "[FAIL] Failed to download \$description after \$MAX_DOWNLOAD_RETRIES attempts"
    return 1
}

log_message "=== Starting InfiniService Installation ==="

# Wait for network connectivity
log_message "Validating network connectivity..."
if ! /usr/local/bin/wait-for-network.sh 15 2 2>&1 | tee -a \$LOG_FILE; then
    log_message "[FAIL] Network validation failed, cannot proceed"
    exit 1
fi

# Create temp directory
mkdir -p /tmp/infiniservice
cd /tmp/infiniservice

# Download InfiniService binary with retry
if ! download_with_retry "${baseUrl}/infiniservice/linux/binary" "infiniservice" "InfiniService binary"; then
    exit 1
fi

# Download installation script with retry
if ! download_with_retry "${baseUrl}/infiniservice/linux/script" "install-linux.sh" "InfiniService installation script"; then
    exit 1
fi

# Make files executable
chmod +x infiniservice install-linux.sh

# Run installation script with VM ID
log_message "Installing InfiniService with VM ID: ${this.vmId}"
if ./install-linux.sh normal "${this.vmId}" 2>&1 | tee -a \$LOG_FILE; then
    log_message "[OK] InfiniService installed successfully"
else
    log_message "[FAIL] InfiniService installation failed"
    exit 1
fi

# Clean up temp files
cd /
rm -rf /tmp/infiniservice

log_message "=== InfiniService Installation Completed ==="
EOF`,

      // Make the InfiniService installation script executable
      'chmod +x /target/var/lib/cloud/scripts/per-instance/install_infiniservice.sh',

      // Run the InfiniService installation script
      'curtin in-target -- /var/lib/cloud/scripts/per-instance/install_infiniservice.sh'
    ]

    return commands
  }

  /**
   * Generates commands for first-boot script execution.
   * Creates wrapper scripts that download, execute, and report completion for each script.
   *
   * @returns Array of late commands for script execution
   */
  private generateFirstBootScriptCommands (): string[] {
    const backendHost = process.env.APP_HOST || 'localhost'
    const backendPort = process.env.PORT || '4000'
    const baseUrl = `http://${backendHost}:${backendPort}`

    const commands: string[] = []

    this.scripts.forEach(scriptData => {
      const { script, inputValues, executionId } = scriptData
      const scriptNameSafe = this.sanitizeScriptName(script.name)
      const scriptPath = `/tmp/${scriptNameSafe}_${executionId}.sh`
      const logFile = `/var/log/${scriptNameSafe}_${executionId}.log`

      // Create script execution wrapper
      commands.push(`cat > /target${scriptPath} << 'SCRIPT_EOF'
#!/bin/bash
set -e

LOG_FILE="${logFile}"
echo "Starting script: ${script.name}" | tee -a \\$LOG_FILE

# Wait for network before downloading script
if ! /usr/local/bin/wait-for-network.sh 10 2 2>&1 | tee -a \\$LOG_FILE; then
    echo "Network validation failed before script download" | tee -a \\$LOG_FILE
    /usr/local/bin/infiniservice report-script-completion --execution-id ${executionId} --exit-code 1 --log-file \\$LOG_FILE
    exit 1
fi

# Download script content with interpolated inputs
if curl -f -o /tmp/${scriptNameSafe}.sh "${baseUrl}/scripts/${script.id}/content?vmId=${this.vmId}&executionId=${executionId}&format=bash" 2>&1 | tee -a \\$LOG_FILE; then
    echo "Script downloaded successfully" | tee -a \\$LOG_FILE
    chmod +x /tmp/${scriptNameSafe}.sh

    # Execute script
    if /tmp/${scriptNameSafe}.sh 2>&1 | tee -a \\$LOG_FILE; then
        echo "Script executed successfully" | tee -a \\$LOG_FILE
        EXIT_CODE=0
    else
        EXIT_CODE=\\$?
        echo "Script execution failed with exit code \\$EXIT_CODE" | tee -a \\$LOG_FILE
    fi

    # Report completion to backend via infiniservice
    /usr/local/bin/infiniservice report-script-completion --execution-id ${executionId} --exit-code \\$EXIT_CODE --log-file \\$LOG_FILE
else
    echo "Failed to download script" | tee -a \\$LOG_FILE
    /usr/local/bin/infiniservice report-script-completion --execution-id ${executionId} --exit-code 1 --log-file \\$LOG_FILE
fi
SCRIPT_EOF`)

      // Make script executable
      commands.push(`chmod +x /target${scriptPath}`)

      // Execute script via curtin in-target
      commands.push(`curtin in-target -- ${scriptPath}`)
    })

    return commands
  }

  /**
   * Generates commands to create individual application installation scripts.
   *
   * @returns {string[]} Array of commands to create application scripts
   */
  private generateAppScriptCommands (): string[] {
    return this.applications.map((app, index) => {
      const scriptContent = this.generateAppInstallScript(app)
      if (!scriptContent) return ''

      const scriptName = `app_install_${app.name.replace(/[^a-zA-Z0-9]+/g, '_')}.sh`
      return `cat > /target/var/lib/cloud/scripts/per-instance/${scriptName} << 'EOF'
${scriptContent}
EOF
chmod +x /target/var/lib/cloud/scripts/per-instance/${scriptName}`
    }).filter(cmd => cmd !== '')
  }

  /**
   * Generates a master installation script that runs all application installation scripts.
   *
   * @returns {string} The master installation script
   */
  private generateMasterInstallScript (): string {
    // Get application scripts that have valid installation commands
    const appScripts = this.applications
      .filter(app => this.getUbuntuInstallCommand(app))
      .map(app => ({
        name: app.name,
        scriptName: app.name.replace(/\s+/g, '_')
      }))

    // Initialize Eta template engine
    const eta = new Eta({
      views: path.join(process.env.INFINIBAY_BASE_DIR ?? path.join(__dirname, '..'), 'templates'),
      cache: true
    })

    // Render the template with our data
    try {
      const templatePath = path.join(__dirname, '../templates/post_install.py.eta')
      const templateContent = fs.readFileSync(templatePath, 'utf8')

      // Render the template with our data
      return eta.renderString(templateContent, { appScripts })
    } catch (error) {
      this.debug.log('error', `Failed to render post_install template: ${error}`)
      throw error
    }
  }

  /**
   * Generates an installation script for a specific application.
   *
   * @param {Application} app - The application to generate a script for
   * @returns {string} The installation script or empty string if no command is available
   */
  private generateAppInstallScript (app: Application): string {
    const installCommand = this.getUbuntuInstallCommand(app)
    if (!installCommand) return ''

    const parsedCommand = this.parseInstallCommand(installCommand, app.parameters)

    return `#!/bin/bash
# Installation script for ${app.name}
echo "Starting installation of ${app.name}..."
LOG_FILE="/var/log/app_install_${app.name.replace(/\s+/g, '_')}.log"

{
  ${parsedCommand}
  if [ $? -eq 0 ]; then
    echo "${app.name} installation completed successfully"
  else
    echo "${app.name} installation failed with exit code $?"
  fi
} 2>&1 | tee -a $LOG_FILE
`
  }

  /**
   * Parses an installation command, replacing placeholders with actual parameters.
   *
   * @param {string} command - The command template
   * @param {any} parameters - Parameters to substitute in the command
   * @returns {string} The parsed command
   */
  private parseInstallCommand (command: string, parameters: any = null): string {
    // Replace placeholders in the command with actual parameters
    let parsedCommand = command
    if (parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        const placeholder = `{{${key}}}`
        parsedCommand = parsedCommand.replace(new RegExp(placeholder, 'g'), value as string)
      }
    }
    return parsedCommand
  }

  /**
   * Gets the Ubuntu installation command for an application.
   *
   * @param {Application} app - The application
   * @returns {string | undefined} The installation command or undefined if not available
   */
  private getUbuntuInstallCommand (app: Application): string | undefined {
    if (!app.installCommand || typeof app.installCommand !== 'object') {
      return undefined
    }

    const installCommands = app.installCommand as Record<string, string>
    return installCommands.ubuntu
  }

  /**
   * Modifies the GRUB configuration to add autoinstall options.
   * Sets timeout and default entry for automatic boot without user intervention.
   *
   * @param {string} grubCfgPath - Path to the GRUB configuration file
   * @param {string} vmlinuzPath - Path to the kernel (relative to ISO root)
   * @param {string} initrdPath - Path to the initrd (relative to ISO root)
   * @returns {Promise<void>}
   */
  private async modifyGrubConfig (
    grubCfgPath: string,
    vmlinuzPath: string = '/casper/vmlinuz',
    initrdPath: string = '/casper/initrd'
  ): Promise<void> {
    try {
      let content = await fsPromises.readFile(grubCfgPath, 'utf8')
      this.debug.log(`[GRUB] Original config (first 500 chars):\n${content.substring(0, 500)}...`)

      // Set timeout for automatic boot (like Fedora does)
      const timeoutRegex = /^\s*set\s+timeout\s*=\s*\d+\s*$/gm
      if (timeoutRegex.test(content)) {
        content = content.replace(timeoutRegex, (match) => {
          const indent = match.match(/^\s*/)?.[0] || ''
          this.debug.log(`[GRUB] Changing timeout: ${match.trim()} -> ${indent}set timeout=3`)
          return `${indent}set timeout=3`
        })
      } else {
        // Add timeout setting if not found - insert after first few lines
        const lines = content.split('\n')
        let insertIndex = 0

        // Find a good insertion point - after initial comments and set commands
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          if (lines[i].trim().startsWith('set ') || lines[i].trim().startsWith('#')) {
            insertIndex = i + 1
          }
        }

        lines.splice(insertIndex, 0, 'set timeout=3')
        content = lines.join('\n')
        this.debug.log(`[GRUB] Added timeout setting at line ${insertIndex + 1}: set timeout=3`)
      }

      // Create a new autoinstall entry with set default=0 to auto-select it
      // The entry is prepended so it becomes the first (index 0) menu entry
      const newEntry = `
# Added by Infinibay for autoinstall
set default=0
menuentry "Automatic Install Ubuntu" {
  set gfxpayload=keep
  linux ${vmlinuzPath} autoinstall ds=nocloud\\;s=/cdrom/nocloud/ ---
  initrd ${initrdPath}
}

`

      const newContent = newEntry + content
      await fsPromises.writeFile(grubCfgPath, newContent, 'utf8')
      this.debug.log(`[GRUB] Modified config (first 500 chars):\n${newContent.substring(0, 500)}...`)
      this.debug.log(`[GRUB] Added autoinstall entry with auto-boot (default=0, timeout=3) to ${grubCfgPath}`)
    } catch (error) {
      this.debug.log('error', `[GRUB] Failed to modify GRUB configuration: ${error}`)
      throw error
    }
  }

  /**
   * Finds the first file matching a pattern in a directory.
   *
   * @param {string} dir - Directory to search
   * @param {RegExp} pattern - Pattern to match
   * @returns {Promise<string|null>} - Relative path to the file or null if not found
   */
  private async findFirstFile (dir: string, pattern: RegExp): Promise<string|null> {
    try {
      const files = await fsPromises.readdir(dir)
      const match = files.find(file => pattern.test(file))
      return match || null
    } catch (error) {
      this.debug.log('error', `Error finding file in ${dir}: ${error}`)
      return null
    }
  }

  /**
   * Finds the kernel (vmlinuz) and initrd paths in the extracted ISO.
   * Checks standard locations used by Ubuntu live ISOs.
   *
   * @param {string} extractDir - The directory containing the extracted ISO
   * @returns {Promise<{vmlinuz: string, initrd: string}>} - Paths relative to ISO root
   */
  private async findKernelPaths (extractDir: string): Promise<{vmlinuz: string, initrd: string}> {
    // Standard locations for Ubuntu live ISOs
    const searchPaths = [
      { vmlinuz: '/casper/vmlinuz', initrd: '/casper/initrd' }, // Ubuntu Desktop/Server live
      { vmlinuz: '/casper/vmlinuz.efi', initrd: '/casper/initrd.lz' }, // Older Ubuntu
      { vmlinuz: '/install/vmlinuz', initrd: '/install/initrd.gz' }, // Alternative installer
      { vmlinuz: '/boot/vmlinuz', initrd: '/boot/initrd' } // Fallback
    ]

    for (const paths of searchPaths) {
      const vmlinuzPath = path.join(extractDir, paths.vmlinuz.substring(1))
      const initrdPath = path.join(extractDir, paths.initrd.substring(1))

      if (fs.existsSync(vmlinuzPath) && fs.existsSync(initrdPath)) {
        this.debug.log(`[KERNEL] Found kernel at ${paths.vmlinuz} and initrd at ${paths.initrd}`)
        return paths
      }
    }

    // If standard paths not found, search for files
    this.debug.log('[KERNEL] Standard paths not found, searching for kernel files...')

    // Check casper directory first (most common for Ubuntu)
    const casperDir = path.join(extractDir, 'casper')
    if (fs.existsSync(casperDir)) {
      const files = await fsPromises.readdir(casperDir)

      const vmlinuzFile = files.find(f => f.startsWith('vmlinuz'))
      const initrdFile = files.find(f => f.startsWith('initrd'))

      if (vmlinuzFile && initrdFile) {
        const result = {
          vmlinuz: `/casper/${vmlinuzFile}`,
          initrd: `/casper/${initrdFile}`
        }
        this.debug.log(`[KERNEL] Found kernel: ${result.vmlinuz}, initrd: ${result.initrd}`)
        return result
      }
    }

    // Default fallback
    this.debug.log('[KERNEL] Using default paths: /casper/vmlinuz, /casper/initrd')
    return { vmlinuz: '/casper/vmlinuz', initrd: '/casper/initrd' }
  }

  /**
   * Parses a shell-style argument string respecting single and double quotes.
   * For example: "-V 'Ubuntu 25.10 amd64'" becomes ["-V", "Ubuntu 25.10 amd64"]
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
   * Creates a new ISO image with the autoinstall configuration.
   *
   * @param {string} newIsoPath - The path to the new ISO image file
   * @param {string} extractDir - The directory containing the extracted ISO
   * @returns {Promise<void>}
   */
  async createISO (newIsoPath: string, extractDir: string): Promise<void> {
    // Ensure the extractDir exists and has content
    if (!fs.existsSync(extractDir)) {
      throw new Error('Extraction directory does not exist.')
    }

    this.debug.log('[ISO] Creating autoinstall configuration files...')

    // Create nocloud directory for autoinstall files as per Ubuntu documentation
    const noCloudDir = path.join(extractDir, 'nocloud')
    await fsPromises.mkdir(noCloudDir, { recursive: true })

    // Generate the configuration once and reuse it
    const config = await this.generateConfig()

    // Create required files in nocloud directory
    await fsPromises.writeFile(path.join(noCloudDir, 'meta-data'), '')
    await fsPromises.writeFile(path.join(noCloudDir, 'user-data'), config)
    await fsPromises.writeFile(path.join(noCloudDir, 'vendor-data'), '')
    this.debug.log('[NOCLOUD] Files created: user-data, meta-data, vendor-data in /nocloud/')

    // Also place copies in the root directory for compatibility
    await fsPromises.writeFile(path.join(extractDir, 'meta-data'), '')
    await fsPromises.writeFile(path.join(extractDir, 'user-data'), config)
    await fsPromises.writeFile(path.join(extractDir, 'vendor-data'), '')
    this.debug.log('[NOCLOUD] Files also created at root for compatibility')

    // Find kernel paths dynamically
    const kernelPaths = await this.findKernelPaths(extractDir)

    // Find and modify GRUB configurations
    const grubCfgPath = path.join(extractDir, 'boot/grub/grub.cfg')
    if (fs.existsSync(grubCfgPath)) {
      await this.modifyGrubConfig(grubCfgPath, kernelPaths.vmlinuz, kernelPaths.initrd)
      this.debug.log(`[GRUB] Modified GRUB configuration at ${grubCfgPath}`)
    } else {
      this.debug.log('warning', '[GRUB] Could not find GRUB configuration file at expected path')
    }

    this.debug.log('[ISO] Examining ISO structure...')

    // Check for crucial paths and files
    if (!fs.existsSync(path.join(extractDir, 'boot/grub/i386-pc/eltorito.img'))) {
      this.debug.log('warning', '[ISO] BIOS boot image not found at boot/grub/i386-pc/eltorito.img')
    }

    if (!fs.existsSync(path.join(extractDir, 'EFI/boot/bootx64.efi'))) {
      this.debug.log('warning', '[ISO] EFI boot image not found at EFI/boot/bootx64.efi')
    }

    // Get dynamic xorriso parameters from the original ISO
    const dynamicParams = await this.getXorrisoParamsFromISO(this.isoPath as string)

    let isoCreationCommandParts: string[]

    if (dynamicParams.length > 0) {
      // Use dynamic parameters from the original ISO
      // We need to:
      // 1. Replace the source ISO references with extractDir
      // 2. Add our output path
      this.debug.log('[XORRISO] Using dynamic parameters extracted from original ISO')

      isoCreationCommandParts = [
        'xorriso',
        '-as', 'mkisofs',
        ...dynamicParams.map(param => {
          // Replace references to the source ISO with the correct path
          if (param.includes(this.isoPath as string)) {
            return param // Keep references to original ISO for interval reads
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
        '-V', 'UBUNTU', // Volume ID (must be ≤ 16 chars)
        '--grub2-mbr', `--interval:local_fs:0s-15s:zero_mbrpt,zero_gpt:${this.isoPath}`,
        '--protective-msdos-label',
        '-partition_cyl_align', 'off',
        '-partition_offset', '16',
        '--mbr-force-bootable',
        '-append_partition', '2', '28732ac11ff8d211ba4b00a0c93ec93b', `--interval:local_fs:4087764d-4097891d::${this.isoPath}`,
        '-appended_part_as_gpt',
        '-iso_mbr_part_type', 'a2a0d0ebe5b9334487c068b6b72699c7',
        '-c', '/boot.catalog',
        '-b', '/boot/grub/i386-pc/eltorito.img',
        '-no-emul-boot',
        '-boot-load-size', '4',
        '-boot-info-table',
        '--grub2-boot-info',
        '-eltorito-alt-boot',
        '-e', '--interval:appended_partition_2_start_1021941s_size_10128d:all::',
        '-no-emul-boot',
        '-boot-load-size', '10128',
        '-o', newIsoPath,
        extractDir
      ]
    }

    // Use the executeCommand method from the parent class
    try {
      this.debug.log(`[XORRISO] Creating ISO with command:\n${isoCreationCommandParts.join(' ')}`)
      await this.executeCommand(isoCreationCommandParts)
      this.debug.log(`[ISO] Created ISO successfully at ${newIsoPath}`)

      // Remove the extracted directory
      await this.executeCommand(['rm', '-rf', extractDir])
      this.debug.log(`[ISO] Removed extracted directory ${extractDir}`)
    } catch (error) {
      this.debug.log('error', `[ISO] Failed to create ISO: ${error}`)
      throw error
    }
  }

  /**
   * Recursively searches for files matching a pattern within a directory.
   *
   * @param {string} baseDir - The base directory to start the search from
   * @param {string} dir - The current directory being searched
   * @param {RegExp} pattern - Regular expression pattern to match filenames
   * @returns {Promise<string[]>} - Array of paths relative to the extractDir
   */
  private async findBootFiles (dir: string, pattern: RegExp, extractDir?: string): Promise<string[]> {
    const results: string[] = []
    let files: fs.Dirent[]

    try {
      files = await fsPromises.readdir(dir, { withFileTypes: true })
    } catch (error) {
      this.debug.log('error', `Failed to read directory ${dir}: ${error}`)
      return results
    }

    for (const file of files) {
      const fullPath = path.join(dir, file.name)

      try {
        if (file.isDirectory()) {
          const subResults = await this.findBootFiles(fullPath, pattern, extractDir || dir)
          results.push(...subResults)
        } else if (pattern.test(file.name)) {
          // If extractDir is provided, make the path relative to it
          // Otherwise, just use the filename
          const relativePath = extractDir
            ? path.relative(extractDir, fullPath)
            : file.name

          results.push(relativePath)
          this.debug.log(`Found boot file: ${relativePath}`)
        }
      } catch (error) {
        this.debug.log('warning', `Error processing ${fullPath}: ${error}`)
      }
    }

    return results
  }

  /**
   * Validates the cloud-init YAML configuration.
   * Checks for valid YAML syntax and required autoinstall fields.
   * @param {string} configContent - The YAML configuration content
   * @returns {Promise<{ valid: boolean; errors: string[] }>} Validation result
   */
  protected async validateConfig (configContent: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    try {
      // Parse YAML to check syntax
      const parsed = yaml.load(configContent) as any

      // Check required structure
      if (!parsed) {
        errors.push('Configuration is empty or invalid YAML')
        return { valid: false, errors }
      }

      if (!parsed.autoinstall) {
        errors.push('Missing required "autoinstall" section')
      } else {
        // Check required autoinstall fields
        if (typeof parsed.autoinstall.version !== 'number') {
          errors.push('Missing or invalid "autoinstall.version" field')
        }

        if (!parsed.autoinstall.identity) {
          errors.push('Missing required "autoinstall.identity" section')
        } else {
          if (!parsed.autoinstall.identity.username) {
            errors.push('Missing "autoinstall.identity.username"')
          }
          if (!parsed.autoinstall.identity.password) {
            errors.push('Missing "autoinstall.identity.password"')
          }
        }
      }

      if (errors.length > 0) {
        return { valid: false, errors }
      }

      this.debug.log('Cloud-init YAML validation passed')
      return { valid: true, errors: [] }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push(`YAML parsing error: ${errorMsg}`)
      return { valid: false, errors }
    }
  }
}
