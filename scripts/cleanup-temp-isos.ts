#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

/**
 * Cleanup utility for temporary ISO files
 * This script safely removes all ISO files from the temporary directory
 * while preserving permanent ISOs (OS installation ISOs, virtio drivers, etc.)
 */

interface CleanupOptions {
  dryRun?: boolean
  verbose?: boolean
  olderThanDays?: number
}

class TempISOCleaner {
  private tempIsoDir: string
  private permanentIsoDir: string
  private options: CleanupOptions

  constructor(options: CleanupOptions = {}) {
    const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
    this.tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR || path.join(baseDir, 'iso', 'temp')
    this.permanentIsoDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(baseDir, 'iso', 'permanent')
    this.options = {
      dryRun: false,
      verbose: false,
      olderThanDays: 0,
      ...options
    }
  }

  /**
   * Main cleanup method
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Starting temporary ISO cleanup...')
    console.log(`📁 Temp ISO directory: ${this.tempIsoDir}`)
    
    if (this.options.dryRun) {
      console.log('🔍 Running in DRY RUN mode - no files will be deleted')
    }

    // Check if temp directory exists
    if (!fs.existsSync(this.tempIsoDir)) {
      console.log('⚠️  Temp ISO directory does not exist. Nothing to clean.')
      return
    }

    // Get all files in temp directory
    const files = fs.readdirSync(this.tempIsoDir)
    const isoFiles = files.filter(file => file.endsWith('.iso'))

    if (isoFiles.length === 0) {
      console.log('✅ No temporary ISO files found. Directory is clean.')
      return
    }

    console.log(`📊 Found ${isoFiles.length} ISO file(s) in temp directory`)

    let deletedCount = 0
    let skippedCount = 0
    let totalSize = 0

    for (const isoFile of isoFiles) {
      const filePath = path.join(this.tempIsoDir, isoFile)
      
      try {
        const stats = fs.statSync(filePath)
        const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)
        
        // Skip if file is newer than specified age
        if (this.options.olderThanDays && this.options.olderThanDays > 0 && ageInDays < this.options.olderThanDays) {
          if (this.options.verbose) {
            console.log(`⏭️  Skipping ${isoFile} (age: ${ageInDays.toFixed(1)} days, threshold: ${this.options.olderThanDays} days)`)
          }
          skippedCount++
          continue
        }

        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
        const modifiedDate = stats.mtime.toISOString().replace('T', ' ').substring(0, 19)
        
        if (this.options.verbose || this.options.dryRun) {
          console.log(`🗑️  ${this.options.dryRun ? 'Would delete' : 'Deleting'}: ${isoFile}`)
          console.log(`    Size: ${fileSizeMB} MB`)
          console.log(`    Modified: ${modifiedDate}`)
          console.log(`    Age: ${ageInDays.toFixed(1)} days`)
        }

        if (!this.options.dryRun) {
          fs.unlinkSync(filePath)
        }
        
        deletedCount++
        totalSize += stats.size
      } catch (error) {
        console.error(`❌ Error processing ${isoFile}:`, error instanceof Error ? error.message : String(error))
      }
    }

    // Summary
    console.log('\n📈 Cleanup Summary:')
    console.log(`   - Files ${this.options.dryRun ? 'to be deleted' : 'deleted'}: ${deletedCount}`)
    console.log(`   - Files skipped: ${skippedCount}`)
    console.log(`   - Space ${this.options.dryRun ? 'to be freed' : 'freed'}: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`)
    
    if (this.options.dryRun && deletedCount > 0) {
      console.log('\n💡 Run without --dry-run flag to actually delete these files')
    }
  }

  /**
   * Cleanup with simple rm -rf for all ISOs in temp directory
   * WARNING: This will delete ALL ISOs in the temp directory immediately
   */
  async cleanupAll(): Promise<void> {
    console.log('🚨 WARNING: This will delete ALL temporary ISO files!')
    
    if (!fs.existsSync(this.tempIsoDir)) {
      console.log('⚠️  Temp ISO directory does not exist. Nothing to clean.')
      return
    }

    const command = `rm -rf ${path.join(this.tempIsoDir, '*.iso')}`
    
    if (this.options.dryRun) {
      console.log(`🔍 DRY RUN - Would execute: ${command}`)
    } else {
      console.log(`🗑️  Executing: ${command}`)
      
      try {
        const { execSync } = require('child_process')
        execSync(command, { stdio: 'inherit' })
        console.log('✅ All temporary ISO files have been deleted')
      } catch (error) {
        console.error('❌ Error during cleanup:', error instanceof Error ? error.message : String(error))
      }
    }
  }
}

// Parse command line arguments
function parseArgs(): { options: CleanupOptions; cleanupAll: boolean } {
  const args = process.argv.slice(2)
  const options: CleanupOptions = {}
  let cleanupAll = false

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
      case '--older-than':
      case '-o':
        if (i + 1 < args.length) {
          options.olderThanDays = parseInt(args[++i], 10)
        }
        break
      case '--all':
      case '-a':
        cleanupAll = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return { options, cleanupAll }
}

function printHelp(): void {
  console.log(`
Infinibay Temporary ISO Cleanup Utility

Usage: npm run cleanup:temp-isos [options]
   or: ts-node scripts/cleanup-temp-isos.ts [options]

Options:
  -d, --dry-run         Show what would be deleted without actually deleting
  -v, --verbose         Show detailed information about each file
  -o, --older-than <days>  Only delete ISOs older than specified days
  -a, --all             Delete ALL temporary ISOs immediately (use with caution!)
  -h, --help            Show this help message

Examples:
  # See what would be deleted (dry run)
  npm run cleanup:temp-isos -- --dry-run

  # Delete all temp ISOs with verbose output
  npm run cleanup:temp-isos -- --verbose

  # Delete temp ISOs older than 7 days
  npm run cleanup:temp-isos -- --older-than 7

  # Delete ALL temp ISOs immediately (dangerous!)
  npm run cleanup:temp-isos -- --all

  # Combine options
  npm run cleanup:temp-isos -- --dry-run --verbose --older-than 3
`)
}

// Main execution
async function main() {
  const { options, cleanupAll } = parseArgs()
  const cleaner = new TempISOCleaner(options)

  try {
    if (cleanupAll) {
      await cleaner.cleanupAll()
    } else {
      await cleaner.cleanup()
    }
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Run if executed directly
if (require.main === module) {
  main()
}

export { TempISOCleaner }