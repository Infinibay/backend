#!/usr/bin/env ts-node
/**
 * Cleanup script to remove orphaned network filters from libvirt
 *
 * This script identifies and removes network filters that are causing errors
 * or are no longer properly synced between the database and libvirt.
 *
 * Usage:
 *   npm run cleanup:nwfilters        # Normal cleanup
 *   npm run cleanup:nwfilters:force  # Force remove all ibay filters
 */

import { Connection, NwFilter } from '@infinibay/libvirt-node'
import { PrismaClient } from '@prisma/client'
import { Debugger } from '../../app/utils/debug'
import { execSync } from 'child_process'

const prisma = new PrismaClient()
const debug = new Debugger('cleanup-orphaned-nwfilters')

async function cleanupOrphanedNwfilters () {
  console.log('🧹 Starting network filters cleanup...\n')

  let conn: Connection | null = null
  let totalRemoved = 0
  let totalFound = 0

  try {
    // Connect to libvirt
    conn = Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to connect to libvirt')
    }

    // Get all network filters from libvirt that match Infinibay pattern
    console.log('📋 Fetching all Infinibay network filters from libvirt...')
    const filterListOutput = execSync('virsh nwfilter-list 2>/dev/null | grep ibay- | awk \'{print $2}\'', { encoding: 'utf-8' })
    const libvirtFilterNames = filterListOutput.trim().split('\n').filter((name: string) => name.length > 0)

    console.log(`Found ${libvirtFilterNames.length} Infinibay network filters in libvirt\n`)

    if (libvirtFilterNames.length === 0) {
      console.log('✅ No Infinibay network filters found - system is clean!')
      return
    }

    // Get all network filters from database
    const dbFilters = await prisma.nWFilter.findMany({
      select: {
        id: true,
        internalName: true,
        vms: {
          select: {
            vmId: true
          }
        }
      }
    })

    const dbFilterNames = new Set(dbFilters.map(f => f.internalName))
    console.log(`Found ${dbFilterNames.size} network filters in database\n`)

    // Find filters to clean up:
    // 1. Filters that exist in libvirt but not in database (true orphans)
    // 2. Filters in database with no VM associations (unused filters)

    const orphanedInLibvirt: string[] = []
    const unusedInDb: typeof dbFilters = []

    // Find true orphans (in libvirt but not in DB)
    for (const filterName of libvirtFilterNames) {
      if (!dbFilterNames.has(filterName)) {
        orphanedInLibvirt.push(filterName)
      }
    }

    // Find unused filters in DB (no VM associations)
    for (const filter of dbFilters) {
      if (filter.vms.length === 0) {
        unusedInDb.push(filter)
      }
    }

    totalFound = orphanedInLibvirt.length + unusedInDb.length

    if (totalFound === 0) {
      console.log('✅ No orphaned or unused network filters found - system is clean!')
      return
    }

    console.log(`❗ Found ${totalFound} filters to clean up:`)
    console.log(`   • ${orphanedInLibvirt.length} orphaned in libvirt (not in database)`)
    console.log(`   • ${unusedInDb.length} unused in database (no VM associations)\n`)

    // List filters to be removed
    if (orphanedInLibvirt.length > 0) {
      console.log('📋 Orphaned filters in libvirt:')
      for (const name of orphanedInLibvirt) {
        console.log(`  • ${name}`)
      }
      console.log('')
    }

    if (unusedInDb.length > 0) {
      console.log('📋 Unused filters in database:')
      for (const filter of unusedInDb) {
        console.log(`  • ${filter.internalName}`)
      }
      console.log('')
    }

    console.log('🗑️  Removing filters...\n')

    // Remove orphaned filters from libvirt
    for (const filterName of orphanedInLibvirt) {
      try {
        const filter = NwFilter.lookupByName(conn, filterName)
        if (filter) {
          await filter.undefine()
          console.log(`  ✅ Removed from libvirt: ${filterName}`)
          totalRemoved++
        }
      } catch (error) {
        console.error(`  ❌ Failed to remove ${filterName}: ${error}`)
        debug.log(`Error removing filter ${filterName}: ${error}`)
      }
    }

    // Remove unused filters from both DB and libvirt
    for (const dbFilter of unusedInDb) {
      try {
        // First try to remove from libvirt
        try {
          const filter = NwFilter.lookupByName(conn, dbFilter.internalName)
          if (filter) {
            await filter.undefine()
            console.log(`  ✅ Removed from libvirt: ${dbFilter.internalName}`)
          }
        } catch (err) {
          // Filter might not exist in libvirt, continue to DB removal
          debug.log(`Note: Filter ${dbFilter.internalName} not found in libvirt: ${err}`)
        }

        // Remove from database
        await prisma.nWFilter.delete({
          where: { id: dbFilter.id }
        })
        console.log(`  ✅ Removed from database: ${dbFilter.internalName}`)
        totalRemoved++
      } catch (error) {
        console.error(`  ❌ Failed to remove ${dbFilter.internalName}: ${error}`)
        debug.log(`Error removing filter ${dbFilter.internalName}: ${error}`)
      }
    }
  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    debug.log(`Fatal error: ${error}`)
    process.exit(1)
  } finally {
    // Close libvirt connection
    if (conn) {
      try {
        conn.close()
      } catch (error) {
        debug.log(`Error closing libvirt connection: ${error}`)
      }
    }

    // Disconnect from database
    await prisma.$disconnect()
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 Cleanup Summary:')
  console.log(`  • Total filters found: ${totalFound}`)
  console.log(`  • Successfully removed: ${totalRemoved}`)
  console.log(`  • Failed to remove: ${totalFound - totalRemoved}`)
  console.log('='.repeat(50))

  if (totalRemoved === totalFound) {
    console.log('\n✨ All orphaned/unused network filters have been cleaned up!')
  } else if (totalRemoved > 0) {
    console.log('\n⚠️  Some filters could not be removed. Check logs for details.')
  }
}

// Add option to force remove all ibay filters (nuclear option)
const forceCleanAll = process.argv.includes('--force-all')

async function forceCleanAllFilters () {
  console.log('⚠️  FORCE CLEANUP MODE - Removing ALL Infinibay network filters\n')

  let conn: Connection | null = null
  let removed = 0

  try {
    conn = Connection.open('qemu:///system')
    if (!conn) {
      throw new Error('Failed to connect to libvirt')
    }

    // Get all ibay filters
    const filterListOutput = execSync('virsh nwfilter-list 2>/dev/null | grep ibay- | awk \'{print $2}\'', { encoding: 'utf-8' })
    const filterNames = filterListOutput.trim().split('\n').filter((name: string) => name.length > 0)

    console.log(`Found ${filterNames.length} filters to remove\n`)

    for (const name of filterNames) {
      try {
        execSync(`virsh nwfilter-undefine ${name} 2>/dev/null`)
        console.log(`  ✅ Removed: ${name}`)
        removed++
      } catch (err) {
        console.error(`  ❌ Failed to remove ${name}`)
      }
    }

    // Also clean database
    const deleted = await prisma.nWFilter.deleteMany({
      where: {
        internalName: {
          startsWith: 'ibay-'
        }
      }
    })

    console.log(`\n✅ Removed ${removed} filters from libvirt`)
    console.log(`✅ Removed ${deleted.count} filters from database`)
  } finally {
    if (conn) conn.close()
    await prisma.$disconnect()
  }
}

// Run the appropriate cleanup
if (forceCleanAll) {
  forceCleanAllFilters()
    .catch(err => {
      console.error('❌ Unexpected error:', err)
      process.exit(1)
    })
} else {
  cleanupOrphanedNwfilters()
    .catch(err => {
      console.error('❌ Unexpected error:', err)
      process.exit(1)
    })
}
