/**
 * Package management CLI commands
 *
 * Usage:
 *   infinibay package list                    - List installed packages
 *   infinibay package info <name>             - Show package details
 *   infinibay package install <path>          - Install from tar.gz
 *   infinibay package enable <name>           - Enable a package
 *   infinibay package disable <name>          - Disable a package
 *   infinibay package uninstall <name>        - Remove a package
 *   infinibay package license activate <name> <key> - Activate license
 *   infinibay package license status <name>   - Show license status
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as tar from 'tar'
import * as os from 'os'
import { createHash } from 'crypto'
import { success, error, warn, info, heading, table, colors } from '../utils/output'
import { PackageManifestSchema } from '../../../app/services/packages/types'
import { CapabilityManager, formatCapabilitiesForDisplay } from '../../../app/services/packages/CapabilityManager'
import { getLicenseValidator } from '../../../app/services/packages/LicenseValidator'

const prisma = new PrismaClient()
const EXTERNAL_PACKAGES_DIR = '/var/infinibay/packages'

export async function handlePackageCommand(args: string[]): Promise<void> {
  const subcommand = args[0]
  const rest = args.slice(1)

  try {
    switch (subcommand) {
      case 'list':
      case 'ls':
        await listPackages()
        break
      case 'info':
        await showPackageInfo(rest[0])
        break
      case 'install':
        await installPackage(rest[0])
        break
      case 'enable':
        await setPackageEnabled(rest[0], true)
        break
      case 'disable':
        await setPackageEnabled(rest[0], false)
        break
      case 'uninstall':
      case 'remove':
        await uninstallPackage(rest[0])
        break
      case 'license':
        await handleLicenseCommand(rest)
        break
      default:
        printPackageHelp()
    }
  } finally {
    await prisma.$disconnect()
  }
}

function printPackageHelp(): void {
  heading('Package Management')
  console.log(`
Usage: infinibay package <command> [options]

Commands:
  list, ls              List all installed packages
  info <name>           Show detailed information about a package
  install <path>        Install a package from tar.gz file
  enable <name>         Enable a disabled package
  disable <name>        Disable a package (keeps files)
  uninstall <name>      Remove a package completely
  license <subcommand>  Manage package licenses

License Subcommands:
  license activate <name> <key>   Activate a license for a commercial package
  license status [name]           Show license status (all or specific package)
  license revoke <name>           Revoke/deactivate a license

Examples:
  infinibay package list
  infinibay package install ./ai-diagnostics-1.0.0.tar.gz
  infinibay package info ai-diagnostics
  infinibay package disable ai-diagnostics
  infinibay package license activate ai-diagnostics XXXX-XXXX-XXXX-XXXX
  infinibay package license status
`)
}

async function listPackages(): Promise<void> {
  const packages = await prisma.package.findMany({
    include: { checkers: true },
    orderBy: { name: 'asc' }
  })

  if (packages.length === 0) {
    info('No packages installed')
    return
  }

  heading('Installed Packages')

  const rows = packages.map(pkg => [
    pkg.name,
    pkg.version,
    pkg.isEnabled ? `${colors.green}enabled${colors.reset}` : `${colors.gray}disabled${colors.reset}`,
    pkg.license,
    pkg.isBuiltin ? 'builtin' : 'external',
    `${pkg.checkers.length} checker(s)`
  ])

  table(['NAME', 'VERSION', 'STATUS', 'LICENSE', 'TYPE', 'CHECKERS'], rows)
}

async function showPackageInfo(name: string): Promise<void> {
  if (!name) {
    error('Package name required')
    return
  }

  const pkg = await prisma.package.findUnique({
    where: { name },
    include: { checkers: true }
  })

  if (!pkg) {
    error(`Package not found: ${name}`)
    return
  }

  heading(`Package: ${pkg.displayName}`)
  console.log(`
  Name:        ${pkg.name}
  Version:     ${pkg.version}
  Author:      ${pkg.author}
  License:     ${pkg.license}
  Type:        ${pkg.isBuiltin ? 'Built-in' : 'External'}
  Status:      ${pkg.isEnabled ? 'Enabled' : 'Disabled'}
  Installed:   ${pkg.installedAt.toISOString()}

  Description: ${pkg.description || 'No description'}

  Checkers (${pkg.checkers.length}):
`)

  for (const checker of pkg.checkers) {
    console.log(`    - ${checker.name} (${checker.type}) ${checker.isEnabled ? '' : '[disabled]'}`)
  }

  const capabilities = pkg.capabilities as Record<string, any>
  if (capabilities && Object.keys(capabilities).length > 0) {
    console.log('\n  Capabilities:')
    const descriptions = CapabilityManager.describeCapabilities(capabilities)
    for (const desc of descriptions) {
      console.log(`    - ${desc}`)
    }
  }
}

async function installPackage(tarPath: string): Promise<void> {
  if (!tarPath) {
    error('Package path required')
    console.log('Usage: infinibay package install <path-to-package.tar.gz>')
    return
  }

  if (!fs.existsSync(tarPath)) {
    error(`File not found: ${tarPath}`)
    return
  }

  info(`Installing package from ${tarPath}...`)

  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinibay-pkg-'))

  try {
    // Extract tar.gz
    info('Extracting package...')
    await tar.extract({
      file: tarPath,
      cwd: tempDir
    })

    // Find extracted directory (might be nested)
    const entries = fs.readdirSync(tempDir)
    let packageDir = tempDir
    if (entries.length === 1 && fs.statSync(path.join(tempDir, entries[0])).isDirectory()) {
      packageDir = path.join(tempDir, entries[0])
    }

    // Read and validate manifest
    const manifestPath = path.join(packageDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      error('Invalid package: manifest.json not found')
      return
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
    const manifestJson = JSON.parse(manifestContent)

    const parseResult = PackageManifestSchema.safeParse(manifestJson)
    if (!parseResult.success) {
      error('Invalid manifest.json:')
      console.log(parseResult.error.format())
      return
    }

    const manifest = parseResult.data

    // Validate capabilities
    const capabilityWarnings = CapabilityManager.validateCapabilities(manifest.capabilities || {})
    if (capabilityWarnings.length > 0) {
      warn('Capability warnings:')
      for (const warning of capabilityWarnings) {
        console.log(`  - ${warning}`)
      }
    }

    // Check if already installed
    const existing = await prisma.package.findUnique({
      where: { name: manifest.name }
    })

    if (existing) {
      warn(`Package ${manifest.name} is already installed (v${existing.version})`)
      // TODO: Add upgrade logic
      return
    }

    // Show package info
    heading(`Package: ${manifest.displayName}`)
    console.log(`
  Name:        ${manifest.name}
  Version:     ${manifest.version}
  Author:      ${manifest.author}
  License:     ${manifest.license}
  Checkers:    ${manifest.checkers.length}
`)

    // Mostrar capabilities requeridas
    if (manifest.capabilities && Object.keys(manifest.capabilities).length > 0) {
      heading('Capabilities Required')
      console.log(formatCapabilitiesForDisplay(manifest.capabilities))
      console.log('')
    }

    // For now, auto-approve (in production, prompt for confirmation)
    info('Installing...')

    // Ensure external packages directory exists
    if (!fs.existsSync(EXTERNAL_PACKAGES_DIR)) {
      fs.mkdirSync(EXTERNAL_PACKAGES_DIR, { recursive: true })
    }

    // Move to final location
    const finalPath = path.join(EXTERNAL_PACKAGES_DIR, manifest.name)
    if (fs.existsSync(finalPath)) {
      fs.rmSync(finalPath, { recursive: true })
    }
    fs.cpSync(packageDir, finalPath, { recursive: true })

    // Calculate manifest hash
    const manifestHash = createHash('sha256').update(manifestContent).digest('hex')

    // Create database records
    await prisma.package.create({
      data: {
        name: manifest.name,
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        isBuiltin: false,
        isEnabled: true,
        capabilities: (manifest.capabilities || {}) as object,
        settings: {},
        manifestHash,
        checkers: {
          create: manifest.checkers.map((c: { name: string; type: string; dataNeeds?: string[] }) => ({
            name: c.name,
            type: c.type,
            dataNeeds: c.dataNeeds || [],
            isEnabled: true
          }))
        }
      }
    })

    success(`Package ${manifest.name} v${manifest.version} installed successfully!`)
    info('Restart the backend to load the new package')

  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function setPackageEnabled(name: string, enabled: boolean): Promise<void> {
  if (!name) {
    error('Package name required')
    return
  }

  const pkg = await prisma.package.findUnique({ where: { name } })

  if (!pkg) {
    error(`Package not found: ${name}`)
    return
  }

  if (pkg.isBuiltin) {
    error('Cannot enable/disable built-in packages')
    return
  }

  await prisma.package.update({
    where: { name },
    data: { isEnabled: enabled }
  })

  success(`Package ${name} ${enabled ? 'enabled' : 'disabled'}`)
  info('Restart the backend for changes to take effect')
}

async function uninstallPackage(name: string): Promise<void> {
  if (!name) {
    error('Package name required')
    return
  }

  const pkg = await prisma.package.findUnique({ where: { name } })

  if (!pkg) {
    error(`Package not found: ${name}`)
    return
  }

  if (pkg.isBuiltin) {
    error('Cannot uninstall built-in packages')
    return
  }

  info(`Uninstalling ${name}...`)

  // Delete from database (cascade deletes checkers)
  await prisma.package.delete({ where: { name } })

  // Delete files
  const packagePath = path.join(EXTERNAL_PACKAGES_DIR, name)
  if (fs.existsSync(packagePath)) {
    fs.rmSync(packagePath, { recursive: true })
  }

  success(`Package ${name} uninstalled`)
  info('Restart the backend for changes to take effect')
}

// ============================================================================
// LICENSE MANAGEMENT
// ============================================================================

async function handleLicenseCommand(args: string[]): Promise<void> {
  const subcommand = args[0]
  const rest = args.slice(1)

  const validator = getLicenseValidator(prisma)

  switch (subcommand) {
    case 'activate':
      await activateLicense(validator, rest[0], rest[1])
      break
    case 'status':
      await showLicenseStatus(validator, rest[0])
      break
    case 'revoke':
      await revokeLicense(validator, rest[0])
      break
    default:
      heading('License Management')
      console.log(`
Usage: infinibay package license <command> [options]

Commands:
  activate <name> <key>   Activate a license for a commercial package
  status [name]           Show license status (all or specific package)
  revoke <name>           Revoke/deactivate a license

Examples:
  infinibay package license activate ai-diagnostics XXXX-XXXX-XXXX-XXXX
  infinibay package license status
  infinibay package license status ai-diagnostics
  infinibay package license revoke ai-diagnostics
`)
  }
}

async function activateLicense(
  validator: ReturnType<typeof getLicenseValidator>,
  packageName: string,
  licenseKey: string
): Promise<void> {
  if (!packageName) {
    error('Package name required')
    console.log('Usage: infinibay package license activate <name> <key>')
    return
  }

  if (!licenseKey) {
    error('License key required')
    console.log('Usage: infinibay package license activate <name> <key>')
    return
  }

  info(`Activating license for ${packageName}...`)

  const result = await validator.activateLicense({
    packageName,
    licenseKey
  })

  if (result.isValid) {
    success(result.message)
    if (result.license) {
      console.log(`
  License Type:  ${result.license.licenseType}
  Expires:       ${result.license.expiresAt ? result.license.expiresAt.toLocaleDateString() : 'Never'}
  Max Machines:  ${result.license.maxMachines || 'Unlimited'}
`)
    }
  } else {
    error(result.message)
  }
}

async function showLicenseStatus(
  validator: ReturnType<typeof getLicenseValidator>,
  packageName?: string
): Promise<void> {
  if (packageName) {
    // Show specific package
    const result = await validator.validatePackageLicense(packageName)

    heading(`License Status: ${packageName}`)

    if (result.license) {
      const license = result.license
      const statusColor = license.isValid ? colors.green : colors.red

      console.log(`
  Status:        ${statusColor}${license.validationStatus}${colors.reset}
  License Key:   ${license.licenseKey}
  License Type:  ${license.licenseType}
  Expires:       ${license.expiresAt ? license.expiresAt.toLocaleDateString() : 'Never'}
  Days Left:     ${license.daysRemaining !== null ? license.daysRemaining : 'N/A'}
  Max Machines:  ${license.maxMachines || 'Unlimited'}
  Grace Period:  ${license.gracePeriodActive ? 'Active' : 'No'}
`)
    } else {
      warn(result.message)
    }
  } else {
    // Show all licenses
    const licenses = await validator.getAllLicenses()

    if (licenses.length === 0) {
      info('No commercial packages installed')
      return
    }

    heading('Package Licenses')

    const rows = licenses.map(license => [
      license.packageName,
      license.licenseType,
      license.isValid
        ? `${colors.green}${license.validationStatus}${colors.reset}`
        : `${colors.red}${license.validationStatus}${colors.reset}`,
      license.expiresAt ? license.expiresAt.toLocaleDateString() : 'Never',
      license.daysRemaining !== null ? String(license.daysRemaining) : 'N/A'
    ])

    table(['PACKAGE', 'TYPE', 'STATUS', 'EXPIRES', 'DAYS LEFT'], rows)
  }
}

async function revokeLicense(
  validator: ReturnType<typeof getLicenseValidator>,
  packageName: string
): Promise<void> {
  if (!packageName) {
    error('Package name required')
    console.log('Usage: infinibay package license revoke <name>')
    return
  }

  info(`Revoking license for ${packageName}...`)

  const result = await validator.revokeLicense(packageName)

  if (result) {
    success(`License revoked for ${packageName}`)
    warn('The package will no longer be able to execute until a new license is activated')
  } else {
    error(`No license found for package: ${packageName}`)
  }
}
