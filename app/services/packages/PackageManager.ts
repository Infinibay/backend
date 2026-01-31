import debug from 'debug'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import { PrismaClient } from '@prisma/client'
import {
  PackageManifestSchema,
  PackageManifest,
  PackageStatus,
  PackageCheckerContext,
  PackageCheckerResult
} from './types'
import { PackageWorker } from './PackageWorker'
import { getLicenseValidator } from './LicenseValidator'

const log = debug('infinibay:packages')

// Interfaz que deben implementar los checkers de paquetes
export interface IPackageChecker {
  analyze(context: PackageCheckerContext): Promise<PackageCheckerResult[]>
}

// Paquete cargado en memoria
interface LoadedPackage {
  manifest: PackageManifest
  path: string
  isBuiltin: boolean
  checkers: Map<string, IPackageChecker>
  loadedAt: Date
}

export class PackageManager {
  private loadedPackages: Map<string, LoadedPackage> = new Map()
  private externalWorkers: Map<string, PackageWorker> = new Map()
  private prisma: PrismaClient

  // Directorios de paquetes
  private builtinPackagesDir: string
  private externalPackagesDir: string

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
    // Paths relativos al root del backend
    this.builtinPackagesDir = path.resolve(__dirname, '../../../packages')
    this.externalPackagesDir = '/var/infinibay/packages'
  }

  /**
   * Carga todos los paquetes (built-in y externos)
   */
  async loadAll(): Promise<void> {
    log('Loading all packages...')

    // Cargar built-in packages
    await this.loadBuiltinPackages()

    // Cargar external packages
    await this.loadExternalPackages()

    log('Loaded %d packages (%d builtin, %d external)',
      this.loadedPackages.size + this.externalWorkers.size,
      this.loadedPackages.size,
      this.externalWorkers.size)
  }

  /**
   * Carga paquetes built-in desde backend/app/packages/
   */
  private async loadBuiltinPackages(): Promise<void> {
    if (!existsSync(this.builtinPackagesDir)) {
      log('Built-in packages directory does not exist: %s', this.builtinPackagesDir)
      return
    }

    const entries = await fs.readdir(this.builtinPackagesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const packagePath = path.join(this.builtinPackagesDir, entry.name)
      try {
        await this.loadPackage(packagePath, true)
      } catch (error) {
        log('Failed to load built-in package %s: %s', entry.name, error)
      }
    }
  }

  /**
   * Carga paquetes externos desde /var/infinibay/packages/
   * Los paquetes externos se ejecutan en workers aislados
   */
  private async loadExternalPackages(): Promise<void> {
    if (!existsSync(this.externalPackagesDir)) {
      log('External packages directory does not exist: %s', this.externalPackagesDir)
      return
    }

    const entries = await fs.readdir(this.externalPackagesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const packagePath = path.join(this.externalPackagesDir, entry.name)
      try {
        await this.loadExternalPackage(packagePath)
      } catch (error) {
        log('Failed to load external package %s: %s', entry.name, error)
      }
    }
  }

  /**
   * Carga un paquete externo individual usando PackageWorker
   */
  private async loadExternalPackage(packagePath: string): Promise<void> {
    const manifestPath = path.join(packagePath, 'manifest.json')

    if (!existsSync(manifestPath)) {
      throw new Error(`Missing manifest.json in ${packagePath}`)
    }

    // Leer y parsear manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    const manifestJson = JSON.parse(manifestContent)

    // Validar manifest
    const parseResult = PackageManifestSchema.safeParse(manifestJson)
    if (!parseResult.success) {
      throw new Error(`Invalid manifest: ${parseResult.error.format()}`)
    }

    const manifest = parseResult.data

    // Verificar que no existe ya un paquete con el mismo nombre
    if (this.loadedPackages.has(manifest.name) || this.externalWorkers.has(manifest.name)) {
      throw new Error(`Package ${manifest.name} already loaded`)
    }

    // Calcular hash del manifest
    const manifestHash = createHash('sha256').update(manifestContent).digest('hex')

    // Crear y spawnar el worker
    const worker = new PackageWorker(packagePath, manifest)

    try {
      await worker.spawn()
      this.externalWorkers.set(manifest.name, worker)

      // Sincronizar con base de datos
      await this.syncPackageToDatabase(manifest, manifestHash, false)

      log('Loaded external package: %s v%s', manifest.name, manifest.version)
    } catch (error) {
      log('Failed to spawn worker for package %s: %s', manifest.name, error)
      throw error
    }
  }

  /**
   * Carga un paquete individual
   */
  private async loadPackage(packagePath: string, isBuiltin: boolean): Promise<void> {
    const manifestPath = path.join(packagePath, 'manifest.json')

    if (!existsSync(manifestPath)) {
      throw new Error(`Missing manifest.json in ${packagePath}`)
    }

    // Leer y parsear manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8')
    const manifestJson = JSON.parse(manifestContent)

    // Validar manifest
    const parseResult = PackageManifestSchema.safeParse(manifestJson)
    if (!parseResult.success) {
      throw new Error(`Invalid manifest: ${parseResult.error.format()}`)
    }

    const manifest = parseResult.data

    // Calcular hash del manifest
    const manifestHash = createHash('sha256').update(manifestContent).digest('hex')

    // Cargar checkers
    const checkers = new Map<string, IPackageChecker>()
    for (const checkerDef of manifest.checkers) {
      const checkerPath = path.join(packagePath, checkerDef.file)
      if (!existsSync(checkerPath)) {
        log('Checker file not found: %s', checkerPath)
        continue
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const checkerModule = require(checkerPath)
        const CheckerClass = checkerModule.default || checkerModule[Object.keys(checkerModule)[0]]

        if (typeof CheckerClass === 'function') {
          checkers.set(checkerDef.name, new CheckerClass())
        } else if (typeof CheckerClass.analyze === 'function') {
          // Si exporta un objeto con método analyze
          checkers.set(checkerDef.name, CheckerClass)
        } else {
          log('Invalid checker export in %s', checkerPath)
        }
      } catch (error) {
        log('Failed to load checker %s: %s', checkerDef.name, error)
      }
    }

    // Guardar en memoria
    this.loadedPackages.set(manifest.name, {
      manifest,
      path: packagePath,
      isBuiltin,
      checkers,
      loadedAt: new Date()
    })

    // Sincronizar con base de datos
    await this.syncPackageToDatabase(manifest, manifestHash, isBuiltin)

    log('Loaded package: %s v%s (%d checkers)', manifest.name, manifest.version, checkers.size)
  }

  /**
   * Sincroniza paquete con la base de datos
   */
  private async syncPackageToDatabase(
    manifest: PackageManifest,
    manifestHash: string,
    isBuiltin: boolean
  ): Promise<void> {
    await this.prisma.package.upsert({
      where: { name: manifest.name },
      create: {
        name: manifest.name,
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        isBuiltin,
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
      },
      update: {
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        manifestHash,
        capabilities: (manifest.capabilities || {}) as object,
        // No actualizamos settings para preservar configuración del admin
      }
    })

    // Sincronizar checkers (crear nuevos, no eliminar existentes)
    for (const checkerDef of manifest.checkers) {
      const pkg = await this.prisma.package.findUnique({ where: { name: manifest.name } })
      if (!pkg) continue

      await this.prisma.packageChecker.upsert({
        where: {
          packageId_name: {
            packageId: pkg.id,
            name: checkerDef.name
          }
        },
        create: {
          packageId: pkg.id,
          name: checkerDef.name,
          type: checkerDef.type,
          dataNeeds: checkerDef.dataNeeds || [],
          isEnabled: true
        },
        update: {
          type: checkerDef.type,
          dataNeeds: checkerDef.dataNeeds || [],
        }
      })
    }
  }

  /**
   * Ejecuta un checker específico de un paquete
   */
  async executeChecker(
    packageName: string,
    checkerName: string,
    context: PackageCheckerContext
  ): Promise<PackageCheckerResult[]> {
    // Verificar si es un paquete externo
    const externalWorker = this.externalWorkers.get(packageName)
    if (externalWorker) {
      return await this.executeExternalChecker(packageName, externalWorker, context)
    }

    // Paquete built-in
    const pkg = this.loadedPackages.get(packageName)
    if (!pkg) {
      throw new Error(`Package not loaded: ${packageName}`)
    }

    const checker = pkg.checkers.get(checkerName)
    if (!checker) {
      throw new Error(`Checker not found: ${checkerName} in ${packageName}`)
    }

    // Verificar que el checker está habilitado
    const dbChecker = await this.prisma.packageChecker.findFirst({
      where: {
        package: { name: packageName },
        name: checkerName,
        isEnabled: true
      }
    })

    if (!dbChecker) {
      log('Checker %s/%s is disabled', packageName, checkerName)
      return []
    }

    // Obtener settings del paquete
    const dbPackage = await this.prisma.package.findUnique({
      where: { name: packageName }
    })

    // Merge settings con contexto
    const contextWithSettings: PackageCheckerContext = {
      ...context,
      settings: (dbPackage?.settings as Record<string, any>) || {}
    }

    return await checker.analyze(contextWithSettings)
  }

  /**
   * Check if a package has a valid license (for commercial packages)
   */
  private async checkPackageLicense(packageName: string): Promise<boolean> {
    const dbPackage = await this.prisma.package.findUnique({
      where: { name: packageName }
    })

    // Open-source and built-in packages don't need license validation
    if (!dbPackage || dbPackage.license === 'open-source' || dbPackage.isBuiltin) {
      return true
    }

    // Validate commercial package license
    const licenseValidator = getLicenseValidator(this.prisma)
    const result = await licenseValidator.validatePackageLicense(packageName)

    if (!result.isValid) {
      log('Package %s license validation failed: %s', packageName, result.message)
    }

    return result.isValid
  }

  /**
   * Ejecuta un checker de un paquete externo via worker
   */
  private async executeExternalChecker(
    packageName: string,
    worker: PackageWorker,
    context: PackageCheckerContext
  ): Promise<PackageCheckerResult[]> {
    // Verificar licencia para paquetes comerciales
    const hasValidLicense = await this.checkPackageLicense(packageName)
    if (!hasValidLicense) {
      log('Skipping external package %s - no valid license', packageName)
      return []
    }

    // Verificar que el paquete está habilitado
    const dbPackage = await this.prisma.package.findUnique({
      where: { name: packageName, isEnabled: true }
    })

    if (!dbPackage) {
      log('External package %s is disabled', packageName)
      return []
    }

    // Merge settings con contexto
    const contextWithSettings: PackageCheckerContext = {
      ...context,
      settings: (dbPackage.settings as Record<string, any>) || {}
    }

    // Ejecutar analyze en el worker
    return await worker.analyze(contextWithSettings)
  }

  /**
   * Ejecuta todos los checkers de todos los paquetes habilitados
   */
  async runAllCheckers(context: Omit<PackageCheckerContext, 'settings'>): Promise<PackageCheckerResult[]> {
    const results: PackageCheckerResult[] = []

    // Ejecutar checkers de paquetes built-in
    for (const [packageName, pkg] of this.loadedPackages) {
      // Verificar que el paquete está habilitado
      const dbPackage = await this.prisma.package.findUnique({
        where: { name: packageName, isEnabled: true }
      })

      if (!dbPackage) continue

      for (const [checkerName] of pkg.checkers) {
        try {
          const checkerResults = await this.executeChecker(packageName, checkerName, {
            ...context,
            settings: {}
          })
          results.push(...checkerResults)
        } catch (error) {
          log('Error executing checker %s/%s: %s', packageName, checkerName, error)
        }
      }
    }

    // Ejecutar checkers de paquetes externos
    for (const [packageName, worker] of this.externalWorkers) {
      try {
        const checkerResults = await this.executeExternalChecker(packageName, worker, {
          ...context,
          settings: {}
        })
        results.push(...checkerResults)
      } catch (error) {
        log('Error executing external package %s: %s', packageName, error)
      }
    }

    return results
  }

  /**
   * Obtiene el status de todos los paquetes
   */
  getPackageStatuses(): PackageStatus[] {
    const statuses: PackageStatus[] = []

    // Status de paquetes built-in
    for (const [name, pkg] of this.loadedPackages) {
      statuses.push({
        name,
        version: pkg.manifest.version,
        isLoaded: true,
        isEnabled: true, // TODO: leer de BD
        isBuiltin: pkg.isBuiltin,
        checkerCount: pkg.checkers.size,
        loadedAt: pkg.loadedAt
      })
    }

    // Status de paquetes externos (workers)
    for (const [name, worker] of this.externalWorkers) {
      statuses.push({
        name,
        version: '', // Worker no expone version directamente
        isLoaded: worker.isRunning(),
        isEnabled: true, // TODO: leer de BD
        isBuiltin: false,
        checkerCount: 0, // External workers no exponen conteo de checkers
        loadedAt: undefined
      })
    }

    return statuses
  }

  /**
   * Obtiene un paquete cargado
   */
  getPackage(name: string): LoadedPackage | undefined {
    return this.loadedPackages.get(name)
  }

  /**
   * Verifica si un paquete está cargado
   */
  isPackageLoaded(name: string): boolean {
    return this.loadedPackages.has(name) || this.externalWorkers.has(name)
  }

  /**
   * Verifica si un paquete externo está corriendo
   */
  isExternalPackageRunning(name: string): boolean {
    const worker = this.externalWorkers.get(name)
    return worker?.isRunning() ?? false
  }

  /**
   * Recarga todos los paquetes
   */
  async reload(): Promise<void> {
    // Shutdown external workers first
    await this.shutdown()

    this.loadedPackages.clear()
    await this.loadAll()
  }

  /**
   * Shutdown all external package workers
   */
  async shutdown(): Promise<void> {
    log('Shutting down %d external workers...', this.externalWorkers.size)

    const shutdownPromises: Promise<void>[] = []

    for (const [name, worker] of this.externalWorkers) {
      log('Shutting down worker: %s', name)
      shutdownPromises.push(worker.shutdown())
    }

    await Promise.allSettled(shutdownPromises)
    this.externalWorkers.clear()

    log('All external workers shut down')
  }
}

// Singleton
let packageManagerInstance: PackageManager | null = null

export function getPackageManager(prisma: PrismaClient): PackageManager {
  if (!packageManagerInstance) {
    packageManagerInstance = new PackageManager(prisma)
  }
  return packageManagerInstance
}
