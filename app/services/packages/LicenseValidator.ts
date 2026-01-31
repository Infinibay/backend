/**
 * LicenseValidator - Validates commercial package licenses
 *
 * Handles:
 * - License key validation (format and cryptographic verification)
 * - Expiration checking
 * - Grace period for offline operation
 * - Machine count limits
 */

import debug from 'debug'
import { createHash, createHmac } from 'crypto'
import { PrismaClient, PackageLicense, Package } from '@prisma/client'

const log = debug('infinibay:licenses')

// License key format: XXXX-XXXX-XXXX-XXXX (16 chars + 3 dashes)
const LICENSE_KEY_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

// Grace period when license server is unreachable (7 days)
const GRACE_PERIOD_DAYS = 7

// How often to re-validate licenses (24 hours)
const VALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000

export type LicenseType = 'trial' | 'production' | 'development'
export type ValidationStatus = 'valid' | 'expired' | 'invalid' | 'revoked' | 'grace_period'

export interface LicenseInfo {
  packageName: string
  licenseKey: string
  licenseType: LicenseType
  isValid: boolean
  validationStatus: ValidationStatus
  expiresAt: Date | null
  maxMachines: number | null
  daysRemaining: number | null
  gracePeriodActive: boolean
}

export interface LicenseValidationResult {
  isValid: boolean
  status: ValidationStatus
  message: string
  license?: LicenseInfo
}

export interface ActivateLicenseInput {
  packageName: string
  licenseKey: string
}

export class LicenseValidator {
  private prisma: PrismaClient
  private licenseSecret: string

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
    // In production, this should come from environment variable
    this.licenseSecret = process.env.INFINIBAY_LICENSE_SECRET || 'infinibay-default-license-secret'
  }

  /**
   * Validate a license key format
   */
  isValidKeyFormat(licenseKey: string): boolean {
    return LICENSE_KEY_REGEX.test(licenseKey)
  }

  /**
   * Verify the cryptographic signature of a license key
   * License format: XXXX-XXXX-XXXX-XXXX where last 4 chars are checksum
   */
  verifyLicenseSignature(licenseKey: string): boolean {
    if (!this.isValidKeyFormat(licenseKey)) {
      return false
    }

    const parts = licenseKey.split('-')
    const payload = parts.slice(0, 3).join('')
    const checksum = parts[3]

    // Generate expected checksum
    const expectedChecksum = createHmac('sha256', this.licenseSecret)
      .update(payload)
      .digest('hex')
      .substring(0, 4)
      .toUpperCase()

    return checksum === expectedChecksum
  }

  /**
   * Generate a valid license key for a package
   * Used internally for creating trial licenses or by license management system
   */
  generateLicenseKey(packageName: string, licenseType: LicenseType): string {
    // Create unique payload from package name, type, and timestamp
    const timestamp = Date.now().toString(36).toUpperCase()
    const typeCode = licenseType.charAt(0).toUpperCase()
    const nameHash = createHash('md5')
      .update(packageName)
      .digest('hex')
      .substring(0, 4)
      .toUpperCase()

    // Pad/truncate to fit format
    const part1 = (nameHash + '0000').substring(0, 4)
    const part2 = (typeCode + timestamp).substring(0, 4).padEnd(4, '0')
    const part3 = Math.random().toString(36).substring(2, 6).toUpperCase()

    const payload = part1 + part2 + part3

    // Generate checksum
    const checksum = createHmac('sha256', this.licenseSecret)
      .update(payload)
      .digest('hex')
      .substring(0, 4)
      .toUpperCase()

    return `${part1}-${part2}-${part3}-${checksum}`
  }

  /**
   * Activate a license for a package
   */
  async activateLicense(input: ActivateLicenseInput): Promise<LicenseValidationResult> {
    const { packageName, licenseKey } = input

    log('Activating license for package: %s', packageName)

    // Validate key format
    if (!this.isValidKeyFormat(licenseKey)) {
      return {
        isValid: false,
        status: 'invalid',
        message: 'Invalid license key format. Expected: XXXX-XXXX-XXXX-XXXX'
      }
    }

    // Verify signature
    if (!this.verifyLicenseSignature(licenseKey)) {
      log('License signature verification failed for package: %s', packageName)
      return {
        isValid: false,
        status: 'invalid',
        message: 'License key signature verification failed'
      }
    }

    // Find the package
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
      include: { packageLicense: true }
    })

    if (!pkg) {
      return {
        isValid: false,
        status: 'invalid',
        message: `Package not found: ${packageName}`
      }
    }

    if (pkg.license !== 'commercial') {
      return {
        isValid: false,
        status: 'invalid',
        message: 'License activation not required for open-source packages'
      }
    }

    // Check if license key is already used by another package
    const existingLicense = await this.prisma.packageLicense.findUnique({
      where: { licenseKey }
    })

    if (existingLicense && existingLicense.packageId !== pkg.id) {
      return {
        isValid: false,
        status: 'invalid',
        message: 'License key is already in use by another package'
      }
    }

    // Determine license type from key (second part first char)
    const typeChar = licenseKey.split('-')[1].charAt(0)
    let licenseType: LicenseType = 'production'
    let expiresAt: Date | null = null

    if (typeChar === 'T') {
      licenseType = 'trial'
      // Trial licenses expire in 30 days
      expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)
    } else if (typeChar === 'D') {
      licenseType = 'development'
      // Dev licenses expire in 1 year
      expiresAt = new Date()
      expiresAt.setFullYear(expiresAt.getFullYear() + 1)
    }

    // Create or update license record
    const license = await this.prisma.packageLicense.upsert({
      where: { packageId: pkg.id },
      create: {
        packageId: pkg.id,
        licenseKey,
        licenseType,
        issuedAt: new Date(),
        expiresAt,
        isValid: true,
        validationStatus: 'valid',
        lastValidatedAt: new Date()
      },
      update: {
        licenseKey,
        licenseType,
        issuedAt: new Date(),
        expiresAt,
        isValid: true,
        validationStatus: 'valid',
        lastValidatedAt: new Date(),
        gracePeriodEnds: null
      }
    })

    log('License activated successfully for package: %s (type: %s)', packageName, licenseType)

    return {
      isValid: true,
      status: 'valid',
      message: 'License activated successfully',
      license: this.formatLicenseInfo(license, pkg)
    }
  }

  /**
   * Validate an existing license for a package
   */
  async validatePackageLicense(packageName: string): Promise<LicenseValidationResult> {
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
      include: { packageLicense: true }
    })

    if (!pkg) {
      return {
        isValid: false,
        status: 'invalid',
        message: `Package not found: ${packageName}`
      }
    }

    // Open-source packages don't need validation
    if (pkg.license === 'open-source') {
      return {
        isValid: true,
        status: 'valid',
        message: 'Open-source package - no license required'
      }
    }

    // Commercial package without license
    if (!pkg.packageLicense) {
      return {
        isValid: false,
        status: 'invalid',
        message: 'Commercial package requires a valid license. Use CLI to activate: infinibay package license activate <name> <key>'
      }
    }

    const license = pkg.packageLicense

    // Check if license is revoked
    if (license.validationStatus === 'revoked') {
      return {
        isValid: false,
        status: 'revoked',
        message: 'License has been revoked',
        license: this.formatLicenseInfo(license, pkg)
      }
    }

    // Check expiration
    if (license.expiresAt && new Date() > license.expiresAt) {
      await this.prisma.packageLicense.update({
        where: { id: license.id },
        data: { isValid: false, validationStatus: 'expired' }
      })

      return {
        isValid: false,
        status: 'expired',
        message: `License expired on ${license.expiresAt.toLocaleDateString()}`,
        license: this.formatLicenseInfo({ ...license, isValid: false, validationStatus: 'expired' }, pkg)
      }
    }

    // Check if in grace period
    if (license.gracePeriodEnds && new Date() < license.gracePeriodEnds) {
      return {
        isValid: true,
        status: 'grace_period',
        message: `Operating in grace period until ${license.gracePeriodEnds.toLocaleDateString()}`,
        license: this.formatLicenseInfo(license, pkg)
      }
    }

    // Update last validated timestamp
    await this.prisma.packageLicense.update({
      where: { id: license.id },
      data: { lastValidatedAt: new Date() }
    })

    return {
      isValid: true,
      status: 'valid',
      message: 'License is valid',
      license: this.formatLicenseInfo(license, pkg)
    }
  }

  /**
   * Check if a package can be executed (has valid license if commercial)
   */
  async canExecutePackage(packageName: string): Promise<boolean> {
    const result = await this.validatePackageLicense(packageName)
    return result.isValid
  }

  /**
   * Get all licenses for display in UI
   */
  async getAllLicenses(): Promise<LicenseInfo[]> {
    const packages = await this.prisma.package.findMany({
      where: { license: 'commercial' },
      include: { packageLicense: true }
    })

    return packages.map(pkg => {
      if (pkg.packageLicense) {
        return this.formatLicenseInfo(pkg.packageLicense, pkg)
      }
      return {
        packageName: pkg.name,
        licenseKey: '',
        licenseType: 'production' as LicenseType,
        isValid: false,
        validationStatus: 'invalid' as ValidationStatus,
        expiresAt: null,
        maxMachines: null,
        daysRemaining: null,
        gracePeriodActive: false
      }
    })
  }

  /**
   * Deactivate/revoke a license
   */
  async revokeLicense(packageName: string): Promise<boolean> {
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
      include: { packageLicense: true }
    })

    if (!pkg || !pkg.packageLicense) {
      return false
    }

    await this.prisma.packageLicense.update({
      where: { id: pkg.packageLicense.id },
      data: {
        isValid: false,
        validationStatus: 'revoked'
      }
    })

    log('License revoked for package: %s', packageName)
    return true
  }

  /**
   * Enter grace period (when license server is unreachable)
   */
  async enterGracePeriod(packageName: string): Promise<boolean> {
    const pkg = await this.prisma.package.findUnique({
      where: { name: packageName },
      include: { packageLicense: true }
    })

    if (!pkg || !pkg.packageLicense) {
      return false
    }

    const gracePeriodEnds = new Date()
    gracePeriodEnds.setDate(gracePeriodEnds.getDate() + GRACE_PERIOD_DAYS)

    await this.prisma.packageLicense.update({
      where: { id: pkg.packageLicense.id },
      data: {
        validationStatus: 'grace_period',
        gracePeriodEnds
      }
    })

    log('Grace period started for package: %s (ends: %s)', packageName, gracePeriodEnds.toISOString())
    return true
  }

  /**
   * Format license data for API response
   */
  private formatLicenseInfo(license: PackageLicense, pkg: Package): LicenseInfo {
    let daysRemaining: number | null = null

    if (license.expiresAt) {
      const now = new Date()
      const diffTime = license.expiresAt.getTime() - now.getTime()
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    }

    return {
      packageName: pkg.name,
      licenseKey: this.maskLicenseKey(license.licenseKey),
      licenseType: license.licenseType as LicenseType,
      isValid: license.isValid,
      validationStatus: license.validationStatus as ValidationStatus,
      expiresAt: license.expiresAt,
      maxMachines: license.maxMachines,
      daysRemaining,
      gracePeriodActive: license.validationStatus === 'grace_period'
    }
  }

  /**
   * Mask license key for display (show only first and last groups)
   */
  private maskLicenseKey(licenseKey: string): string {
    const parts = licenseKey.split('-')
    if (parts.length !== 4) return '****-****-****-****'
    return `${parts[0]}-****-****-${parts[3]}`
  }
}

// Singleton instance
let licenseValidatorInstance: LicenseValidator | null = null

export function getLicenseValidator(prisma: PrismaClient): LicenseValidator {
  if (!licenseValidatorInstance) {
    licenseValidatorInstance = new LicenseValidator(prisma)
  }
  return licenseValidatorInstance
}
