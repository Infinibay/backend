/**
 * migrate-socket-paths.ts
 *
 * Migration script to update socket paths in existing VMs.
 * This script helps transition from the old subdirectory structure
 * (/opt/infinibay/infinivirt/{ga,tpm,infini}/) to the new flat structure
 * (/opt/infinibay/sockets/).
 *
 * The script clears socket paths for stopped VMs so they regenerate
 * with the new paths when started.
 *
 * Usage:
 *   npx ts-node scripts/migrate-socket-paths.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be migrated without making changes
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface MigrationResult {
  machineId: string
  machineName: string
  internalName: string
  status: string
  action: 'migrated' | 'skipped_running' | 'skipped_no_config'
  oldSocketPath?: string | null
}

async function migrateSocketPaths (dryRun: boolean = false): Promise<void> {
  console.log('='.repeat(60))
  console.log('Socket Path Migration Script')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`)
  console.log('')
  console.log('This script migrates VMs from the old socket structure:')
  console.log('  /opt/infinibay/infinivirt/{ga,tpm,infini}/')
  console.log('To the new flat structure:')
  console.log('  /opt/infinibay/sockets/')
  console.log('')

  try {
    // Find all machines with their configurations
    const machines = await prisma.machine.findMany({
      include: {
        configuration: true
      }
    })

    console.log(`Found ${machines.length} machine(s) to process`)
    console.log('')

    if (machines.length === 0) {
      console.log('No machines found. Nothing to migrate.')
      return
    }

    const results: MigrationResult[] = []

    for (const machine of machines) {
      const config = machine.configuration
      console.log(`Processing: ${machine.name} (${machine.internalName})`)
      console.log(`  - Status: ${machine.status}`)
      console.log(`  - QMP Socket: ${config?.qmpSocketPath || 'not set'}`)

      // Skip running VMs - they will migrate on next restart
      if (machine.status === 'running') {
        console.log('  - [SKIPPED] VM is running. Will migrate on next restart.')
        results.push({
          machineId: machine.id,
          machineName: machine.name,
          internalName: machine.internalName,
          status: machine.status,
          action: 'skipped_running',
          oldSocketPath: config?.qmpSocketPath
        })
        console.log('')
        continue
      }

      // Skip if no configuration
      if (!config) {
        console.log('  - [SKIPPED] No configuration found.')
        results.push({
          machineId: machine.id,
          machineName: machine.name,
          internalName: machine.internalName,
          status: machine.status,
          action: 'skipped_no_config'
        })
        console.log('')
        continue
      }

      // Clear all socket paths so they regenerate with new flat /opt/infinibay/sockets structure.
      // This includes:
      // - qmpSocketPath: QMP communication socket
      // - tpmSocketPath: TPM 2.0 emulator socket (Windows 11)
      // - guestAgentSocketPath: QEMU Guest Agent socket
      // - infiniServiceSocketPath: InfiniService custom channel socket
      // - qemuPid: Process ID (cleared since VM will need restart)
      if (dryRun) {
        console.log('  - [DRY RUN] Would clear all socket paths for regeneration')
      } else {
        await prisma.machineConfiguration.update({
          where: { id: config.id },
          data: {
            qmpSocketPath: null,
            qemuPid: null,
            tpmSocketPath: null,
            guestAgentSocketPath: null,
            infiniServiceSocketPath: null
          }
        })
        console.log('  - [MIGRATED] Cleared all socket paths (QMP, TPM, GA, InfiniService). Will regenerate on next start.')
      }

      results.push({
        machineId: machine.id,
        machineName: machine.name,
        internalName: machine.internalName,
        status: machine.status,
        action: 'migrated',
        oldSocketPath: config.qmpSocketPath
      })
      console.log('')
    }

    // Summary
    console.log('='.repeat(60))
    console.log('SUMMARY')
    console.log('='.repeat(60))

    const migratedCount = results.filter(r => r.action === 'migrated').length
    const skippedRunningCount = results.filter(r => r.action === 'skipped_running').length
    const skippedNoConfigCount = results.filter(r => r.action === 'skipped_no_config').length

    if (dryRun) {
      console.log(`Would migrate: ${migratedCount} VM(s)`)
    } else {
      console.log(`Migrated: ${migratedCount} VM(s)`)
    }
    console.log(`Skipped (running): ${skippedRunningCount} VM(s)`)
    console.log(`Skipped (no config): ${skippedNoConfigCount} VM(s)`)

    if (skippedRunningCount > 0) {
      console.log('')
      console.log('Running VMs will migrate automatically when restarted:')
      results.filter(r => r.action === 'skipped_running').forEach(r => {
        console.log(`  - ${r.machineName} (${r.internalName})`)
      })
    }

    console.log('')
    console.log('Migration script completed.')

    if (dryRun && migratedCount > 0) {
      console.log('')
      console.log('Run without --dry-run to apply these changes.')
    }
  } catch (error) {
    console.error('Fatal error during migration:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

async function main (): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Socket Path Migration Script

This script migrates existing VMs from the old socket directory structure
to the new flat structure used by VirtioSocketWatcherService.

Old structure: /opt/infinibay/infinivirt/{ga,tpm,infini}/*.sock
New structure: /opt/infinibay/sockets/*.sock

Usage:
  npx ts-node scripts/migrate-socket-paths.ts [options]

Options:
  --dry-run  Show what would be migrated without making changes
  --help     Show this help message

Notes:
  - Running VMs are skipped and will migrate on next restart
  - Stopped VMs have all socket paths cleared for regeneration:
    * qmpSocketPath - QMP communication socket
    * tpmSocketPath - TPM 2.0 emulator socket (Windows 11)
    * guestAgentSocketPath - QEMU Guest Agent socket
    * infiniServiceSocketPath - InfiniService custom channel socket
  - No data is lost - paths regenerate automatically on VM start with new flat structure
`)
    return
  }

  const dryRun = args.includes('--dry-run')
  await migrateSocketPaths(dryRun)
}

main().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
