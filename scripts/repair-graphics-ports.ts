/**
 * repair-graphics-ports.ts
 *
 * Data repair script for legacy graphics port configurations.
 * This script iterates over all MachineConfiguration rows with
 * graphicPort = -1 or null and assigns valid free ports using
 * the GraphicPortService.repairGraphicPort() method.
 *
 * Usage:
 *   npx ts-node scripts/repair-graphics-ports.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be repaired without making changes
 */

import { PrismaClient } from '@prisma/client'
import { GraphicPortService } from '../app/utils/VirtManager/graphicPortService'

const prisma = new PrismaClient()

interface RepairResult {
  machineId: string
  machineName: string
  internalName: string
  previousPort: number | null
  newPort: number | null
  success: boolean
  error?: string
}

async function repairGraphicsPorts (dryRun: boolean = false): Promise<void> {
  console.log('='.repeat(60))
  console.log('Graphics Port Repair Script')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}`)
  console.log('')

  try {
    // Find all machines with invalid graphics ports (null or -1)
    const machinesWithInvalidPorts = await prisma.machine.findMany({
      where: {
        configuration: {
          OR: [
            { graphicPort: null },
            { graphicPort: -1 }
          ]
        }
      },
      include: {
        configuration: true
      }
    })

    console.log(`Found ${machinesWithInvalidPorts.length} machine(s) with invalid graphics ports`)
    console.log('')

    if (machinesWithInvalidPorts.length === 0) {
      console.log('No repairs needed. All graphics ports are valid.')
      return
    }

    const graphicPortService = new GraphicPortService(prisma)
    const results: RepairResult[] = []

    for (const machine of machinesWithInvalidPorts) {
      const previousPort = machine.configuration?.graphicPort ?? null
      console.log(`Processing: ${machine.name} (${machine.id})`)
      console.log(`  - Internal Name: ${machine.internalName}`)
      console.log(`  - Current Port: ${previousPort}`)
      console.log(`  - Protocol: ${machine.configuration?.graphicProtocol || 'not set'}`)

      if (dryRun) {
        console.log('  - [DRY RUN] Would attempt to repair this configuration')
        results.push({
          machineId: machine.id,
          machineName: machine.name,
          internalName: machine.internalName,
          previousPort,
          newPort: null,
          success: true,
          error: 'Dry run - no changes made'
        })
      } else {
        const repairResult = await graphicPortService.repairGraphicPort(machine.id)

        if (repairResult.success) {
          console.log(`  - ✓ Repaired: assigned port ${repairResult.port}`)
          results.push({
            machineId: machine.id,
            machineName: machine.name,
            internalName: machine.internalName,
            previousPort,
            newPort: repairResult.port ?? null,
            success: true
          })
        } else {
          console.log(`  - ✗ Failed: ${repairResult.error}`)
          results.push({
            machineId: machine.id,
            machineName: machine.name,
            internalName: machine.internalName,
            previousPort,
            newPort: null,
            success: false,
            error: repairResult.error
          })
        }
      }
      console.log('')
    }

    // Summary
    console.log('='.repeat(60))
    console.log('SUMMARY')
    console.log('='.repeat(60))

    const successCount = results.filter(r => r.success && !r.error?.includes('Dry run')).length
    const failCount = results.filter(r => !r.success).length
    const dryRunCount = results.filter(r => r.error?.includes('Dry run')).length

    if (dryRun) {
      console.log(`Would repair: ${dryRunCount} configuration(s)`)
    } else {
      console.log(`Successfully repaired: ${successCount} configuration(s)`)
      console.log(`Failed to repair: ${failCount} configuration(s)`)
    }

    if (failCount > 0) {
      console.log('')
      console.log('Failed repairs:')
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.machineName} (${r.machineId}): ${r.error}`)
      })
    }

    console.log('')
    console.log('Repair script completed.')
  } catch (error) {
    console.error('Fatal error during repair:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

async function main (): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  await repairGraphicsPorts(dryRun)
}

main().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
