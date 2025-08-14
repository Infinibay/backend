#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

/**
 * Migration script to move existing ISOs to the correct directories
 * This script helps transition from the old single ISO directory structure
 * to the new separated temporary/permanent structure
 */

interface MigrationOptions {
  dryRun?: boolean
  verbose?: boolean
}

class ISOMigrator {
  private baseDir: string
  private oldIsoDir: string
  private tempIsoDir: string
  private permanentIsoDir: string
  private options: MigrationOptions

  // List of known permanent ISOs (patterns)
  private permanentISOPatterns = [
    'virtio-win',
    'ubuntu-.*desktop',
    'ubuntu-.*server',
    'fedora-.*netinst',
    'fedora-.*dvd',
    'rhel-.*dvd',
    'windows-10',
    'windows-11',
    'Win10',
    'Win11'
  ]

  constructor(options: MigrationOptions = {}) {
    this.baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
    this.oldIsoDir = path.join(this.baseDir, 'iso')
    this.tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR || path.join(this.baseDir, 'iso', 'temp')
    this.permanentIsoDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(this.baseDir, 'iso', 'permanent')
    this.options = {
      dryRun: false,
      verbose: false,
      ...options
    }
  }

  /**
   * Check if an ISO should be considered permanent
   */
  private isPermanentISO(filename: string): boolean {
    const lowerFilename = filename.toLowerCase()
    return this.permanentISOPatterns.some(pattern => {
      const regex = new RegExp(pattern.toLowerCase())
      return regex.test(lowerFilename)
    })
  }

  /**
   * Create necessary directories
   */
  private ensureDirectories(): void {
    const dirs = [
      this.tempIsoDir,
      this.permanentIsoDir,
      path.join(this.permanentIsoDir, 'ubuntu'),
      path.join(this.permanentIsoDir, 'fedora'),
      path.join(this.permanentIsoDir, 'windows')
    ]

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        if (this.options.dryRun) {
          console.log(`📁 Would create directory: ${dir}`)
        } else {
          fs.mkdirSync(dir, { recursive: true })
          console.log(`📁 Created directory: ${dir}`)
        }
      }
    }
  }

  /**
   * Get the appropriate permanent subdirectory for an ISO
   */
  private getPermanentSubdir(filename: string): string {
    const lowerFilename = filename.toLowerCase()
    
    if (lowerFilename.includes('ubuntu')) {
      return path.join(this.permanentIsoDir, 'ubuntu')
    }
    if (lowerFilename.includes('fedora') || lowerFilename.includes('rhel')) {
      return path.join(this.permanentIsoDir, 'fedora')
    }
    if (lowerFilename.includes('windows') || lowerFilename.includes('win10') || lowerFilename.includes('win11')) {
      return path.join(this.permanentIsoDir, 'windows')
    }
    
    // Default to root permanent directory
    return this.permanentIsoDir
  }

  /**
   * Main migration method
   */
  async migrate(): Promise<void> {
    console.log('🔄 Starting ISO migration...')
    console.log(`📁 Old ISO directory: ${this.oldIsoDir}`)
    console.log(`📁 Temp ISO directory: ${this.tempIsoDir}`)
    console.log(`📁 Permanent ISO directory: ${this.permanentIsoDir}`)
    
    if (this.options.dryRun) {
      console.log('🔍 Running in DRY RUN mode - no files will be moved')
    }

    // Ensure directories exist
    this.ensureDirectories()

    // Check if old ISO directory exists
    if (!fs.existsSync(this.oldIsoDir)) {
      console.log('⚠️  Old ISO directory does not exist. Nothing to migrate.')
      return
    }

    // Get all ISO files in the old directory (non-recursive, top level only)
    const files = fs.readdirSync(this.oldIsoDir)
    const isoFiles = files.filter(file => {
      const filePath = path.join(this.oldIsoDir, file)
      return file.endsWith('.iso') && fs.statSync(filePath).isFile()
    })

    if (isoFiles.length === 0) {
      console.log('✅ No ISO files found in the old directory. Nothing to migrate.')
      return
    }

    console.log(`📊 Found ${isoFiles.length} ISO file(s) to process`)

    let movedToPermanent = 0
    let movedToTemp = 0
    let skipped = 0

    for (const isoFile of isoFiles) {
      const oldPath = path.join(this.oldIsoDir, isoFile)
      let newPath: string
      let category: string

      try {
        // Check if already in a subdirectory
        if (oldPath.includes('/temp/') || oldPath.includes('/permanent/')) {
          if (this.options.verbose) {
            console.log(`⏭️  Skipping ${isoFile} (already in correct structure)`)
          }
          skipped++
          continue
        }

        // Determine if permanent or temporary
        if (this.isPermanentISO(isoFile)) {
          const targetDir = this.getPermanentSubdir(isoFile)
          newPath = path.join(targetDir, isoFile)
          category = 'permanent'
          movedToPermanent++
        } else {
          newPath = path.join(this.tempIsoDir, isoFile)
          category = 'temporary'
          movedToTemp++
        }

        const stats = fs.statSync(oldPath)
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)

        if (this.options.verbose || this.options.dryRun) {
          console.log(`\n${category === 'permanent' ? '💾' : '⏱️'}  ${isoFile}`)
          console.log(`    Category: ${category}`)
          console.log(`    Size: ${fileSizeMB} MB`)
          console.log(`    From: ${oldPath}`)
          console.log(`    To: ${newPath}`)
        }

        if (!this.options.dryRun) {
          // Check if file already exists at destination
          if (fs.existsSync(newPath)) {
            console.log(`⚠️  File already exists at destination, skipping: ${isoFile}`)
            skipped++
            movedToPermanent -= (category === 'permanent' ? 1 : 0)
            movedToTemp -= (category === 'temporary' ? 1 : 0)
            continue
          }

          // Move the file
          fs.renameSync(oldPath, newPath)
          if (!this.options.verbose) {
            console.log(`✓ Moved ${isoFile} to ${category} directory`)
          }
        }
      } catch (error) {
        console.error(`❌ Error processing ${isoFile}:`, error instanceof Error ? error.message : String(error))
      }
    }

    // Summary
    console.log('\n📈 Migration Summary:')
    console.log(`   - Files ${this.options.dryRun ? 'to be moved' : 'moved'} to permanent: ${movedToPermanent}`)
    console.log(`   - Files ${this.options.dryRun ? 'to be moved' : 'moved'} to temporary: ${movedToTemp}`)
    console.log(`   - Files skipped: ${skipped}`)
    
    if (this.options.dryRun && (movedToPermanent + movedToTemp) > 0) {
      console.log('\n💡 Run without --dry-run flag to actually move these files')
    }
  }

  /**
   * Update the virtio-win ISO path in .env file
   */
  async updateEnvFile(): Promise<void> {
    const envPath = path.join(this.baseDir, '..', 'backend', '.env')
    
    if (!fs.existsSync(envPath)) {
      console.log('⚠️  .env file not found, skipping environment update')
      return
    }

    try {
      let envContent = fs.readFileSync(envPath, 'utf-8')
      const oldVirtioPath = /VIRTIO_WIN_ISO_PATH=.*\/virtio-win.*\.iso/
      const newVirtioPath = `VIRTIO_WIN_ISO_PATH=${path.join(this.permanentIsoDir, 'virtio-win.iso')}`

      if (oldVirtioPath.test(envContent)) {
        if (this.options.dryRun) {
          console.log('📝 Would update VIRTIO_WIN_ISO_PATH in .env file')
        } else {
          envContent = envContent.replace(oldVirtioPath, newVirtioPath)
          fs.writeFileSync(envPath, envContent)
          console.log('📝 Updated VIRTIO_WIN_ISO_PATH in .env file')
        }
      }
    } catch (error) {
      console.error('❌ Error updating .env file:', error instanceof Error ? error.message : String(error))
    }
  }
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2)
  const options: MigrationOptions = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
      case '-d':
        options.dryRun = true
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

function printHelp(): void {
  console.log(`
Infinibay ISO Migration Utility

This script migrates existing ISOs from the old single directory structure
to the new separated temporary/permanent structure.

Usage: npm run migrate:isos [options]
   or: ts-node scripts/migrate-isos.ts [options]

Options:
  -d, --dry-run    Show what would be moved without actually moving files
  -v, --verbose    Show detailed information about each file
  -h, --help       Show this help message

Directory Structure:
  Old: /opt/infinibay/iso/*.iso
  New: /opt/infinibay/iso/permanent/  (for OS ISOs, virtio drivers)
       /opt/infinibay/iso/temp/       (for generated unattended ISOs)

Permanent ISOs include:
  - virtio-win drivers
  - Ubuntu installation ISOs
  - Fedora/RHEL installation ISOs
  - Windows installation ISOs

Examples:
  # See what would be moved (dry run)
  npm run migrate:isos -- --dry-run

  # Migrate with verbose output
  npm run migrate:isos -- --verbose

  # Dry run with verbose output
  npm run migrate:isos -- --dry-run --verbose
`)
}

// Main execution
async function main() {
  const options = parseArgs()
  const migrator = new ISOMigrator(options)

  try {
    await migrator.migrate()
    await migrator.updateEnvFile()
    console.log('\n✅ Migration completed successfully!')
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}

export { ISOMigrator }