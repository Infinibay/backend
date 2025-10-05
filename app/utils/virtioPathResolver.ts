import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { Debugger } from '@utils/debug'

const execAsync = promisify(exec)

/**
 * VirtIOPathResolver - Automatically detects VirtIO Windows drivers ISO location
 *
 * This utility searches for virtio-win ISO files across common locations used by
 * different Linux distributions and package managers.
 *
 * Search priority order:
 * 1. VIRTIO_WIN_ISO_PATH environment variable (explicit override)
 * 2. /usr/share/virtio-win/*.iso (Fedora/RHEL package installation)
 * 3. /var/lib/libvirt/images/virtio-win*.iso (Ubuntu 24.10+, new location)
 * 4. /opt/infinibay/iso/permanent/virtio-win*.iso (Infinibay managed)
 * 5. /var/lib/libvirt/driver/virtio-win*.iso (legacy Ubuntu location)
 *
 * The resolver caches the result to avoid repeated filesystem searches.
 */
export class VirtIOPathResolver {
  private static cachedPath: string | null = null
  private static debug = new Debugger('virtio-path-resolver')

  /**
   * Get search paths, including environment-configured directories
   */
  private static getSearchPaths(): string[] {
    const paths = [
      '/usr/share/virtio-win',           // Fedora/RHEL package: virtio-win
      '/var/lib/libvirt/images',         // Ubuntu 24.10+, new default location
      '/var/lib/libvirt/driver',         // Legacy Ubuntu location (pre-24.10)
    ]

    // Add Infinibay managed ISO directory if configured
    const permanentDir = process.env.INFINIBAY_ISO_PERMANENT_DIR
    if (permanentDir) {
      paths.splice(2, 0, permanentDir)  // Insert before legacy location
    } else {
      paths.splice(2, 0, '/opt/infinibay/iso/permanent')  // Default Infinibay location
    }

    return paths
  }

  /**
   * Resolves the path to virtio-win ISO file
   * @param forceRefresh - Force a new search even if cached result exists
   * @returns Absolute path to virtio-win ISO or null if not found
   */
  public static async resolve(forceRefresh: boolean = false): Promise<string | null> {
    // Return cached result if available and not forcing refresh
    if (this.cachedPath !== null && !forceRefresh) {
      this.debug.log('Returning cached VirtIO ISO path:', this.cachedPath)
      return this.cachedPath
    }

    this.debug.log('Searching for VirtIO Windows drivers ISO...')

    // Priority 1: Check environment variable
    const envPath = process.env.VIRTIO_WIN_ISO_PATH
    if (envPath) {
      if (fs.existsSync(envPath)) {
        this.debug.log('Found VirtIO ISO via environment variable:', envPath)
        this.cachedPath = envPath
        return envPath
      } else {
        this.debug.log('warning', `VIRTIO_WIN_ISO_PATH is set but file does not exist: ${envPath}`)
      }
    }

    // Priority 2-5: Search common filesystem locations
    const foundPath = await this.searchFilesystem()
    if (foundPath) {
      this.debug.log('Found VirtIO ISO at:', foundPath)
      this.cachedPath = foundPath
      return foundPath
    }

    // Priority 6: Try package manager queries (slower, so last resort)
    const pkgPath = await this.queryPackageManager()
    if (pkgPath) {
      this.debug.log('Found VirtIO ISO via package manager:', pkgPath)
      this.cachedPath = pkgPath
      return pkgPath
    }

    this.debug.log('warning', 'VirtIO Windows drivers ISO not found in any known location')
    this.logSearchHints()

    return null
  }

  /**
   * Searches filesystem locations for virtio-win ISO files
   */
  private static async searchFilesystem(): Promise<string | null> {
    const searchPaths = this.getSearchPaths()
    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) {
        continue
      }

      try {
        const files = fs.readdirSync(searchPath)
        const isoFile = files.find(f =>
          f.toLowerCase().startsWith('virtio-win') &&
          f.toLowerCase().endsWith('.iso')
        )

        if (isoFile) {
          const fullPath = path.join(searchPath, isoFile)
          // Verify it's actually a file and readable
          const stat = fs.statSync(fullPath)
          if (stat.isFile()) {
            return fullPath
          }
        }
      } catch (error) {
        this.debug.log('error', `Error reading directory ${searchPath}: ${String(error)}`)
      }
    }

    return null
  }

  /**
   * Queries package managers to find virtio-win ISO location
   * This is slower than filesystem search, so used as fallback
   */
  private static async queryPackageManager(): Promise<string | null> {
    // Try dpkg (Debian/Ubuntu)
    try {
      const { stdout } = await execAsync('dpkg -L virtio-win 2>/dev/null || true')
      const files = stdout.split('\n')
      const isoFile = files.find(f =>
        f.toLowerCase().endsWith('.iso') &&
        f.toLowerCase().includes('virtio-win')
      )
      if (isoFile && fs.existsSync(isoFile)) {
        return isoFile
      }
    } catch (error) {
      // dpkg not available or package not installed
    }

    // Try rpm (Fedora/RHEL/CentOS)
    try {
      const { stdout } = await execAsync('rpm -ql virtio-win 2>/dev/null || true')
      const files = stdout.split('\n')
      const isoFile = files.find(f =>
        f.toLowerCase().endsWith('.iso') &&
        f.toLowerCase().includes('virtio-win')
      )
      if (isoFile && fs.existsSync(isoFile)) {
        return isoFile
      }
    } catch (error) {
      // rpm not available or package not installed
    }

    return null
  }

  /**
   * Logs helpful hints for users when VirtIO ISO is not found
   */
  private static logSearchHints(): void {
    console.error('\n=== VirtIO Windows Drivers ISO Not Found ===')
    console.error('The virtio-win ISO is required for Windows VM installations.')
    console.error('\nPlease install it using one of these methods:\n')
    console.error('Ubuntu/Debian:')
    console.error('  1. Download from: https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/')
    console.error('  2. Place in: /var/lib/libvirt/images/virtio-win.iso')
    console.error('  3. Or set VIRTIO_WIN_ISO_PATH in .env\n')
    console.error('Fedora/RHEL/CentOS:')
    console.error('  sudo dnf install virtio-win\n')
    console.error('Manual installation:')
    console.error('  1. Download ISO from: https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/')
    console.error('  2. Set VIRTIO_WIN_ISO_PATH=/path/to/virtio-win.iso in .env')
    console.error('\nSearched locations:')
    this.getSearchPaths().forEach(p => console.error(`  - ${p}`))
    console.error('==========================================\n')
  }

  /**
   * Validates that the resolved path exists and is accessible
   * Throws an error if not found or not accessible
   */
  public static async resolveOrThrow(): Promise<string> {
    const resolvedPath = await this.resolve()

    if (!resolvedPath) {
      throw new Error(
        'VIRTIO_WIN_ISO_PATH is not set and virtio-win ISO was not found automatically. ' +
        'Please install virtio-win drivers or set VIRTIO_WIN_ISO_PATH in your .env file. ' +
        'See logs above for installation instructions.'
      )
    }

    // Additional validation
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK)
    } catch (error) {
      throw new Error(
        `VirtIO ISO found at ${resolvedPath} but is not readable. ` +
        'Please check file permissions.'
      )
    }

    return resolvedPath
  }

  /**
   * Clears the cached path, forcing a new search on next resolve()
   */
  public static clearCache(): void {
    this.cachedPath = null
    this.debug.log('Cache cleared')
  }
}
