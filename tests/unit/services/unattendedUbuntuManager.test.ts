import { Application } from '@prisma/client'
import { UnattendedUbuntuManager } from '../../../app/services/unattendedUbuntuManager'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import * as unixcrypt from 'unixcrypt'

describe('UnattendedUbuntuManager', () => {
  const originalEnv = process.env
  const validUsername = 'testuser'
  const validPassword = 'testpass123'
  const mockApplications = [
    {
      id: 'app1',
      name: 'TestApp',
      os: ['ubuntu'],
      installCommand: { ubuntu: 'apt install testapp' },
      parameters: {} as any
    }
  ] as unknown as Application[]

  beforeEach(() => {
    process.env = { ...originalEnv, INFINIBAY_BASE_DIR: '/opt/infinibay' }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('should create instance with valid parameters', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(UnattendedUbuntuManager)
      expect(manager.configFileName).toBe('user-data')
      expect(manager['username']).toBe(validUsername)
    })

    it('should throw error when username is missing', () => {
      expect(() => {
        new UnattendedUbuntuManager('', validPassword, mockApplications)
      }).toThrow('Username and password are required')
    })

    it('should throw error when password is missing', () => {
      expect(() => {
        new UnattendedUbuntuManager(validUsername, '', mockApplications)
      }).toThrow('Username and password are required')
    })

    it('should initialize with empty applications array', () => {
      const manager = new UnattendedUbuntuManager(validUsername, validPassword, [])
      expect(manager['applications']).toEqual([])
    })

    it('should set empty VM ID by default', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )
      expect(manager['vmId']).toBe('')
    })

    it('should set custom VM ID when provided', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications,
        'vm-123'
      )
      expect(manager['vmId']).toBe('vm-123')
    })

    it('should initialize empty scripts array by default', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )
      expect(manager['scripts']).toEqual([])
    })

    it('should accept scripts parameter', () => {
      const mockScripts = [{ id: 'script1', name: 'test' }]
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications,
        undefined,
        mockScripts
      )
      expect(manager['scripts']).toEqual(mockScripts)
    })
  })

  describe('generateConfig', () => {
    it('should generate valid YAML configuration', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()

      expect(config).toBeDefined()
      expect(typeof config).toBe('string')
      expect(config).toContain('#cloud-config')

      // Verify YAML can be parsed
      const parsed = yaml.load(config) as any
      expect(parsed.autoinstall).toBeDefined()
    })

    it('should include autoinstall configuration', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.version).toBe(1)
      expect(parsed.autoinstall.identity).toBeDefined()
      expect(parsed.autoinstall.identity.username).toBe(validUsername)
    })

    it('should encrypt password using unixcrypt', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      // Password should be encrypted (not plain text)
      expect(parsed.autoinstall.identity.password).not.toBe(validPassword)
      expect(parsed.autoinstall.identity.password).not.toBe('')
    })

    it('should generate unique hostname', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config1 = await manager.generateConfig()
      const config2 = await manager.generateConfig()

      const parsed1 = yaml.load(config1) as any
      const parsed2 = yaml.load(config2) as any

      expect(parsed1.autoinstall.identity.hostname).not.toBe(parsed2.autoinstall.identity.hostname)
      expect(parsed1.autoinstall.identity.hostname).toMatch(/^ubuntu-/)
    })

    it('should include network early-commands', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall['early-commands']).toBeDefined()
      expect(Array.isArray(parsed.autoinstall['early-commands'])).toBe(true)
    })

    it('should include shutdown reboot setting', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.shutdown).toBe('reboot')
    })

    it('should set timezone to UTC', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.timezone).toBe('UTC')
    })

    it('should include source configuration', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.source).toBeDefined()
      expect(parsed.autoinstall.source.id).toBe('ubuntu-desktop')
    })

    it('should include late-commands', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall['late-commands']).toBeDefined()
      expect(Array.isArray(parsed.autoinstall['late-commands'])).toBe(true)
    })

    it('should set keyboard layout to US', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.keyboard.layout).toBe('us')
    })

    it('should set locale', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.locale).toBe('en_US')
    })

    it('should enable codecs and drivers', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall.codecs.install).toBe(true)
      expect(parsed.autoinstall.drivers.install).toBe(true)
      expect(parsed.autoinstall.oem.install).toBe('auto')
    })
  })

  describe('generateLateCommands', () => {
    it('should generate network validation helper script', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('wait-for-network.sh')
      expect(joined).toContain('MAX_ATTEMPTS')
    })

    it('should include apt-get update in late-commands', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('apt-get update')
    })

    it('should install required packages', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('curl')
      expect(joined).toContain('wget')
      expect(joined).toContain('qemu-guest-agent')
    })

    it('should create cloud scripts directory', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      const joined = commands.join('\n')
      expect(joined).toContain('cloud/scripts/per-instance')
    })

    it('should generate first-boot script commands (handled by InfiniService post-boot)', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateLateCommands']()
      // Scripts are no longer embedded in late-commands;
      // InfiniService handles all FIRST_BOOT scripts post-boot
      expect(commands).toBeDefined()
      expect(commands.length).toBeGreaterThan(0)
    })

  describe('generateInfiniServiceInstallCommands', () => {
    it('should generate InfiniService installation commands', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateInfiniServiceInstallCommands']()

      expect(commands.length).toBeGreaterThan(0)
      expect(commands[0]).toContain('cat > /target/var/lib/cloud/scripts')
    })

    it('should include download with retry logic', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateInfiniServiceInstallCommands']()
      const commandString = commands.join('\n')

      expect(commandString).toContain('MAX_DOWNLOAD_RETRIES')
      expect(commandString).toContain('retry')
    })

    it('should use backend URL from environment', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateInfiniServiceInstallCommands']()
      const commandString = commands.join('\n')

      expect(commandString).toContain(`http://${process.env.APP_HOST || 'localhost'}:${process.env.PORT || '4000'}`)
    })

    it('should include VM ID in installation', async () => {
      const vmId = 'test-vm-123'
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications,
        vmId
      )

      const commands = manager['generateInfiniServiceInstallCommands']()
      const commandString = commands.join('\n')

      expect(commandString).toContain(vmId)
    })
  })


  describe('generateAppScriptCommands', () => {
    it('should generate script commands for each application', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const commands = manager['generateAppScriptCommands']()

      expect(Array.isArray(commands)).toBe(true)
    })

    it('should filter applications by Ubuntu compatibility', () => {
      const mixedApps = [
        ...mockApplications,
        {
          id: 'app2',
          name: 'WindowsApp',
          os: ['windows'],
          installCommand: { windows: 'winget install' },
          parameters: {} as any
        }
      ] as unknown as Application[]

      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mixedApps
      )

      const commands = manager['generateAppScriptCommands']()

      expect(commands.length).toBeLessThan(mixedApps.length)
    })
  })

  describe('generateMasterInstallScript', () => {
    it('should generate master install script', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const script = manager['generateMasterInstallScript']()

      expect(script).toBeDefined()
      expect(typeof script).toBe('string')
    })

    it('should only include apps with Ubuntu install commands', async () => {
      const mixedApps = [
        ...mockApplications,
        {
          id: 'app2',
          name: 'NoInstallApp',
          os: ['ubuntu'],
          installCommand: null,
          parameters: {} as any
        }
      ] as unknown as Application[]

      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mixedApps
      )

      const script = manager['generateMasterInstallScript']()

      expect(script).toBeDefined()
    })
  })

  describe('parseInstallCommand', () => {
    it('should replace placeholders in command', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install {{packageName}}'
      const parameters = { packageName: 'test-package' }

      const parsed = manager['parseInstallCommand'](command, parameters)

      expect(parsed).toBe('apt install test-package')
    })

    it('should handle multiple placeholders', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install {{package1}} {{package2}}'
      const parameters = { package1: 'pkg1', package2: 'pkg2' }

      const parsed = manager['parseInstallCommand'](command, parameters)

      expect(parsed).toBe('apt install pkg1 pkg2')
    })

    it('should return original command when no parameters', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = 'apt install package'
      const parsed = manager['parseInstallCommand'](command, null)

      expect(parsed).toBe('apt install package')
    })
  })

  describe('getUbuntuInstallCommand', () => {
    it('should return Ubuntu install command', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const command = manager['getUbuntuInstallCommand'](mockApplications[0])

      expect(command).toBe('apt install testapp')
    })

    it('should return undefined for non-ubuntu install command', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const app = {
        ...mockApplications[0],
        installCommand: { windows: 'winget install' }
      } as unknown as Application

      const command = manager['getUbuntuInstallCommand'](app)

      expect(command).toBeUndefined()
    })

    it('should return undefined for null install command', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const app = {
        ...mockApplications[0],
        installCommand: null
      } as unknown as Application

      const command = manager['getUbuntuInstallCommand'](app)

      expect(command).toBeUndefined()
    })
  })

  describe('validateConfig', () => {
    it('should return valid for properly formatted config', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const config = await manager.generateConfig()
      const validation = await manager['validateConfig'](config)

      expect(validation.valid).toBe(true)
      expect(validation.errors).toEqual([])
    })

    it('should return invalid for empty config', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const validation = await manager['validateConfig']('')

      expect(validation.valid).toBe(false)
      expect(validation.errors.length).toBeGreaterThan(0)
    })

    it('should return invalid for missing autoinstall section', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const validation = await manager['validateConfig']('some random text')

      expect(validation.valid).toBe(false)
    })

    it('should return invalid for missing identity', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = 'autoinstall:\n  version: 1'
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
    })

    it('should return invalid for missing username', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = `
autoinstall:
  version: 1
  identity: {}
`
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing "autoinstall.identity.username"')
    })

    it('should return invalid for missing password', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const invalidConfig = `
autoinstall:
  version: 1
  identity:
    username: testuser
`
      const validation = await manager['validateConfig'](invalidConfig)

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Missing "autoinstall.identity.password"')
    })
  })

  describe('modifyGrubConfig', () => {
    it('should modify GRUB configuration file', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub.cfg')
      const mockContent = 'set timeout=5\n\nmenuentry { ... }'

      await fs.promises.writeFile(mockGrubCfgPath, mockContent)

      await manager['modifyGrubConfig'](mockGrubCfgPath)

      const modifiedContent = await fs.promises.readFile(mockGrubCfgPath, 'utf-8')

      expect(modifiedContent).toContain('set timeout=3')
      expect(modifiedContent).toContain('default=0')

      await fs.promises.unlink(mockGrubCfgPath)
    })

    it('should add timeout setting if not present', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const mockGrubCfgPath = path.join(os.tmpdir(), 'test-grub2.cfg')
      const mockContent = '# GRUB config\n\nmenuentry'

      await fs.promises.writeFile(mockGrubCfgPath, mockContent)

      await manager['modifyGrubConfig'](mockGrubCfgPath)

      const modifiedContent = await fs.promises.readFile(mockGrubCfgPath, 'utf-8')

      expect(modifiedContent).toContain('set timeout=3')

      await fs.promises.unlink(mockGrubCfgPath)
    })
  })

  describe('findKernelPaths', () => {
    it('should return default paths when standard paths exist', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now())
      const casperDir = path.join(extractDir, 'casper')
      await fs.promises.mkdir(casperDir, { recursive: true })

      // Create dummy files
      await fs.promises.writeFile(path.join(casperDir, 'vmlinuz'), 'dummy')
      await fs.promises.writeFile(path.join(casperDir, 'initrd'), 'dummy')

      const paths = await manager['findKernelPaths'](extractDir)

      expect(paths.vmlinuz).toBe('/casper/vmlinuz')
      expect(paths.initrd).toBe('/casper/initrd')

      await fs.promises.rm(extractDir, { recursive: true, force: true })
    })

    it('should search for files when standard paths do not exist', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const extractDir = path.join(os.tmpdir(), 'iso-extract-' + Date.now())
      await fs.promises.mkdir(extractDir, { recursive: true })

      const paths = await manager['findKernelPaths'](extractDir)

      expect(paths.vmlinuz).toBe('/casper/vmlinuz')
      expect(paths.initrd).toBe('/casper/initrd')

      await fs.promises.rm(extractDir, { recursive: true, force: true })
    })
  })

  describe('parseShellArgs', () => {
    it('should parse simple arguments', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']('-V Ubuntu -o output.iso')

      expect(args).toEqual(['-V', 'Ubuntu', '-o', 'output.iso'])
    })

    it('should parse quoted arguments', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']("-V 'Ubuntu 24.04'")

      expect(args).toEqual(['-V', 'Ubuntu 24.04'])
    })

    it('should handle double quotes', () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const args = manager['parseShellArgs']('-V "Ubuntu 24.04" -o output')

      expect(args).toEqual(['-V', 'Ubuntu 24.04', '-o', 'output'])
    })
  })

  describe('getXorrisoParamsFromISO', () => {
    it('should return empty array when isoinfo fails', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        mockApplications
      )

      const params = await manager['getXorrisoParamsFromISO']('/nonexistent/iso.iso')

      expect(params).toEqual([])
    })
  })

  describe('edge cases', () => {
    it('should handle empty applications array', async () => {
      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        []
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall).toBeDefined()
    })

    it('should handle applications with no install commands', async () => {
      const apps = [{
        id: 'app1',
        name: 'NoInstallApp',
        os: 'ubuntu',
        installCommand: null,
        parameters: {} as any
      } as unknown as Application]

      const manager = new UnattendedUbuntuManager(
        validUsername,
        validPassword,
        apps
      )

      const config = await manager.generateConfig()
      const parsed = yaml.load(config) as any

      expect(parsed.autoinstall).toBeDefined()
    })
  })
  })
})
