#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import * as dotenv from 'dotenv'
import * as readline from 'readline'

// Load environment variables
dotenv.config()

/**
 * Infinibay System Reset Utility
 *
 * This script safely resets the entire Infinibay system by cleaning up:
 * - QEMU and dnsmasq processes
 * - Network resources (nftables, TAP devices, bridges)
 * - DHCP/DNS configuration files
 * - VM disk images and temporary ISOs
 * - Socket files
 * - Database records (with re-seeding)
 * - Redis cache
 *
 * IMPORTANT: This is a destructive operation. All VM data will be lost.
 */

interface ResetOptions {
  force: boolean
  dryRun: boolean
  deletePermanentIsos: boolean
  verbose: boolean
}

interface CleanupResult {
  success: boolean
  message: string
  itemsCleaned: number
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
}

class SystemReset {
  private options: ResetOptions
  private baseDir: string
  private diskDir: string
  private socketDir: string
  private tempIsoDir: string
  private permanentIsoDir: string
  private dnsmasqConfigDir: string
  private dnsmasqRunDir: string
  private dnsmasqLogDir: string

  constructor (options: ResetOptions) {
    this.options = options
    this.baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
    this.diskDir = process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks'
    this.socketDir = process.env.INFINIZATION_SOCKET_DIR || path.join(this.baseDir, 'sockets')
    this.tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR || path.join(this.baseDir, 'iso', 'temp')
    this.permanentIsoDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(this.baseDir, 'iso', 'permanent')
    this.dnsmasqConfigDir = '/etc/infinibay/dnsmasq.d'
    this.dnsmasqRunDir = path.join(this.baseDir, 'run', 'dnsmasq')
    this.dnsmasqLogDir = '/var/log/infinibay'
  }

  private log (message: string, type: 'info' | 'success' | 'warning' | 'error' | 'header' = 'info'): void {
    const prefix = {
      info: `${colors.blue}ℹ${colors.reset}`,
      success: `${colors.green}✓${colors.reset}`,
      warning: `${colors.yellow}⚠${colors.reset}`,
      error: `${colors.red}✗${colors.reset}`,
      header: `${colors.bold}${colors.cyan}▸${colors.reset}`
    }
    console.log(`${prefix[type]} ${message}`)
  }

  private logVerbose (message: string): void {
    if (this.options.verbose) {
      console.log(`  ${colors.magenta}→${colors.reset} ${message}`)
    }
  }

  /**
   * Run a command, optionally with sudo if permission denied
   */
  private runCommand (command: string, useSudo = false): { success: boolean; output: string } {
    const fullCommand = useSudo ? `sudo ${command}` : command

    if (this.options.dryRun) {
      this.logVerbose(`[DRY-RUN] Would execute: ${fullCommand}`)
      return { success: true, output: '' }
    }

    try {
      this.logVerbose(`Executing: ${fullCommand}`)
      const output = execSync(fullCommand, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      return { success: true, output: output.trim() }
    } catch (error: any) {
      // If permission denied and not already using sudo, try with sudo
      if (!useSudo && error.message?.includes('permission denied')) {
        return this.runCommand(command, true)
      }
      return { success: false, output: error.message || String(error) }
    }
  }

  /**
   * Run a command that requires sudo
   */
  private runSudo (command: string): { success: boolean; output: string } {
    return this.runCommand(command, true)
  }

  /**
   * Check if a command exists
   */
  private commandExists (cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Wait for specified milliseconds
   */
  private async wait (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Phase 1: Stop all QEMU and dnsmasq processes
   */
  async stopAllProcesses (): Promise<CleanupResult> {
    this.log('Stopping all Infinibay processes...', 'header')
    let itemsCleaned = 0

    // Kill QEMU processes
    this.logVerbose('Looking for QEMU processes...')
    const qemuResult = this.runSudo('pkill -9 -f "qemu-system" || true')
    if (qemuResult.success) {
      this.log('Killed QEMU processes', 'success')
      itemsCleaned++
    }

    // Kill dnsmasq processes with infinibay pattern
    this.logVerbose('Looking for dnsmasq processes...')
    const dnsmasqResult = this.runSudo('pkill -9 -f "dnsmasq.*infinibr" || true')
    if (dnsmasqResult.success) {
      this.log('Killed dnsmasq processes', 'success')
      itemsCleaned++
    }

    // Give processes time to terminate
    await this.wait(500)

    return { success: true, message: 'All processes stopped', itemsCleaned }
  }

  /**
   * Phase 2: Cleanup network resources (ORDER IS CRITICAL)
   */
  async cleanupNetwork (): Promise<CleanupResult> {
    this.log('Cleaning up network resources...', 'header')
    let itemsCleaned = 0

    // Step 1: Remove nftables chains FIRST (they hold references to TAP devices)
    this.logVerbose('Removing nftables chains...')
    if (this.commandExists('nft')) {
      // List all chains in inet filter table
      const listResult = this.runSudo('nft list chains inet filter 2>/dev/null || true')
      if (listResult.success && listResult.output) {
        // Find chains that look like VM chains (usually have VM ID pattern)
        const chainMatches = listResult.output.match(/chain\s+(\S+)/g) || []
        for (const match of chainMatches) {
          const chainName = match.replace('chain ', '')
          // Skip built-in chains
          if (['input', 'output', 'forward'].includes(chainName.toLowerCase())) continue

          this.runSudo(`nft delete chain inet filter ${chainName} 2>/dev/null || true`)
          itemsCleaned++
        }
      }

      // Clean up infinibay_filter table (inet family)
      this.runSudo('nft flush table inet infinibay_filter 2>/dev/null || true')
      this.runSudo('nft delete table inet infinibay_filter 2>/dev/null || true')

      // Clean up NAT table entries (ip family, NOT inet!)
      this.runSudo('nft flush table ip infinibay_nat 2>/dev/null || true')
      this.runSudo('nft delete table ip infinibay_nat 2>/dev/null || true')

      // Clean up infinization bridge table
      this.runSudo('nft flush table bridge infinization 2>/dev/null || true')
      this.runSudo('nft delete table bridge infinization 2>/dev/null || true')

      this.log('Removed nftables tables', 'success')
    }

    await this.wait(200)

    // Step 2: Remove TAP devices
    this.logVerbose('Removing TAP devices...')
    const tapResult = this.runCommand("ip link show 2>/dev/null | grep -oE 'tap-[^:@]+' || true")
    if (tapResult.success && tapResult.output) {
      const tapDevices = tapResult.output.split('\n').filter(d => d.trim())
      for (const tap of tapDevices) {
        this.runSudo(`ip link set ${tap} down 2>/dev/null || true`)
        this.runSudo(`ip tuntap del dev ${tap} mode tap 2>/dev/null || true`)
        itemsCleaned++
      }
      this.log(`Removed ${tapDevices.length} TAP device(s)`, 'success')
    }

    await this.wait(200)

    // Step 3: Remove bridges
    this.logVerbose('Removing bridges...')
    const bridgeResult = this.runCommand("ip link show type bridge 2>/dev/null | grep -oE 'infinibr-[^:@]+' || true")
    if (bridgeResult.success && bridgeResult.output) {
      const bridges = bridgeResult.output.split('\n').filter(b => b.trim())
      for (const bridge of bridges) {
        this.runSudo(`ip link set ${bridge} down 2>/dev/null || true`)
        this.runSudo(`ip link del ${bridge} 2>/dev/null || true`)
        itemsCleaned++
      }
      this.log(`Removed ${bridges.length} bridge(s)`, 'success')
    }

    return { success: true, message: 'Network resources cleaned', itemsCleaned }
  }

  /**
   * Phase 3: Cleanup DHCP/DNS configuration files
   */
  async cleanupDhcpDns (): Promise<CleanupResult> {
    this.log('Cleaning up DHCP/DNS files...', 'header')
    let itemsCleaned = 0

    // Remove dnsmasq config files
    if (fs.existsSync(this.dnsmasqConfigDir)) {
      this.logVerbose(`Removing files from ${this.dnsmasqConfigDir}`)
      const result = this.runSudo(`rm -rf ${this.dnsmasqConfigDir}/*.conf 2>/dev/null || true`)
      if (result.success) {
        this.log('Removed dnsmasq config files', 'success')
        itemsCleaned++
      }
    }

    // Remove dnsmasq runtime files (PID, leases)
    if (fs.existsSync(this.dnsmasqRunDir)) {
      this.logVerbose(`Removing files from ${this.dnsmasqRunDir}`)
      if (!this.options.dryRun) {
        try {
          const files = fs.readdirSync(this.dnsmasqRunDir)
          for (const file of files) {
            fs.unlinkSync(path.join(this.dnsmasqRunDir, file))
            itemsCleaned++
          }
          this.log('Removed dnsmasq runtime files', 'success')
        } catch (error) {
          // May need sudo
          this.runSudo(`rm -rf ${this.dnsmasqRunDir}/* 2>/dev/null || true`)
        }
      } else {
        this.logVerbose('[DRY-RUN] Would remove dnsmasq runtime files')
      }
    }

    // Remove dnsmasq log files
    if (fs.existsSync(this.dnsmasqLogDir)) {
      this.logVerbose(`Removing dnsmasq logs from ${this.dnsmasqLogDir}`)
      this.runSudo(`rm -f ${this.dnsmasqLogDir}/dnsmasq-*.log 2>/dev/null || true`)
      this.log('Removed dnsmasq log files', 'success')
      itemsCleaned++
    }

    return { success: true, message: 'DHCP/DNS files cleaned', itemsCleaned }
  }

  /**
   * Phase 4: Cleanup storage (disks and ISOs)
   */
  async cleanupStorage (): Promise<CleanupResult> {
    this.log('Cleaning up storage...', 'header')
    let itemsCleaned = 0
    let totalSizeFreed = 0

    // Remove disk images
    if (fs.existsSync(this.diskDir)) {
      this.logVerbose(`Removing disk images from ${this.diskDir}`)
      try {
        const files = fs.readdirSync(this.diskDir)
        const qcow2Files = files.filter(f => f.endsWith('.qcow2'))

        for (const file of qcow2Files) {
          const filePath = path.join(this.diskDir, file)
          try {
            const stats = fs.statSync(filePath)
            totalSizeFreed += stats.size

            if (!this.options.dryRun) {
              // May need sudo for files created by QEMU
              const result = this.runCommand(`rm -f "${filePath}"`)
              if (!result.success) {
                this.runSudo(`rm -f "${filePath}"`)
              }
            }
            itemsCleaned++
          } catch (e) {
            this.runSudo(`rm -f "${filePath}" 2>/dev/null || true`)
          }
        }

        const sizeMB = (totalSizeFreed / (1024 * 1024)).toFixed(2)
        this.log(`Removed ${qcow2Files.length} disk image(s) (${sizeMB} MB)`, 'success')
      } catch (error) {
        this.log(`Could not access disk directory: ${this.diskDir}`, 'warning')
      }
    }

    // Remove temporary ISOs
    if (fs.existsSync(this.tempIsoDir)) {
      this.logVerbose(`Removing temporary ISOs from ${this.tempIsoDir}`)
      if (!this.options.dryRun) {
        this.runCommand(`rm -rf "${this.tempIsoDir}"/*`)
      }
      this.log('Removed temporary ISOs', 'success')
      itemsCleaned++
    }

    // Optionally remove permanent ISOs
    if (this.options.deletePermanentIsos && fs.existsSync(this.permanentIsoDir)) {
      this.logVerbose(`Removing permanent ISOs from ${this.permanentIsoDir}`)
      if (!this.options.dryRun) {
        this.runCommand(`rm -rf "${this.permanentIsoDir}"/*`)
      }
      this.log('Removed permanent ISOs', 'success')
      itemsCleaned++
    }

    return { success: true, message: 'Storage cleaned', itemsCleaned }
  }

  /**
   * Phase 5: Cleanup socket files
   */
  async cleanupSockets (): Promise<CleanupResult> {
    this.log('Cleaning up socket files...', 'header')
    let itemsCleaned = 0

    if (fs.existsSync(this.socketDir)) {
      this.logVerbose(`Removing sockets from ${this.socketDir}`)
      try {
        const files = fs.readdirSync(this.socketDir)
        for (const file of files) {
          const filePath = path.join(this.socketDir, file)
          if (!this.options.dryRun) {
            try {
              fs.unlinkSync(filePath)
            } catch {
              this.runSudo(`rm -f "${filePath}"`)
            }
          }
          itemsCleaned++
        }
        this.log(`Removed ${files.length} socket file(s)`, 'success')
      } catch (error) {
        this.log(`Could not access socket directory: ${this.socketDir}`, 'warning')
      }
    }

    return { success: true, message: 'Socket files cleaned', itemsCleaned }
  }

  /**
   * Phase 6: Reset database
   */
  async resetDatabase (): Promise<CleanupResult> {
    this.log('Resetting database...', 'header')

    if (this.options.dryRun) {
      this.logVerbose('[DRY-RUN] Would reset database using prisma migrate reset')
      return { success: true, message: 'Database reset (dry-run)', itemsCleaned: 0 }
    }

    try {
      // Change to backend directory
      const backendDir = path.resolve(__dirname, '..')

      this.logVerbose('Running prisma migrate reset...')
      execSync('npx prisma migrate reset --force', {
        cwd: backendDir,
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        env: { ...process.env, FORCE_COLOR: '1' }
      })

      this.log('Database reset and re-seeded successfully', 'success')
      return { success: true, message: 'Database reset', itemsCleaned: 1 }
    } catch (error: any) {
      this.log(`Database reset failed: ${error.message}`, 'error')
      return { success: false, message: error.message, itemsCleaned: 0 }
    }
  }

  /**
   * Phase 7: Clear Redis cache
   */
  async clearRedisCache (): Promise<CleanupResult> {
    this.log('Clearing Redis cache...', 'header')

    if (this.options.dryRun) {
      this.logVerbose('[DRY-RUN] Would clear Redis cache')
      return { success: true, message: 'Redis cleared (dry-run)', itemsCleaned: 0 }
    }

    if (!this.commandExists('redis-cli')) {
      this.logVerbose('Redis CLI not found, skipping cache clear')
      return { success: true, message: 'Redis not installed, skipped', itemsCleaned: 0 }
    }

    const redisHost = process.env.REDIS_HOST || 'localhost'
    const redisPort = process.env.REDIS_PORT || '6379'

    const result = this.runCommand(`redis-cli -h ${redisHost} -p ${redisPort} FLUSHDB`)
    if (result.success) {
      this.log('Redis cache cleared', 'success')
      return { success: true, message: 'Redis cleared', itemsCleaned: 1 }
    } else {
      this.log('Could not connect to Redis (may not be running)', 'warning')
      return { success: true, message: 'Redis not available', itemsCleaned: 0 }
    }
  }

  /**
   * Phase 8: Recreate directory structure
   */
  async recreateDirectories (): Promise<CleanupResult> {
    this.log('Recreating directory structure...', 'header')
    let itemsCleaned = 0

    const directories = [
      this.socketDir,
      this.tempIsoDir,
      this.permanentIsoDir,
      this.dnsmasqRunDir,
      path.join(this.baseDir, 'tmp')
    ]

    for (const dir of directories) {
      if (!this.options.dryRun) {
        try {
          fs.mkdirSync(dir, { recursive: true })
          this.logVerbose(`Created directory: ${dir}`)
          itemsCleaned++
        } catch {
          // May need sudo
          this.runSudo(`mkdir -p "${dir}"`)
          itemsCleaned++
        }
      } else {
        this.logVerbose(`[DRY-RUN] Would create: ${dir}`)
      }
    }

    this.log('Directory structure recreated', 'success')
    return { success: true, message: 'Directories created', itemsCleaned }
  }

  /**
   * Check if services are running
   */
  private checkServicesRunning (): { backend: boolean; frontend: boolean } {
    const backendResult = this.runCommand('systemctl is-active infinibay-backend 2>/dev/null || true')
    const frontendResult = this.runCommand('systemctl is-active infinibay-frontend 2>/dev/null || true')

    return {
      backend: backendResult.output === 'active',
      frontend: frontendResult.output === 'active'
    }
  }

  /**
   * Run the complete reset
   */
  async run (): Promise<void> {
    console.log(`
${colors.bold}${colors.red}╔════════════════════════════════════════════════════════════╗
║                 INFINIBAY SYSTEM RESET                     ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`)

    if (this.options.dryRun) {
      this.log('Running in DRY-RUN mode - no changes will be made', 'warning')
      console.log()
    }

    // Check if services are running
    const services = this.checkServicesRunning()
    if (services.backend || services.frontend) {
      this.log('Warning: Infinibay services are running!', 'warning')
      if (services.backend) this.log('  - infinibay-backend is active', 'warning')
      if (services.frontend) this.log('  - infinibay-frontend is active', 'warning')
      this.log('Consider stopping services first: sudo systemctl stop infinibay-backend infinibay-frontend', 'info')
      console.log()
    }

    // Show what will be deleted
    console.log(`${colors.bold}This will:${colors.reset}`)
    console.log('  - Kill all QEMU and dnsmasq processes')
    console.log('  - Remove all nftables firewall chains')
    console.log('  - Remove all TAP devices and bridges')
    console.log('  - Remove dnsmasq configuration and runtime files')
    console.log('  - Delete ALL VM disk images')
    console.log('  - Delete temporary ISO files')
    if (this.options.deletePermanentIsos) {
      console.log(`  - ${colors.red}Delete permanent ISO files (OS images)${colors.reset}`)
    }
    console.log('  - Remove all socket files')
    console.log('  - Reset the database (re-seed with defaults)')
    console.log('  - Clear Redis cache')
    console.log()

    console.log(`${colors.bold}${colors.red}⚠️  WARNING: ALL VM DATA WILL BE PERMANENTLY LOST!${colors.reset}`)
    console.log()

    // Confirm unless --force
    if (!this.options.force && !this.options.dryRun) {
      const confirmed = await this.confirm('Are you sure you want to proceed?')
      if (!confirmed) {
        this.log('Reset cancelled by user', 'info')
        process.exit(0)
      }
      console.log()
    }

    // Run all phases
    const startTime = Date.now()
    let totalItemsCleaned = 0

    const phases = [
      { name: 'Stop Processes', fn: () => this.stopAllProcesses() },
      { name: 'Cleanup Network', fn: () => this.cleanupNetwork() },
      { name: 'Cleanup DHCP/DNS', fn: () => this.cleanupDhcpDns() },
      { name: 'Cleanup Storage', fn: () => this.cleanupStorage() },
      { name: 'Cleanup Sockets', fn: () => this.cleanupSockets() },
      { name: 'Reset Database', fn: () => this.resetDatabase() },
      { name: 'Clear Redis', fn: () => this.clearRedisCache() },
      { name: 'Recreate Directories', fn: () => this.recreateDirectories() }
    ]

    for (const phase of phases) {
      console.log()
      const result = await phase.fn()
      totalItemsCleaned += result.itemsCleaned

      if (!result.success) {
        this.log(`Phase "${phase.name}" failed: ${result.message}`, 'error')
        if (!this.options.force) {
          this.log('Use --force to continue despite errors', 'info')
          process.exit(1)
        }
      }
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log()
    console.log(`${colors.bold}${colors.green}╔════════════════════════════════════════════════════════════╗
║                    RESET COMPLETE                          ║
╚════════════════════════════════════════════════════════════╝${colors.reset}`)
    console.log()
    this.log(`Items cleaned: ${totalItemsCleaned}`, 'success')
    this.log(`Time elapsed: ${elapsed}s`, 'info')

    if (this.options.dryRun) {
      console.log()
      this.log('This was a dry run. Run without --dry-run to actually reset.', 'info')
    }
  }

  /**
   * Ask for confirmation
   */
  private async confirm (question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise(resolve => {
      rl.question(`${question} [y/N]: `, answer => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
  }
}

// Parse command line arguments
function parseArgs (): ResetOptions {
  const args = process.argv.slice(2)
  const options: ResetOptions = {
    force: false,
    dryRun: false,
    deletePermanentIsos: false,
    verbose: false
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
    case '--force':
    case '-f':
      options.force = true
      break
    case '--dry-run':
    case '-d':
      options.dryRun = true
      break
    case '--delete-permanent-isos':
      options.deletePermanentIsos = true
      break
    case '--verbose':
    case '-v':
      options.verbose = true
      break
    case '--help':
    case '-h':
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp (): void {
  console.log(`
${colors.bold}Infinibay System Reset Utility${colors.reset}

Usage: npm run reset:system [options]
   or: ts-node scripts/reset-system.ts [options]

Options:
  -f, --force              Skip confirmation prompts
  -d, --dry-run            Show what would be done without making changes
  --delete-permanent-isos  Also delete permanent ISOs (OS installation images)
  -v, --verbose            Show detailed output
  -h, --help               Show this help message

Examples:
  # Preview what would be reset (safe)
  npm run reset:system -- --dry-run

  # Interactive reset with confirmations
  npm run reset:system

  # Force reset without confirmations (for automation)
  npm run reset:system -- --force

  # Full reset including OS installation ISOs
  npm run reset:system -- --force --delete-permanent-isos

  # Verbose output
  npm run reset:system -- --force --verbose

${colors.yellow}Warning: This is a destructive operation. All VM data will be lost.${colors.reset}
`)
}

// Main execution
async function main () {
  const options = parseArgs()
  const reset = new SystemReset(options)

  try {
    await reset.run()
  } catch (error: any) {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error.message)
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}

export { SystemReset }
